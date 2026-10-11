# PayAviator website (v3 — staged for app 3.9.6, not pushed)

Static HTML/CSS/vanilla JS. No build step — deploy the folder as-is (e.g. GitHub Pages).

- `index.html`, `privacy.html`, `terms.html` — same file names as v1.
- `assets/styles.css`, `assets/main.js` — shared styles and interactions.
- `assets/logo-{64,256,512}.{png,webp}`, `favicon-32.png`, `apple-touch-icon.png` — web-sized logos.
- `assets/screens/redesign-{dashboard,calendar,bills,spending,budget,payoff-planner}.{webp,png}` — screenshots of the 3.9.6 redesign (original app colors), sample data only. Used in the "A look at PayAviator" carousel.
- `assets/screens/hero-social-card.{png,webp}` — 1200x630 Open Graph / Twitter card image (3.9.6 redesign phones, original app colors).
- `payaviator-logo.png` — original full-size logo (kept, not used by pages).

Done:
- [x] Site restyled to match the current app (v3.9.4): navy #0b234b header/tab-bar with 3px #00f5ff rules, app-blue #0c79bb canvas, cyan-bordered cards (r20–22), PayAviator Gauge, Arial button/nav type, app icons.
- [x] Hero phone is an HTML/CSS replica of the app Home / Calendar / Bills screens (example data); calculator result shown on the app gauge.
- [x] Screenshot carousel filled with current shipped-design shots (no empty slots).
- [x] og:image / twitter:image (summary_large_image) wired to hero-social-card.png.

TODO before launch:
- [ ] Social image URLs: og:image and twitter:image use a relative path. Swap in the absolute URL once the domain is known (search `TODO` in index.html <head>).
- [x] hero-social-card now uses current-design screens (Spending + Home). Its subline "Bills, income and spending in one calm flight deck" may be reworded.
- [ ] Payoff Planner screenshot: not used — the current app shows "Payment does not reduce the balance" for the sample card. Add it after the planner is fixed.
- [ ] Redesign screenshots (`redesign-*`): not used until that design is approved and shipped.
- [ ] hero-dashboard.png: not used — its tagline ("Know what's safe to spend before payday.") is unverified. The hero keeps the CSS phone mockup.
- [ ] Store links: the App Store / Google Play buttons point to `#` and show "Coming soon". Search `TODO` in index.html.
- [x] "Try it" Safe to Spend demo mirrors the app formula (3.9.4/3.9.5 index.html, Home gauge state()): Safe to Spend = max(0, Available now − Cushion + Savings if included). Cushion = % of most recent paycheck (default 20%) or a dollar amount. Gauge scale = app default (niceMax, marks at 25/50/75%).
- [x] Payoff Planner demo mirrors the app's planner (3.9.4 index.html pp151-payoff-authority-js, lines 23489-23515; same code in 3.9.5 at 23529-23555): pick one card, then Snowball (smaller monthly payment, "Snowball payment: $X/mo") or Avalanche ("Full payoff" = balance + one month of interest at APR/1200). The credit-used gauge, stats, projection text and projected utilization use the app's labels. The textbook "smallest balance first / highest rate first" comparison was removed, and the feature card and FAQ copy were fixed to match.
- [ ] App bug (not reproduced on the site): 3.9.4/3.9.5 hard-codes the Snowball payment to $25 (pp151 `BASE=25`). `normalize()` also overwrites each card's saved Snowball/minimum payment with 25. Any card whose monthly interest is $25 or more then shows "Payment does not reduce the balance" / "Needs payment". The demo uses each example card's own Snowball payment instead. Re-check the demo once the app is fixed.
- [ ] App Snowball button subtitle still reads "Smallest balance first." (old wording). The site uses the app's help text, "Keeps the payment smaller", instead. Align it when the app copy changes.
- [ ] If the app UI or Safe to Spend formula changes, update the demo in assets/main.js (search "mirrors the app").
- [ ] If the app UI changes (e.g. the redesign ships), update the hero replica in index.html and the tokens at the top of assets/styles.css.
- [ ] The hero phone replica, calculator start values and payoff demo cards are illustrative example data.

3.9.6 staging (v3):
- [x] Carousel: six redesign-* shots incl. Payoff Planner (shows a working $180/mo + $150 extra projection, no bug message). current-* removed from assets.
- [x] Hero phone, Safe to Spend calculator and Payoff demo restyled to the 3.9.6 redesign (pa-400-redesign-css): 1px hairlines, raised #1f4f86 / sunken #081936 surfaces, readout seated below the dial, pill nav icons. Original palette kept (#0c79bb page, #0b234b cards, #00f5ff accent).
- [x] Payoff demo math = 3.9.6 pp151 (min payment or 3% of balance with $25 floor; full snowball with Extra monthly payment to the smallest balance first; needle follows the selected card). Hand check: Visa $3,240.55 @ 24.99%, $180/mo, no extra = 23 months, $863.15, Sep 2028 (from Oct 2026).
- [x] Safe to Spend: formula unchanged in 3.9.6 (only the custom-scale detection in pp973Scale changed); demo unchanged.
- [ ] Release 3.9.6 first: the copy describes 3.9.6 behaviour (Extra payment, saved minimums). Don't publish this site before the app update ships.
- [ ] App Snowball button subtitle reads "Smallest balance first." and the Extra field is labelled "Extra monthly payoff" at runtime (markup says "Extra monthly payment"). The site uses "Extra monthly payment" as asked; align whichever wording the app keeps.
