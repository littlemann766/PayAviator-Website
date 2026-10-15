import { h, icon, money, todayISO, fmtShort, toISO, num } from '../util.js';
import { bootPage } from '../ui.js';
import { api } from '../api.js';
import { safeToSpend, billOccurrences, incomeOnDate, incomeAmountOn, isFunds } from '../calc.js';
import { gaugeSVG } from '../gauge.js';
import { spendChart } from '../spendchart.js';
import { colorDot, dueTag, emptyState } from '../views.js';

let acct = { loaded: false, accounts: [], items: [], errors: [], failed: false };
let tx = { loaded: false, list: [], failed: false };
let spendRange = 'week', spendMode = 'category';
let rerender = () => {};

async function loadTx() {
  try { const r = await api.transactions(50); tx = { loaded: true, list: Array.isArray(r.transactions) ? r.transactions : [], failed: false }; }
  catch (e) { tx = { loaded: true, list: [], failed: true }; }
  rerender();
}

/** Merge bank transactions (Plaid: positive = money out) with synced manual spending. Signed: spending < 0, income > 0. */
export function activityRows(bank, spending, n = 10) {
  const rows = [];
  for (const t of bank || []) { const a = Number(t.amount); if (!t || !t.date || !Number.isFinite(a)) continue; rows.push({ key: 'b' + (t.transaction_id || rows.length), name: t.merchant_name || t.name || 'Bank transaction', date: String(t.date).slice(0, 10), amt: -a, pending: !!t.pending, src: t.institution_name || 'Bank' }); }
  for (const x of spending || []) { const a = Math.abs(num(x.amount)); if (!x.date) continue; rows.push({ key: 's' + x.id, name: x.name || 'Spending', date: String(x.date).slice(0, 10), amt: isFunds(x) ? a : -a, pending: false, src: 'Added by you' }); }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key)).slice(0, n);
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

function render(main) {
  const data = api.data(), s = safeToSpend(data, acct.accounts);
  const pausedItems = acct.items.filter((i) => i.paused);
  const pc = nextPaycheck(data.income), nb = nextBills(data.bills), today = todayISO();

  const hero = h('section', { class: 'card hero-g', 'aria-labelledby': 'g-main' }, h('span', { class: 'screw l' }), h('span', { class: 'screw r' }),
    h('p', { class: 'kicker', text: 'PayAviator Gauge' }), h('h2', { id: 'g-main', text: 'All Spendable' }),
    gaugeSVG(s.safe, { main: true, label: 'Safe to spend' }),
    h('div', { class: 'safe' }, h('b', { class: 'big', 'data-safe': '', text: money(s.safe) }), h('span', { text: 'Safe to spend' })),
    s.safe > 0 ? h('p', { class: 'ontrack', text: 'On track: this is what you can spend after bills and the money you protect.' })
      : h('p', { class: 'ontrack warn', text: 'Nothing is safe to spend right now after bills and the money you protect.' }),
    h('dl', { class: 'metrics' },
      h('div', null, h('dt', { text: 'Available now' }), h('dd', { 'data-available': '', text: money(s.available) })),
      h('div', null, h('dt', { text: 'Savings' }), h('dd', { text: money(s.savings) })),
      h('div', null, h('dt', { text: 'Cushion' }), h('dd', { text: money(s.cushion) }))),
    s.source === 'ledger' ? h('p', { class: 'mini-note', text: 'No bank linked: estimated from your income, bills and spending this month.' }) : null);

  const colR = h('div', { class: 'col-r' },
    h('section', { class: 'card cushion' }, h('div', { class: 'row-h' }, ib('shield'), h('div', null, h('h2', { text: 'Cushion' }), h('p', { class: 'muted', text: 'Money you protect. It is kept out of Safe to Spend.' }))),
      h('a', { class: 'cv', href: 'settings.html#cushion' }, h('b', { text: money(s.cushion) }), h('small', { text: 'Edit cushion' }), icon('pencil', 'ic sm'))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, ib('coins'), h('div', null, h('h2', { text: 'Next paycheck' }), h('p', { class: 'muted', text: pc ? `${pc.p.name} \u00b7 ${fmtShort(pc.iso)}` : 'No income added yet.' })), pc ? h('b', { class: 'pos nb', text: money(pc.a) }) : h('a', { class: 'more', href: 'income.html', text: 'Add income' }))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Next bills' }), h('a', { class: 'more', href: 'bills.html' }, 'All bills ', icon('chev'))),
      nb.length ? h('ul', { class: 'blist' }, nb.map((o) => { const [cls, txt] = dueTag(o.iso, today, false); return h('li', null, h('a', { class: 'rowl', href: 'bills.html' }, colorDot(o.bill.color), h('div', { class: 'bn' }, h('b', { text: o.bill.name }), h('small', { text: o.iso === today ? 'Today \u00b7 ' + fmtShort(o.iso) : fmtShort(o.iso) })), h('div', { class: 'amt' }, h('b', { text: money(o.amount - o.paid) }), h('span', { class: 'tag ' + cls, text: txt })))); }))
        : h('p', { class: 'muted', text: 'No unpaid bills coming up. Add a bill to see it here.' })));

  const cash = h('section', { class: 'card cg', 'aria-labelledby': 'g-cash' }, h('div', { class: 'row-h' }, ib('cash'), h('div', null, h('h2', { id: 'g-cash', text: 'Cash' }), h('p', { class: 'muted', text: s.source === 'bank' ? `${money(s.bankAvailable)} spendable in linked accounts` : `${money(s.available)} estimated (no bank linked)` }))),
    gaugeSVG(s.source === 'bank' ? s.bankAvailable : s.available, { main: false, label: 'Cash' }));
  const credit = h('section', { class: 'card cg', 'aria-labelledby': 'g-cr' }, h('div', { class: 'row-h' }, ib('card'), h('div', null, h('h2', { id: 'g-cr', text: 'Credit' }), h('p', { class: 'muted', text: acct.accounts.some((a) => String(a.type).toLowerCase() === 'credit') ? `${money(s.creditUsed)} balance used` : 'No credit card linked.' }))),
    gaugeSVG(s.creditUsed, { main: false, reverse: true, label: 'Credit used' }));

  const act = activityRows(tx.list, data.spending), todayIso = todayISO();
  const activity = h('section', { class: 'card activity', 'aria-labelledby': 'g-act' },
    h('div', { class: 'row-h' }, h('h2', { id: 'g-act', text: 'Recent activity' }), h('a', { class: 'more', href: 'budget.html' }, 'View all ', icon('chev'))),
    act.length ? h('ul', { class: 'alist act-list', 'data-activity': '' }, act.map((r) => h('li', { 'data-act': '' }, h('div', { class: 'bn' }, h('b', { text: r.name }), h('small', { text: (r.date === todayIso ? 'Today' : fmtShort(r.date)) + ' \u00b7 ' + r.src + (r.pending ? ' \u00b7 Pending' : '') })),
      h('b', { class: 'amt ' + (r.amt < 0 ? 'neg' : 'pos'), text: (r.amt < 0 ? '\u2212' : '+') + money(Math.abs(r.amt)) }))))
      : h('p', { class: 'muted', 'data-activity-empty': '', text: 'Connect a bank in the app or add spending to see activity.' }));

  const spend = spendChart({ data, bank: tx.list, range: spendRange, mode: spendMode, onRange: (r) => { spendRange = r; render(main); }, onMode: (m) => { spendMode = m; render(main); } });
  const banners = [];
  if (pausedItems.length) banners.push(h('div', { class: 'banner warn', role: 'status' }, icon('pause'), h('p', null, h('b', { text: `${pausedItems.length} bank${pausedItems.length > 1 ? 's are' : ' is'} paused. ` }), 'Paused banks are left out of Safe to Spend until Plus is active again. ', h('a', { class: 'lnk', href: 'accounts.html', text: 'See Accounts' }))));
  if (acct.failed) banners.push(h('div', { class: 'banner', role: 'status' }, icon('alert'), h('p', null, 'Linked banks could not be loaded, so Safe to Spend uses your bills and income. ', h('button', { class: 'linkbtn lnk', type: 'button', text: 'Retry', onclick: loadAccounts }))));
  const empty = !data.bills.length && !data.income.length && !data.spending.length;
  main.replaceChildren(...banners,
    ...[empty ? h('div', { class: 'banner' }, icon('cloud'), h('p', null, h('b', { text: 'Nothing here yet. ' }), 'Add a bill or income, or sign in to the app so your data syncs here. ', h('a', { class: 'lnk', href: 'bills.html', text: 'Add a bill' }))) : null,
    h('div', { class: 'grid dash' }, hero, colR, cash, credit), spend, activity].filter(Boolean));
}

bootPage({ key: 'index.html', title: 'Home', sub: 'Your important numbers at a glance.', render: (m, sh) => render(m, sh) }).then((sh) => { if (sh) { rerender = () => render(sh.main); loadAccounts(); loadTx(); } });
