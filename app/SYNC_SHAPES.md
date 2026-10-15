# Sync `data` shapes (single source of truth)

**The Android app is the source of truth.** Reference: app branch `rel-414-sync`, worktree `/workspace/pa-420/wt-sync`, script `<script id="pa414-cloud-sync">` in `index.html` (collections table `COLLS`, ~line 34486). Web code: `app/js/codec.js` (pure wire⇄view codec), used by `app/js/api.js`. Server contract (opaque `data` ≤ 8 KB, ids `[A-Za-z0-9_.:@-]{1,128}`, `updatedAt` ms, LWW): Lucian's `docs/CLOUD_SYNC_AND_PAUSE.md`.

Rules the web follows: (1) memory holds the **wire** `data` exactly as pulled; (2) pages see decoded **views**; (3) every write = `encode(view, priorWire)` which starts from a copy of the prior wire object, so fields the web does not know (notify*, autopay, dateMoves, recurringUntil, _mv, source, enteredAt, …) are never lost; (4) deletes are `{kind,id,updatedAt,deleted:true}` with **no `data`** (as the app and the contract say); (5) the web never writes a record the app cannot represent, because the app's scan tombstones anything that is in its sync base but not in its local storage (confirmed by test: it deleted web-only `limits:`/`w:` records).

Dates are local calendar `YYYY-MM-DD` strings on both sides. Money is a plain JSON number in dollars (not cents; the app does not round stored bills, the web rounds only what the user types, to 2 decimals). `enteredAt` is a UTC ISO datetime. Colors are `#rrggbb`.

## Ids
| kind | cloud id (app) | derived from | web |
|---|---|---|---|
| bill | `safeId(b.id)` | app bill `id` (UUID) | reads any id; creates `uuid()`; writes `data.id` = same id |
| income | `safeId(p.id)`; singleton **`profile`** | paycheck `id`; hourly/salary profile | same; `profile` is hidden and never edited |
| spending | `safeId(x.id)` | `id` (`sp_<ms>_xxxx`, `rf_…`, UUID, `spend-<ms>`) | same |
| goal | `safeId(g.id)` | `id` (UUID or `goal-<ms>`) | read-only |
| budget | **`month:YYYY-MM`** | key of `payAviator_monthly_budgets_v1` | same |
| category | `safeId('c:'+key)` | key of `payAviator_category_map_v86` (`id:<billId>` or `name:<lower name>`) | read-only |
| cushion | singleton **`payday`** | `payaviator_payday_cushion_v2045` | same |

`safeId(raw)` = raw if it matches the id regex, else `h_` + hash. **`data.id` always holds the app's RAW id** (the app re-keys its arrays by `data.id`), so web-created records MUST include `id` in `data` (the first web build stripped it: the app would have stored such a bill under id `undefined`).

## `data` per kind (app shape; web additions marked ➕)
**bill** – `{id, name, amount:number, due:'YYYY-MM-DD', recurring:bool, recurrence:'weekly'|'biweekly'|'monthly', paid:bool, color:'#rrggbb', category?:string, notes?:string, autopay?:bool, notify:bool, notifyDaysBefore:[n…], notifyTime:'HH:MM', notifySound, notifyVibrate:bool, dateMoves?:{origISO:newISO}, recurringUntil?:'YYYY-MM-DD'(exclusive), _ov?, _pa?, _mv?}`
- **Per-occurrence overrides ride inside the bill** (the app keeps three flat maps keyed `"<billId>|<ISO date>"`; the sync client splits them per bill, key = the date): `_ov:{iso:{paid?:bool, deleted?:true, movedTo?:iso}}` (billOverrides), `_pa:{iso:number}` (billPaidAmounts = amount actually paid), `_mv:{iso:{due,amount,name}}` (instance moves).
- Paid amount on a date (app `billPaidAmount`): `_pa[iso]` if present, else (`_ov[iso]` present ? paid : `bill.paid`) ? `amount` : 0. Applies to **one-time bills too** (key = due date).
- Hidden date: `_ov[iso].deleted`, or `iso ∈ dateMoves` (moved away). Moved occurrence is its own separate one-time bill.
- Web view: `occ[iso]={paid?:n, deleted?:true}` built from `_pa/_ov`; web writes `_pa[iso]=amount` + `_ov[iso].paid=true` when marking paid and `_pa[iso]=0` + `_ov[iso].paid=false` when un-marking (explicit 0 so the phone never falls back to `bill.paid`). One-time bill: also sets `paid`. Changing a one-time bill's due date re-keys its `_pa/_ov`. The web cannot delete/move a single occurrence (phase 1) but preserves those fields.
- Category: `category` if non-blank, else category-map `id:<billId>` / `name:<lower name>` (the app's `repairBills` does the same). The web does not write the fallback back unless the user changes it.
- Color: hex. Web swatches are the same six hexes as the web theme; a bill's custom color is kept as an extra swatch (written back lower-cased).

**income** (a paycheck) – `{id, amount:number, date:'YYYY-MM-DD', frequency:'one-time'|'weekly'|'biweekly'|'monthly'|'semimonthly', incomeType:'hourly'|'salary', annualSalary:number, _ov?:{iso:{amount?:number, deleted?:true}}, ➕name?:string}`. The app has **no name** on paychecks → web shows `Paycheck` when absent and writes `name` for items it creates/edits. `_ov` = `paycheckOverrides` (per-date amount or deleted). **`profile`** record: `{profile:true, type:'hourly'|'salary', wage:string|null, salary:string|null}` (from `payAviator_income_type/hourly_wage/annual_salary_v1`): web ignores it (not a paycheck) and never writes it. New web income: `incomeType:'salary', annualSalary:0`. If the user changes the amount of an **hourly** paycheck on the web, it is switched to `salary` (otherwise the phone recomputes it from hours × wage and ignores the edit).

**spending** – `{id, name, amount:number(>0 always), date, notes?, flow?:'spending'|'refund'|'funds'|'credit', type?, kind?, source?:'manual', enteredAt?:ISO datetime, description?, category?}`. Refund/funds = `/^(refund|funds|credit)$/i` on `flow||type` (app: `spendingSignedAmount`). Older rows may have `description` instead of `name` (web displays it). Web new rows: `flow:'spending'|'refund'`, `source:'web'`, `enteredAt`, optional `category` (the app ignores `category` on spending). Editing keeps `flow/type/kind` unless the user flips spending⇄refund.

**goal** – `{id, name, target:number, saved:number, targetDate:'YYYY-MM-DD'|'', transactions:[{date, amount, …}]}`. Read-only on web.

**budget** – app: `{month:'YYYY-MM', amount:number}` (id `month:YYYY-MM`; the whole monthly budget is one number). Web view `{id:'YYYY-MM', limit, categories}`; ➕ per-category limits are stored as `categories:{name:number}` **inside the same record** (see Known limitation 1). Separate web-only records are not possible (item 5 above).

**category** – `{key:'id:<billId>'|'name:<lowercase bill name>', value:'Utilities'}`. Read-only on web. The web's pick-list = defaults ∪ map values ∪ categories used by bills/spending/budget limits. Web "new category" only creates a budget limit key; it writes no `category` record.

**cushion** – app `{type:'dollar'|'percent', amount:number, percent:number}` (singleton `payday`; the app merges over `{type:'dollar',amount:0,percent:0}`). Web view `{mode,dollar,percent}` ⇄ `{type,amount,percent}`.

## Mismatches found in the first web build (all fixed in web)
1. `data.id` missing in web writes → app would key web bills/income/spending/goals as `undefined`. Fixed.
2. Bill color: web used names (`green`…); app uses `#rrggbb`. Fixed (hex swatches, dots via CSSOM so CSP stays strict).
3. Per-occurrence overrides: web invented `occ`; app uses `_ov/_pa/_mv` (+`dateMoves`, `recurringUntil`). Web now decodes/encodes them. Moves (`dateMoves`) now hide the original date on web.
4. One-time bill paid state: web used `bill.paid`; app uses `_pa[due]`. Fixed.
5. Budget: id was `YYYY-MM` / `{month,limit,categories}`; app is `month:YYYY-MM` / `{month,amount}`. Fixed; category limits kept as an extra field.
6. Cushion: id `cushion`, `{mode,dollar,percent}`; app is `payday`, `{type,amount,percent}`. Fixed (the old web id would have been invisible to the phone).
7. Category: web wrote `{name}` records (ids slug); app ids `c:<key>` with `{key,value}`; the app would have **deleted** them. Web no longer writes kind `category`; it reads the app's map.
8. Income: the app's `profile` singleton would have appeared as a broken paycheck; app paychecks have no `name`, `incomeType` hourly/salary. Fixed.
9. Spending: web `flow` only; app also uses `type/kind/description/source/enteredAt`. Preserved; refund detection identical to the app.
10. Deletes sent `data:{}`; the contract and app omit `data`. Fixed.
11. Demo seed data now uses the app shapes (the demo server stub is the same codec path as live).

## Known limitations / app tweaks requested (the app was NOT edited)
1. **Budget categories:** app's `mapColl('budget')` keeps only `amount` when it applies a record, so a phone edit of that month's budget number pushes `{month,amount}` and wipes the web's `categories`. Tweak: keep a local `payAviator_budget_category_limits_v414` map and include `categories` in the record (and write it back on apply).
2. **Paycheck name:** `savePaycheck` rebuilds the object `{id,amount,date,frequency,incomeType,annualSalary}`, dropping the web's `name` (web then shows "Paycheck"). Tweak: `{...old, ...data}` when editing.
3. **Unrepresentable records get tombstoned:** in `scan()`, a cloud item the app cannot store (no matching local key) stays in the sync base and is later pushed as a delete. Tweak: when `write()` ignores an item, do not put it in `KB`. Until then the web must only write shapes the app stores (it does).
4. **Hourly income edits on web** are converted to `salary` (see income). If product prefers, the app could honour an explicit per-check amount for hourly checks.
5. App id hashing: ids containing spaces or `#` become `h_<hash>`; two devices hash the same, but the web never creates such ids.
6. `MAX_DATA=8000` in the app and the server's 8 KB limit: a bill accumulates two map entries per paid occurrence (~80 bytes); a monthly bill is fine for years, a weekly bill paid for ~2 years approaches the limit. Suggest pruning `_pa/_ov` entries older than 12 months in the app.
7. Safe to Spend is still a documented subset on web (cash wallet, savings toggle, hourly path, `monthlyCashPaidFor`, per-occurrence moves of paid amounts not ported).
8. Offline > 90 days: tombstones are purged server-side; both sides should full-resync (`since=0`). The app resets only on uid change.

## Tests
`node app/tests/roundtrip_test.mjs` (46 checks): runs the app's real sync client (extracted from `index.html`, mock storage) and the web's real `api.js` against Lucian's real backend (in-memory). Covers app→web display (calc occurrences), web→app storage shape, decode∘encode identity for every app record (no field loss), deletes both ways, per-occurrence paid/unpaid, ids, no push loop. Plus `python3 app/tests/webapp_test.py` (demo e2e, 53) and `python3 app/tests/live_contract_test.py` (13).
