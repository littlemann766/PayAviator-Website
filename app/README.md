# PayAviator web app (phase 1)

Static HTML + one shared CSS (`app.css`) + vanilla ES modules. No framework, no build step, no CDN except the Firebase Auth SDK from `www.gstatic.com` (same version/approach as `assets/billing.js`). **Local branch `webapp-build`; not deployed.**

Routes (files): `/app/signin`, `/app/` (`index.html`, dashboard), `/app/calendar`, `/app/bills`, `/app/income`, `/app/budget`, `/app/accounts`, `/app/settings`. Links are relative (`bills.html`), so it works from any static host (GitHub Pages serves extensionless URLs too).

```
app/
  *.html            thin pages: CSP meta + <div id=root> + one module
  app.css           shared styles (original palette: light blue / navy / cyan / green / amber)
  js/api.js         ALL data access (sync engine, live + stub transports)
  js/auth.js        Firebase Auth (Google + email), verified-email handling, DEMO_MOCK
  js/calc.js        Safe to Spend, bill/income occurrences, gauge scale (port of the app logic)
  js/gauge.js       gauge SVG (same look as the app)
  js/forms.js       shared add/edit bill and income sheets (Bills, Income and Calendar all use them)
  js/ui.js          shell, toast, side panel/sheet, confirm dialog, focus trap, form builder, auth guard, idle sign-out
  js/views.js       shared view helpers;  js/pages/*.js  one module per page
  tests/            webapp_test.py (demo e2e), live_contract_test.py (+ live_backend_server.mjs)
```

## Data layer and the final sync contract
Source: backend branch `cloud-sync-pause-banks`, `docs/CLOUD_SYNC_AND_PAUSE.md` (+ `src/cloudSync.js`). Bearer Firebase ID token, verified email required.

| Call | Used for |
|---|---|
| `GET /api/sync/changes?since=<seq>&limit=<=500>` -> `{items:[{kind,id,data\|null,updatedAt,deleted,seq}], next, more}` | pull (cursor = `next`, loop while `more`); `api.changes(since)` |
| `POST /api/sync/push {items:[{kind,id,data,updatedAt,deleted?}]}` (<=200) -> `{results:[{kind,id,status:'accepted'\|'rejected',reason?,winner?}]}` | all writes, batched by 200; `api.batch(ops)` |
| `DELETE /api/sync/all` -> `{deleted:n}` | Settings > Delete synced data |
| `GET /api/plaid/accounts`, `GET /api/plaid/transactions?limit=250`, `GET /api/billing/status` | Accounts, Dashboard, Settings (read-only, memory only, never persisted) |

Kinds: `bill income spending cushion budget goal category`. Last-write-wins on `updatedAt` (ms); the server clamps it to now+5 min; tombstones are `deleted:true`. Web writes use `max(Date.now(), previous+1)`. On `rejected/stale` the returned `winner` replaces the local copy and a toast says "Updated on your phone". Other rejections (`too_large`, `item_limit`, ...) are dropped and reported. Offline: edits stay queued, status pill shows Offline, retry with backoff (2 s -> 60 s) and on `online`/tab focus; polling every 30 s while visible.

**Swap point:** `const ADAPTER = 'live' | 'stub'` at the top of `js/api.js`. Demo mode (`?demo=1` on localhost) always uses the stub. The stub transport re-implements the server (validation, LWW, `seq`, `more`, `winner`) with demo data in `localStorage` (`pa_demo_server_v1:*`, cleared at sign-out), so UI and sync code are identical in both modes. Paused banks: `items[].paused`/`pause_reason` and `errors[].code==='ITEM_PAUSED'` give a Paused card on Accounts, a banner on Accounts and Home, and `billing.pausedBanks` in the plan card; paused banks are left out of Safe to Spend.

### `data` shapes
The Android app is the source of truth: see **`SYNC_SHAPES.md`** (ids, fields, per-occurrence `_ov/_pa/_mv`, budget `month:YYYY-MM`, cushion `payday`, known app tweaks). Code: `js/codec.js` (wire ⇄ view), used by `js/api.js`.

## Auth
Firebase web SDK, project `payaviator-app` (public config copied from `assets/billing.js`). Google (popup, redirect fallback) and email only; no phone. Session persistence = `browserSessionPersistence`. After the user taps **I verified, continue** (and on tab focus) we call `user.reload()` then `getIdToken(true)`. Resend has a 60 s cooldown and says to use the newest email. Unverified users are sent to `signin.html?verify=1`; a server 403 `EMAIL_NOT_VERIFIED` triggers the same refresh then redirect. Signed-out visits redirect to `/app/signin`. If the SDK cannot load, sign-in shows "Sign-in is unavailable" and app pages show a clear fatal state (no redirect loop). Sign out clears memory, the demo store and the resend timer. Idle sign-out after 30 min.

**DEV_MOCK:** `?demo=1` only on `localhost`/`127.0.0.1`, remembered for the tab; `?demo=0` clears it. Always off on real hosts (code checks hostname). Demo flags `?bank=1` (linked demo bank) and `?paused=1` (adds a paused bank).

## Safe to Spend: what is ported
From `/workspace/pa-420/wt/index.html` (4.1.4): `isRecurringOnDate`, `paycheckOnDate`, `PayAviatorMonthState985` (ledger = received checks + funds - paid bills - spending - savings), pp967 `state()` (`safe = max(0, available - cushion)`; connected spendable accounts are authoritative when present, else the ledger), `niceMax`/`pp973Scale` (gauge scale, min main max $500).
**Differences (documented subset):** cash wallet (`payaviator_cash_wallet_v950`) is phone-only, treated as $0; "include savings" toggle, `PayAviatorAvailableNow` and the hourly-wage income path are not ported; percent cushion is applied to available money (the app applies it to its funding amount); per-occurrence moves (`dateMoves`) and `monthlyCashPaidFor` are not modelled; bill "paid" for a recurring bill is stored per occurrence in `occ`; repeat options are only those the app supports (never/weekly/every 2 weeks/monthly); gauge needle is piecewise-linear between the evenly spaced labels; gauge labels are compact (`$2.5k`). Copy previous month copies one-time bills (as the app) and, if this month has none, the budget limits.

## Security
- CSP via `<meta>`: `default-src 'self'; script-src 'self' https://www.gstatic.com; style-src 'self'; connect-src 'self' api.payaviator.app + Google identity endpoints; frame-src payaviator-app.firebaseapp.com accounts.google.com; object-src 'none'; base-uri 'none'`. No inline script/style/handlers (tests assert it). **`frame-ancestors` is ignored in a meta tag, so the host must send headers:** `Content-Security-Policy: frame-ancestors 'none'` (plus the same policy above), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` for `/app/*.html`. GitHub Pages cannot set headers: a proxy/CDN (Cloudflare etc.) is needed for these. HTTPS only (Pages enforces it); `api.js` only calls `https://api.payaviator.app`.
- API CORS on the backend must allow `https://payaviator.app` (and `Authorization`, `GET/POST/DELETE`).
- No secrets in the client (Firebase web key is public by design). All user text is rendered via text nodes (`h()` helper; no `innerHTML` with data; tested with an HTML-in-name bill). Bank data lives in memory only. Sign out clears local data.

## Tests
`pip install playwright && playwright install chromium`, then `python3 app/tests/webapp_test.py` (demo mode: sign-in via `?demo=1`, bill/income/budget/spending add-edit-delete, gauge + totals update, validation, focus trap/Esc, conflict, paused UI, no horizontal scroll at 360/390/412/1280 and 360 @ 1.5x root font, CSP/inline checks, XSS escape, sign-out, no console errors). `node app/tests/roundtrip_test.mjs` runs the app's real sync client against the web data layer through the real backend (both directions, no field loss). `python3 app/tests/live_contract_test.py [backend_dir]` runs the live adapter against the real backend app (in-memory store) incl. LWW, tombstones, 450-item batching, delete-all and the unverified-email 403.

## Known gaps / not done
Phase 1 scope only: no Calendar/Spending/Paycheck Planner/Payoff pages, goals are view-only, bank link/unlink and Plus checkout are not on web, no per-occurrence delete/move of recurring items, no step-up re-auth for balances, no real Firebase sign-in test (no credentials), Google redirect flow untested. Not run against a deployed backend. Hosting: pages assume `/app/` under payaviator.app and `../privacy.html`, `../terms.html`, `../delete-account.html`.

## Questions for Lucian / app work
1. Confirm the `data` shapes above (or provide the app's) for every kind, especially `bill.occ`, `income.incomeType`, and budget `categories`. Max 8 KB per item: any app bill with long notify settings is fine?
2. Will the Android app write the same ids (UUID strings) and `updatedAt` in ms, and import existing local data idempotently by id on first sync?
3. Is `https://payaviator.app` in `corsOrigins` and is the deployed API already on `cloud-sync-pause-banks`?
4. Is a `/api/sync/changes` cursor (`seq`) stable per user across `DELETE /api/sync/all` (we reset to 0 locally after delete)?
5. Tombstones purge after 90 days: should a web session idle longer than that do a full resync (`since=0`)? Currently memory is rebuilt at each load, so this is fine.
6. Any server limit on `/api/plaid/transactions` rate from the web (we call it once per Accounts visit)?

## Calendar (`/app/calendar`)
Month grid modelled on the Android app's Calendar tab (`index.html` `renderCalendar` / `dayCell` / `calendarDay`). It adds no new data or record shapes: it reads the same `bill` and `income` records through `api.bills.list()` / `api.income.list()` and uses `billOnDate` / `incomeOnDate` from `calc.js` (the app's `isRecurringOnDate` / `paycheckOnDate`).
- **Day cells:** each bill is drawn in its own color (navy or white text, whichever is readable); income uses the app's paycheck green `#15803d`; paid bills are dimmed with a check mark; a partly paid bill gives the day a red border; today has a cyan ring. Desktop and tablet widths (600px and up) show name + amount pills (3 per day, then "+n more"); phones show colored dots so cells stay readable.
- **Tap a day** to select it. The panel under the grid lists that day's bills and income; tap one to edit it (same side panel / sheet as the Bills and Income pages, including paid, repeat and delete). **Add bill** (top right, same button as the other pages) and the panel's **Add bill / Add income** buttons pre-fill the selected date.
- **Month navigation** uses the shared view month (also used by Bills, Income and Budget), plus a **Today** button. The tab is in the sidebar and in the phone tab bar (7 tabs).
- Edits go through the same sync path (`api.bills.save/remove`, `api.income.save/remove`), so they appear on the phone and offline queueing is unchanged.
- **Not ported from the app:** reminders and work hours (not synced kinds), long-press shortcut, week tabs, multi-month range, calendar filter toggles, and moving a single occurrence to another day.
- Tests: `[calendar]` section in `tests/webapp_test.py`. Screenshots: `python3 app/tests/shots_calendar.py [outdir]`.
