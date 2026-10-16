import { h, icon, money, fmtShort, num } from '../util.js';
import { bootPage } from '../ui.js';
import { api } from '../api.js';
import { acctKind, acctBal, acctIncluded, setAcctChoice, readCash, writeCash } from '../calc.js';
import { toast } from '../ui.js';
import { bar, emptyState } from '../views.js';
import { planKey, planInfo, planCard, paintHeadingBadge } from '../plans.js';

const S = { loading: true, err: null, accounts: [], items: [], errors: [], tx: [], billing: null };
let rerender = () => {};

async function load() {
  S.loading = true; S.err = null; rerender();
  const [a, t, b] = await Promise.allSettled([api.accounts(), api.transactions(250), api.billing()]);
  if (a.status === 'fulfilled') { S.accounts = a.value.accounts || []; S.items = a.value.items || []; S.errors = a.value.errors || []; } else S.err = a.reason;
  S.tx = t.status === 'fulfilled' ? (t.value.transactions || []) : [];
  S.billing = b.status === 'fulfilled' ? b.value : null;
  S.loading = false; rerender();
}

const bal = (a) => { const k = acctKind(a); return k === 'debt' ? { v: num(a.balance_used ?? a.balances?.current), sub: a.credit_limit ? `Balance used \u00b7 ${money(a.credit_limit)} limit` : 'Balance used' } : { v: acctBal(a), sub: acctIncluded(a) ? 'Included in Available Now' : (k === 'savings' ? 'Protected savings' : 'Not included') }; };
const aIcon = (a) => { const k = acctKind(a); return k === 'debt' ? 'card' : k === 'savings' ? 'shield' : 'bank'; };

function group() {
  const by = new Map();
  for (const it of S.items) by.set(it.item_id, { item: it, accounts: [] });
  for (const a of S.accounts) { if (!by.has(a.item_id)) by.set(a.item_id, { item: { item_id: a.item_id, institution_name: a.institution_name }, accounts: [] }); by.get(a.item_id).accounts.push(a); }
  return [...by.values()];
}

function itemCard({ item, accounts }) {
  const paused = !!item.paused || S.errors.some((e) => e.item_id === item.item_id && (e.code === 'ITEM_PAUSED' || e.paused));
  const err = S.errors.find((e) => e.item_id === item.item_id && !e.paused && e.code !== 'ITEM_PAUSED');
  const name = item.institution_name || 'Connected institution';
  const tag = paused ? h('span', { class: 'tag paused', text: 'Paused' }) : err ? h('span', { class: 'tag warn', text: err.needs_update ? 'Needs reconnect' : 'Unavailable' }) : h('span', { class: 'tag ok', text: 'Connected' });
  return h('section', { class: 'card' + (paused ? ' paused-card' : ''), 'data-item': item.item_id, 'data-paused': paused ? '1' : '0' },
    h('div', { class: 'row-h' }, h('span', { class: 'ib' }, icon(paused ? 'pause' : 'bank')), h('div', null, h('h2', { text: name }), h('p', { class: 'muted' }, tag))),
    paused ? h('p', { class: 'muted', role: 'status', text: 'This bank is paused until Plus is active again. It is left out of Safe to Spend and its balances are not refreshed. Your oldest bank stays active on the free plan.' })
      : err ? h('p', { class: 'muted', role: 'status', text: err.needs_update ? 'Reconnect this bank in the Android app to refresh its balance.' : (err.message || 'A fresh balance is temporarily unavailable.') }) : null,
    !paused && accounts.length ? h('ul', { class: 'alist' }, accounts.map((a) => { const b = bal(a); return h('li', null, h('span', { class: 'ib' }, icon(aIcon(a))), h('div', { class: 'bn' }, h('b', { text: a.name || a.official_name || 'Account' }), h('small', { text: a.mask ? '\u2022\u2022' + a.mask : '' })), h('div', { class: 'amt' }, h('b', { text: money(b.v) }), h('small', { text: b.sub }), acctKind(a) === 'debt' || String(a.type || '').toLowerCase() !== 'depository' ? null : h('button', { class: 'linkbtn lnk', type: 'button', 'data-toggle-acct': String(a.id || a.account_id || ''), text: acctIncluded(a) ? 'Exclude from Available Now' : 'Include in Available Now', onclick: () => { setAcctChoice(a, !acctIncluded(a)); rerender(); } }))); })) : null,
    paused ? h('p', { class: 's-note', text: 'You can disconnect a paused bank in the Android app.' }) : null);
}

function cashCard() {
  const w = readCash();
  const inp = h('input', { id: 'cash-spendable', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: w.spendable ? String(w.spendable) : '' });
  return h('section', { class: 'card', 'data-cash': '' },
    h('div', { class: 'row-h' }, h('span', { class: 'ib' }, icon('cash')), h('div', null, h('h2', { text: 'Cash' }), h('p', { class: 'muted', text: 'Physical cash only.' }))),
    h('label', { for: 'cash-spendable', text: 'Spendable cash' }), h('p', { class: 'muted', text: 'Counts toward Available Now and Safe to Spend.' }), inp,
    h('div', { class: 'dlg-f' }, h('button', { class: 'btn primary', type: 'button', 'data-save-cash': '', text: 'Save', onclick: () => { writeCash(inp.value); toast('Cash saved on this device.'); rerender(); } })));
}

function render(main) {
  const groups = group(), bl = S.billing;
  const paused = groups.filter((g) => g.item.paused || S.errors.some((e) => e.item_id === g.item.item_id && (e.code === 'ITEM_PAUSED' || e.paused))).length;
  const pk = planKey(bl), special = pk === 'founder' || pk === 'elite';
  const planName = pk === 'plus' ? 'Plus' : special ? planInfo(bl).title : 'Free';
  paintHeadingBadge(bl);
  const linked = bl ? num(bl.linkedBanks) : groups.length - paused;
  const limit = bl && bl.limit != null ? num(bl.limit) : (bl ? null : 1);
  const pausedN = bl ? num(bl.pausedBanks) : paused;

  const left = [cashCard()];
  if (S.loading) left.push(h('section', { class: 'card', 'aria-busy': 'true' }, h('p', { class: 'muted', text: 'Loading your linked banks\u2026' })));
  else if (S.err) left.push(h('section', { class: 'card', role: 'alert' }, h('div', { class: 'row-h' }, h('span', { class: 'ib' }, icon('alert')), h('div', null, h('h2', { text: 'Could not load banks' }), h('p', { class: 'muted', text: S.err.code === 'NETWORK' ? 'Can\u2019t reach PayAviator right now.' : (S.err.message || 'Please try again.') }))), h('button', { class: 'btn ghost', type: 'button', onclick: load }, icon('refresh'), h('span', { text: 'Try again' }))));
  else if (!groups.length) left.push(emptyState({ icn: 'bank', title: 'No banks linked yet', text: 'Link a bank in the PayAviator Android app. It will show up here, read-only.' }));
  else groups.forEach((g) => left.push(itemCard(g)));
  if (!S.loading && !S.err && S.tx.length) left.push(h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Recent bank activity' })), h('ul', { class: 'alist' }, S.tx.slice(0, 8).map((t) => h('li', null, h('div', { class: 'bn' }, h('b', { text: t.merchant_name || t.name || 'Transaction' }), h('small', { text: `${fmtShort(t.date)}${t.institution_name ? ' \u00b7 ' + t.institution_name : ''}` })), h('div', { class: 'amt' }, h('b', { class: num(t.amount) < 0 ? 'pos' : '', text: (num(t.amount) < 0 ? '+' : '') + money(Math.abs(num(t.amount))) }), t.pending ? h('span', { class: 'tag warn', text: 'Pending' }) : null))))));

  const pct = limit ? Math.min(100, linked / limit * 100) : 100;
  const plan = special ? planCard(bl) : h('section', { class: 'card plan' }, h('p', { class: 'kicker l', text: 'Your plan' }), h('h2', { 'data-plan': '', text: planName }),
    limit ? h('div', { class: 'meter' }, bar(pct, 'of linked banks used', true), h('p', null, h('b', { text: `${linked} of ${limit}` }), ' linked bank used')) : h('p', { class: 'muted', text: `${linked} linked bank${linked === 1 ? '' : 's'}, no limit.` }),
    pausedN > 0 ? h('div', { class: 'banner warn', role: 'status', 'data-paused-banner': '' }, icon('pause'), h('p', null, h('b', { text: `${pausedN} bank${pausedN > 1 ? 's are' : ' is'} paused. ` }), 'They resume on their own when Plus is active again.')) : null,
    h('p', { class: 'muted', text: 'Available Now counts your checking accounts and cash on hand. Savings, money market, CDs, credit cards, loans and investments are not counted unless you include a savings account yourself. Use Include / Exclude to change which accounts count.' }),
    h('ul', { class: 'ticks' }, ['Safe to Spend gauge on web and Android', 'Bills, income and budget synced both ways'].map((t) => h('li', null, icon('check'), h('span', { text: t })))));
  const plus = h('section', { class: 'card plus' }, h('div', { class: 'row-h' }, h('span', { class: 'ib' }, icon('lock')), h('div', null, h('h2', { text: 'More banks with Plus' }), h('p', { class: 'muted', text: 'Link several banks and cards in one view.' }))), h('p', { class: 'soon', text: 'Plus is coming soon.' }));

  main.replaceChildren(h('div', { class: 'banner' }, icon('eye'), h('p', null, h('b', { text: 'Linked banks are read-only on the web. ' }), 'Connect or remove a bank in the Android app. Bills, income and budget are editable here.')),
    h('div', { class: 'grid two' }, h('div', { class: 'col-r' }, left), h('div', { class: 'col-r' }, special ? [plan] : [plan, plus])));
}
bootPage({ key: 'accounts.html', title: 'Connected Accounts', sub: 'Your linked banks and plan.', render: (m) => render(m) }).then((sh) => { if (sh) { rerender = () => render(sh.main); load(); } });
