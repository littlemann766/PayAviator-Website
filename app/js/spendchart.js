/* Spending breakdown donut: same data logic as the Android app's renderSpendChart (index.html) -
 * periods Week (Sun start) / Month / Year, Categories or Merchants, top 5 + "Other", refunds reduce net only. */
import { h, money, toISO, num, txLogo, merchantMark } from './util.js';
import { billOccurrences, isFunds } from './calc.js';

export const SLICE_COLORS = ['#20c96b', '#27d7e8', '#f4d72c', '#ff8a24', '#ef4047', '#8b5cf6'];
const pfc = (x) => x.personal_finance_category || x.personalFinanceCategory || {};

export function bankClass(x) {
  const p = pfc(x), primary = String(p.primary || '').toUpperCase(), detailed = String(p.detailed || '').toUpperCase(), a = Number(x.amount) || 0;
  if (primary.includes('TRANSFER')) return 'transfer';
  if (primary.includes('INCOME')) return 'income';
  if (/LOAN_PAYMENTS|CREDIT_CARD_PAYMENT|TRANSFER/.test(detailed)) return 'transfer';
  if (a < 0 && /REFUND|REVERSAL|CASHBACK/.test(detailed)) return 'refund';
  if (a < 0) return 'inflow';
  return 'spend';
}
function bankSigned(x) { const c = bankClass(x), a = Number(x.amount) || 0; return c === 'spend' ? Math.max(0, a) : c === 'refund' ? -Math.abs(a) : 0; }
const manualSigned = (x) => (isFunds(x) ? -Math.abs(num(x.amount)) : Math.abs(num(x.amount)));
const signed = (x) => (x.kind === 'bill' ? x.amount : x.kind === 'bank' ? bankSigned(x) : manualSigned(x));

export function periodStart(range, now = new Date()) {
  if (range === 'week') { const s = new Date(now); s.setHours(0, 0, 0, 0); s.setDate(now.getDate() - now.getDay()); return s; }
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}
const at = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00');

/** Rows in the period: manual spending + paid bills + bank spend/refund transactions. */
export function spendRows(data, bank, range, now = new Date()) {
  const start = periodStart(range, now), rows = [];
  for (const x of data.spending || []) { const d = at(x.date); if (!isNaN(d) && d >= start && d <= now) rows.push({ ...x, kind: 'manual', _d: d }); }
  for (let y = start.getFullYear(), m = start.getMonth(); y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth()); m++) {
    if (m > 11) { m = 0; y++; if (y > now.getFullYear()) break; }
    for (const o of billOccurrences(data.bills || [], y, m)) {
      const paid = Math.min(o.paid, o.amount) || 0, d = at(o.iso);
      if (paid > 0 && d >= start && d <= now) rows.push({ kind: 'bill', id: o.id, name: o.bill.name || 'Bill', category: o.bill.category || '', amount: paid, _d: d });
    }
  }
  for (const t of bank || []) {
    const d = t.date ? at(t.date) : null; if (!d || isNaN(d) || d < start || d > now) continue;
    const x = { ...t, kind: 'bank', amount: Number(t.amount) || 0, _d: d, name: t.merchant_name || t.name || 'Bank transaction' };
    if (bankClass(x) === 'spend' || bankClass(x) === 'refund') rows.push(x);
  }
  return rows.sort((a, b) => b._d - a._d);
}
const titleCase = (s) => String(s).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function label(x, mode) {
  if (mode === 'location') {
    if (x.kind === 'bank') return String(x.merchant_name || x.name || 'Other / Unknown').trim() || 'Other / Unknown';
    return x.merchant || x.merchant_name || x.location || 'Other / Unknown';
  }
  if (x.kind === 'bill') return x.category || 'Bills';
  if (x.kind === 'bank') return titleCase(pfc(x).primary || (Array.isArray(x.category) ? x.category[0] : x.category) || 'Other');
  if (isFunds(x)) return 'Refunds & Funds';
  return x.category || 'Manual Spending';
}
/** -> { parts:[[label, amount, logo]], gross, net } */
export function breakdown(rows, mode) {
  const groups = new Map();
  for (const x of rows) {
    const v = signed(x); if (v <= 0) continue;
    const l = label(x, mode), k = String(l).trim().toLowerCase().replace(/\s+/g, ' ');
    const g = groups.get(k) || { label: l, amount: 0, logo: '' }; g.amount += v; if (!g.logo) g.logo = x.kind === 'bank' ? txLogo(x) : ''; groups.set(k, g);
  }
  let parts = [...groups.values()].map((o) => [o.label, o.amount, o.logo]).sort((a, b) => b[1] - a[1]);
  if (parts.length > 6) { const other = parts.slice(5).reduce((n, x) => n + x[1], 0); parts = parts.slice(0, 5); parts.push([mode === 'location' ? 'Other merchants' : 'Other categories', other, '']); }
  return { parts, gross: parts.reduce((n, x) => n + x[1], 0), net: rows.reduce((n, x) => n + signed(x), 0) };
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
const R = 76, C = 105, ptA = (t) => { const a = t * 2 * Math.PI; return [(C + R * Math.cos(a)).toFixed(3), (C + R * Math.sin(a)).toFixed(3)]; };

export function spendChart({ data, bank, range, mode, onRange, onMode }) {
  const rows = spendRows(data, bank, range), { parts, gross, net } = breakdown(rows, mode);
  const period = range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
  const g = svg('g', { transform: 'rotate(-90 105 105)' });
  g.append(svg('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: '#173c68', 'stroke-width': 34 }));
  const live = parts.map((x, i) => [x, i]).filter(([x]) => gross > 0 && x[1] > 0); let acc = 0;
  live.forEach(([[, val], i], j) => {
    const col = SLICE_COLORS[i % SLICE_COLORS.length];
    if (live.length === 1) { g.append(svg('circle', { 'data-slice': i, cx: C, cy: C, r: R, fill: 'none', stroke: col, 'stroke-width': 34 })); return; }
    const a0 = acc / gross; acc += val; const a1 = j === live.length - 1 ? 1 : acc / gross, A = ptA(a0), M = ptA((a0 + a1) / 2), B = ptA(a1);
    g.append(svg('path', { 'data-slice': i, d: `M ${A[0]} ${A[1]} A ${R} ${R} 0 0 1 ${M[0]} ${M[1]} A ${R} ${R} 0 0 1 ${B[0]} ${B[1]}`, fill: 'none', stroke: col, 'stroke-width': 34, 'stroke-linecap': 'butt' }));
  });
  const donutSvg = svg('svg', { viewBox: '0 0 210 210', role: 'img', 'aria-label': 'Spending breakdown' }); donutSvg.append(g);
  const legend = parts.map(([l, val, logo], i) => {
    const pct = gross ? Math.round((val / gross) * 100) : 0, col = SLICE_COLORS[i % SLICE_COLORS.length], letter = (String(l).trim()[0] || '?').toUpperCase();
    let marker = h('i'); marker.style.background = col;
    if (mode === 'location') {
      marker = merchantMark(l, logo, 'pp-spend-merchant-mark'); marker.style.borderColor = col;
    }
    return h('div', { class: 'pp-spend-legend-row' + (mode === 'location' ? ' merchant' : ''), 'data-legend': '' }, marker, h('span', { text: l }), h('b', null, money(val) + ' ', h('small', { text: pct + '%' })));
  });
  const tab = (key, text, cur, fn) => h('button', { type: 'button', class: cur === key ? 'active' : null, 'aria-pressed': String(cur === key), 'data-range': key === 'week' || key === 'month' || key === 'year' ? key : null, 'data-breakdown': key === 'category' || key === 'location' ? key : null, text, onclick: () => fn(key) });
  return h('section', { class: 'card spend-card', 'aria-labelledby': 'g-spend' },
    h('div', { class: 'row-h' }, h('h2', { id: 'g-spend', text: 'Spending breakdown' }), h('span', { class: 'sp-period', text: period })),
    h('div', { class: 'pp-spend-breakdown-toggle sp-range' }, tab('week', 'Week', range, onRange), tab('month', 'Month', range, onRange), tab('year', 'Year', range, onRange)),
    h('div', { class: 'pp-spend-breakdown-toggle' }, tab('category', 'Categories', mode, onMode), tab('location', 'Merchants', mode, onMode)),
    h('div', { class: 'pp-spend-donut-wrap' },
      h('div', { class: 'pp-spend-donut' }, donutSvg, h('div', { class: 'pp-spend-donut-center' }, h('b', { 'data-net': '', text: (net < 0 ? '+' : '') + money(Math.abs(net)) }), h('span', null, net < 0 ? 'Net Returned' : 'Net Spent', h('br'), period))),
      h('div', { class: 'pp-spend-legend' }, legend.length ? legend : h('div', { class: 'pp-spend-empty', text: 'No spending in this period.' }))));
}
