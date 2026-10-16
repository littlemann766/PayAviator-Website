import { h, icon, money, todayISO, fmtShort, toISO } from '../util.js';
import { bootPage } from '../ui.js';
import { api } from '../api.js';
import { safeToSpend, billOccurrences, incomeOnDate, incomeAmountOn, acctIncluded, acctBal } from '../calc.js';
import { gaugeSVG } from '../gauge.js';
import { spendChart } from '../spendchart.js';
import { activityRows, rangeTabs, actList, normRange } from '../activity.js';
import { colorDot, dueTag, emptyState } from '../views.js';

let acct = { loaded: false, accounts: [], items: [], errors: [], failed: false };
let tx = { loaded: false, list: [], failed: false };
let spendRange = 'week', spendMode = 'category';
let actOpen = (() => { try { return sessionStorage.getItem('pa_act_open') === '1'; } catch (e) { return false; } })();
let rerender = () => {};
let gPage = 0;
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

async function loadTx() {
  try { const r = await api.transactions(250); tx = { loaded: true, list: Array.isArray(r.transactions) ? r.transactions : [], failed: false }; }
  catch (e) { tx = { loaded: true, list: [], failed: true }; }
  rerender();
}

async function loadAccounts() {
  try { const r = await api.accounts(); acct = { loaded: true, accounts: r.accounts || [], items: r.items || [], errors: r.errors || [], failed: false }; }
  catch (e) { acct = { loaded: true, accounts: [], items: [], errors: [], failed: true }; }
  rerender();
}

function nextBills(bills, n = 3) {
  const now = new Date(), today = todayISO(), out = [];
  for (let k = 0; k < 2; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    for (const o of billOccurrences(bills, d.getFullYear(), d.getMonth())) if (o.status !== 'paid') out.push(o);
  }
  const overdue = out.filter((o) => o.iso < today).slice(-2), upcoming = out.filter((o) => o.iso >= today);
  return [...overdue, ...upcoming].slice(0, n);
}
function nextPaycheck(list) {
  const now = new Date();
  for (let i = 0; i < 70; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), iso = toISO(d);
    for (const p of list) if (incomeOnDate(p, d)) { const a = incomeAmountOn(p, iso); if (a > 0) return { p, iso, a }; }
  }
  return null;
}
const ib = (n) => h('span', { class: 'ib' }, icon(n));

/* Gauge pager (app: pp967 pages()). Page 0 = All Spendable (Safe to Spend); then one gauge per INCLUDED spendable account (checking and cash accounts,
   respecting the per-account Include/Exclude choice). Credit, loans and excluded accounts get no page, same as the Android app. */
function gaugePages(s) {
  const out = [{ name: 'All Spendable', all: true }];
  for (const a of acct.accounts.filter(acctIncluded)) {
    const inst = String(a.institutionName || a.institution_name || a.institution || a.bankName || 'Connected institution');
    const nm = String(a.name || a.official_name || a.officialName || a.subtype || 'Account'), mask = String(a.mask || '').trim();
    const name = inst + (mask ? ' \u2022\u2022\u2022\u2022 ' + mask : (nm && nm !== inst ? ' \u2022 ' + nm : ''));
    out.push({ name, acctName: nm, value: acctBal(a, 'available') });
  }
  return out;
}

function gaugePager(s) {
  const pages = gaugePages(s), n = pages.length;
  if (gPage >= n || gPage < 0) gPage = 0;
  const title = h('h2', { id: 'g-main', 'data-gauge-title': '', text: pages[gPage].name });
  const slides = pages.map((p, i) => {
    const body = p.all ? [
      gaugeSVG(s.safe, { main: true, label: 'Safe to spend' }),
      h('div', { class: 'safe' }, h('b', { class: 'big', 'data-safe': '', text: money(s.safe) }), h('span', { text: 'Safe to spend' })),
      s.safe > 0 ? h('p', { class: 'ontrack', text: 'On track: this is what you can spend after bills and the money you protect.' })
        : h('p', { class: 'ontrack warn', text: 'Nothing is safe to spend right now after bills and the money you protect.' }),
      h('dl', { class: 'metrics' },
        h('div', null, h('dt', { text: 'Available now' }), h('dd', { 'data-available': '', text: money(s.available) })),
        h('div', null, h('dt', { text: 'Savings' }), h('dd', { text: money(s.savings) })),
        h('div', null, h('dt', { text: 'Cushion' }), h('dd', { text: money(s.cushion) }))),
      s.source === 'ledger' ? h('p', { class: 'mini-note', text: 'No bank linked: estimated from your income, bills and spending this month.' }) : null,
    ] : [
      gaugeSVG(p.value, { main: false, label: p.name + ' spendable' }),
      h('div', { class: 'safe' }, h('b', { class: 'big', 'data-acct-amt': '', text: money(p.value) }), h('span', { text: 'Spendable in ' + p.acctName })),
      h('p', { class: 'mini-note', text: 'Bank-reported available balance. Savings stays protected. ' }, h('a', { class: 'lnk', href: 'accounts.html', text: 'Include or exclude accounts' })),
    ];
    return h('div', { class: 'g-slide' + (p.all ? ' g-all' : ''), 'data-g-slide': String(i), role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${n}: ${p.name}`, 'aria-hidden': i === gPage ? 'false' : 'true' }, body);
  });
  const track = h('div', { class: 'g-track', 'data-g-track': '' }, slides);
  const pager = h('div', { class: 'g-pager', role: 'region', 'aria-roledescription': 'carousel', 'aria-label': 'PayAviator gauges', tabindex: n > 1 ? '0' : null }, track);
  if (n < 2) return { title, head: [], pager };
  const dots = h('div', { class: 'g-dots' }, pages.map((p, i) => h('button', { type: 'button', class: 'g-dot' + (i === gPage ? ' active' : ''), 'data-g-dot': String(i), 'aria-label': 'View ' + p.name + ' gauge', 'aria-current': i === gPage ? 'true' : null })));
  const go = (i, smooth = true) => { const w = track.clientWidth; track.scrollTo({ left: i * w, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' }); };
  const setPage = (i) => {
    if (i === gPage) return; gPage = i; title.textContent = pages[i].name;
    dots.querySelectorAll('.g-dot').forEach((d, k) => { d.classList.toggle('active', k === i); if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    track.querySelectorAll('.g-slide').forEach((el, k) => el.setAttribute('aria-hidden', k === i ? 'false' : 'true'));
  };
  let raf = 0;
  track.addEventListener('scroll', () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const w = track.clientWidth || 1; setPage(Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / w)))); }); }, { passive: true });
  dots.addEventListener('click', (e) => { const b = e.target.closest('[data-g-dot]'); if (b) go(Number(b.dataset.gDot)); });
  const step = (d) => go((gPage + d + n) % n);
  const nav = (cls, d, ic, label) => h('button', { type: 'button', class: 'g-nav ' + cls, ['data-g-' + cls]: '', 'aria-label': label, onclick: () => step(d) }, icon(ic));
  pager.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
  const wrap = h('div', { class: 'g-wrap' }, nav('prev', -1, 'chev', 'Previous gauge'), pager, nav('next', 1, 'chev', 'Next gauge'));
  return { title, head: [h('div', { class: 'g-pg' }, dots, h('div', { class: 'g-hint', text: 'Swipe left or right to view another gauge' }))], pager: wrap, restore: () => { track.scrollLeft = gPage * track.clientWidth; } };
}

function render(main) {
  const data = api.data(), s = safeToSpend(data, acct.accounts);
  const pausedItems = acct.items.filter((i) => i.paused);
  const pc = nextPaycheck(data.income), nb = nextBills(data.bills), today = todayISO();

  const gp = gaugePager(s);
  const hero = h('section', { class: 'card hero-g', 'aria-labelledby': 'g-main' }, h('span', { class: 'screw l' }), h('span', { class: 'screw r' }),
    h('p', { class: 'kicker', text: 'PayAviator Gauge' }), gp.title, ...gp.head, gp.pager);

  const colR = h('div', { class: 'col-r' },
    h('section', { class: 'card cushion' }, h('div', { class: 'row-h' }, ib('shield'), h('div', null, h('h2', { text: 'Cushion' }), h('p', { class: 'muted', text: 'Money you protect. It is kept out of Safe to Spend.' }))),
      h('a', { class: 'cv', href: 'settings.html#cushion' }, h('b', { text: money(s.cushion) }), h('small', { text: 'Edit cushion' }), icon('pencil', 'ic sm'))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, ib('coins'), h('div', null, h('h2', { text: 'Next paycheck' }), h('p', { class: 'muted', text: pc ? `${pc.p.name} \u00b7 ${fmtShort(pc.iso)}` : 'No income added yet.' })), pc ? h('b', { class: 'pos nb', text: money(pc.a) }) : h('a', { class: 'more', href: 'income.html', text: 'Add income' }))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Next bills' }), h('a', { class: 'more', href: 'bills.html' }, 'All bills ', icon('chev'))),
      nb.length ? h('ul', { class: 'blist' }, nb.map((o) => { const [cls, txt] = dueTag(o.iso, today, false); return h('li', null, h('a', { class: 'rowl', href: 'bills.html' }, colorDot(o.bill.color), h('div', { class: 'bn' }, h('b', { text: o.bill.name }), h('small', { text: o.iso === today ? 'Today \u00b7 ' + fmtShort(o.iso) : fmtShort(o.iso) })), h('div', { class: 'amt' }, h('b', { text: money(o.amount - o.paid) }), h('span', { class: 'tag ' + cls, text: txt })))); }))
        : h('p', { class: 'muted', text: 'No unpaid bills coming up. Add a bill to see it here.' })));

  const cash = h('section', { class: 'card cg', 'aria-labelledby': 'g-cash' }, h('div', { class: 'row-h' }, ib('cash'), h('div', null, h('h2', { id: 'g-cash', text: 'Cash' }), h('p', { class: 'muted', text: s.source === 'bank' ? `${money(s.bankAvailable)} spendable in checking and cash` : `${money(s.available)} estimated (no bank linked)` }))),
    gaugeSVG(s.source === 'bank' ? s.bankAvailable : s.available, { main: false, label: 'Cash' }));
  const credit = h('section', { class: 'card cg', 'aria-labelledby': 'g-cr' }, h('div', { class: 'row-h' }, ib('card'), h('div', null, h('h2', { id: 'g-cr', text: 'Credit' }), h('p', { class: 'muted', text: acct.accounts.some((a) => String(a.type).toLowerCase() === 'credit') ? `${money(s.creditUsed)} balance used` : 'No credit card linked.' }))),
    gaugeSVG(s.creditUsed, { main: false, reverse: true, label: 'Credit used' }));

  const act = activityRows(tx.list, data.spending, null, acct.accounts, spendRange);
  const bodyId = 'g-act-body';
  const setOpen = (v) => { actOpen = v; try { sessionStorage.setItem('pa_act_open', v ? '1' : '0'); } catch (e) { /* private mode */ } render(main); };
  const activity = h('section', { class: 'card activity act-panel' + (actOpen ? ' open' : ''), 'aria-labelledby': 'g-act' },
    h('div', { class: 'row-h' },
      h('h2', { id: 'g-act', class: 'act-h' }, h('button', { type: 'button', class: 'act-toggle', 'data-act-toggle': '', 'aria-expanded': String(actOpen), 'aria-controls': bodyId, onclick: () => setOpen(!actOpen) }, h('span', { text: 'Recent activity' }), h('span', { class: 'act-count', 'data-act-count': '', text: String(act.length) + (act.length === 1 ? ' item' : ' items') }), icon('chev'))),
      h('a', { class: 'more', href: 'activity.html?range=' + spendRange }, 'View all ', icon('chev'))),
    h('div', { id: bodyId, class: 'act-body', hidden: actOpen ? null : '' }, rangeTabs(spendRange, (r) => { spendRange = r; render(main); }), actList(act, spendRange)));

  const spend = spendChart({ data, bank: tx.list, range: spendRange, mode: spendMode, onRange: (r) => { spendRange = r; render(main); }, onMode: (m) => { spendMode = m; render(main); } });
  const banners = [];
  if (pausedItems.length) banners.push(h('div', { class: 'banner warn', role: 'status' }, icon('pause'), h('p', null, h('b', { text: `${pausedItems.length} bank${pausedItems.length > 1 ? 's are' : ' is'} paused. ` }), 'Paused banks are left out of Safe to Spend until Plus is active again. ', h('a', { class: 'lnk', href: 'accounts.html', text: 'See Accounts' }))));
  if (acct.failed) banners.push(h('div', { class: 'banner', role: 'status' }, icon('alert'), h('p', null, 'Linked banks could not be loaded, so Safe to Spend uses your bills and income. ', h('button', { class: 'linkbtn lnk', type: 'button', text: 'Retry', onclick: loadAccounts }))));
  const empty = !data.bills.length && !data.income.length && !data.spending.length;
  main.replaceChildren(...banners,
    ...[empty ? h('div', { class: 'banner' }, icon('cloud'), h('p', null, h('b', { text: 'Nothing here yet. ' }), 'Add a bill or income, or sign in to the app so your data syncs here. ', h('a', { class: 'lnk', href: 'bills.html', text: 'Add a bill' }))) : null,
    h('div', { class: 'grid dash' }, hero, colR, cash, credit), spend, activity].filter(Boolean));
  if (gp.restore) gp.restore();
}

bootPage({ key: 'index.html', title: 'Home', sub: 'Your important numbers at a glance.', render: (m, sh) => render(m, sh) }).then((sh) => { if (sh) { rerender = () => render(sh.main); loadAccounts(); loadTx(); } });
