import { h, money, todayISO, fmtShort, num, txLogo, merchantMark } from './util.js';
import { openInfoSheet } from './ui.js';
import { isFunds } from './calc.js';
import { periodStart } from './spendchart.js';

const toIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const RANGES = [['week', 'Week'], ['month', 'Month'], ['year', 'Year']];
export const RANGE_WORD = { week: 'this week', month: 'this month', year: 'this year' };
export const normRange = (r) => (r === 'week' || r === 'month' || r === 'year' ? r : 'week');

/** Merge bank transactions (Plaid: positive = money out) with synced manual spending. Signed: spending < 0, income > 0. */
const tcase = (v) => String(v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function bankCategory(t) { const p = t.personal_finance_category || t.personalFinanceCategory || {}; return tcase(p.primary || (Array.isArray(t.category) ? t.category[0] : t.category) || 'Other'); }
/** n = max rows (null = all). range = 'week'|'month'|'year' keeps only rows from the start of that period (same Sunday/1st/Jan 1 starts as the Spending breakdown) up to today. */
export function activityRows(bank, spending, n = 10, accounts = [], range = null) {
  const rows = [];
  for (const t of bank || []) { const a = Number(t.amount); if (!t || !t.date || !Number.isFinite(a)) continue; rows.push({ key: 'b' + (t.transaction_id || rows.length), name: t.merchant_name || t.name || 'Bank transaction', date: String(t.date).slice(0, 10), amt: -a, pending: !!t.pending, src: t.institution_name || 'Bank', logo: txLogo(t), kind: 'bank', category: bankCategory(t), account: (() => { const a = accounts.find((x) => x.account_id === t.account_id || x.id === t.account_id); return a ? (a.name || a.official_name || 'Account') + (a.mask ? ' \u2022\u2022' + a.mask : '') : ''; })(), detailed: tcase((t.personal_finance_category || t.personalFinanceCategory || {}).detailed || ''), channel: tcase(t.payment_channel || ''), rawName: t.name || '', authorized: t.authorized_date || '' }); }
  for (const x of spending || []) { const a = Math.abs(num(x.amount)); if (!x.date) continue; rows.push({ key: 's' + x.id, name: x.name || 'Spending', date: String(x.date).slice(0, 10), amt: isFunds(x) ? a : -a, pending: false, src: 'Added by you', kind: 'manual', category: x.category || (isFunds(x) ? 'Refund / Funds' : 'Manual spending'), account: 'Entered by you', notes: x.notes || '' }); }
  const lo = range ? toIso(periodStart(range)) : '', hi = range ? todayISO() : '';
  const inR = rows.filter((r) => !range || (r.date >= lo && r.date <= hi));
  inR.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return n == null ? inR : inR.slice(0, n);
}

export function showAct(r) {
  const full = new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  openInfoSheet({ title: r.name, sub: (r.amt < 0 ? '\u2212' : '+') + money(Math.abs(r.amt)) + (r.kind === 'bank' ? (r.pending ? ' \u00b7 Pending' : ' \u00b7 Processed') : ''), rows: [
    ['Status', r.kind === 'bank' ? (r.pending ? 'Pending' : 'Processed') : 'Entered by you'], ['Date', full], ['Authorized', r.authorized ? new Date(r.authorized + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : ''],
    ['Category', r.category], ['Detail', r.detailed], ['Bank', r.kind === 'bank' ? r.src : ''], ['Account', r.account], ['Paid by', r.channel], ['Bank description', r.rawName && r.rawName !== r.name ? r.rawName : ''], ['Notes', r.notes || ''],
    ['Type', r.amt < 0 ? 'Money out' : 'Money in']] });
}


/** One activity row (tap/Enter opens the detail panel). */
export function actItem(r, todayIso) {
  return h('li', { 'data-act': '', tabindex: '0', role: 'button', 'aria-label': 'Details for ' + r.name, onclick: () => showAct(r), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAct(r); } } }, merchantMark(r.name, r.logo), h('div', { class: 'bn' }, h('b', { text: r.name }), h('small', { text: (r.date === todayIso ? 'Today' : fmtShort(r.date)) + ' \u00b7 ' + r.category + (r.kind === 'bank' ? (r.pending ? ' \u00b7 Pending' : ' \u00b7 Processed') : '') }), h('small', { class: 'act-sub', text: r.account && r.account !== r.src ? r.src + ' \u00b7 ' + r.account : r.src })),
    h('b', { class: 'amt ' + (r.amt < 0 ? 'neg' : 'pos'), text: (r.amt < 0 ? '\u2212' : '+') + money(Math.abs(r.amt)) }));
}
/** Week / Month / Year switch (same look as the Spending breakdown switch). */
export function rangeTabs(cur, onPick) {
  return h('div', { class: 'pp-spend-breakdown-toggle sp-range', role: 'group', 'aria-label': 'Activity range' }, RANGES.map(([k, t]) => h('button', { type: 'button', class: cur === k ? 'active' : null, 'aria-pressed': String(cur === k), 'data-act-range': k, text: t, onclick: () => onPick(k) })));
}
/** Scrollable list + empty text for a range. */
export function actList(rows, range, scroll = true) {
  const t = todayISO();
  return rows.length ? h('ul', { class: 'alist act-list' + (scroll ? ' act-scroll' : ''), 'data-activity': '', tabindex: scroll ? '0' : null, 'aria-label': 'Activity ' + RANGE_WORD[range] }, rows.map((r) => actItem(r, t)))
    : h('p', { class: 'muted', 'data-activity-empty': '', text: 'No activity ' + RANGE_WORD[range] + '. Connect a bank in the app or add spending to see activity.' });
}
