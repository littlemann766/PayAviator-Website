/* Shared view helpers */
import { h, icon, money, fmtMonth, monthKey } from './util.js';

export const DEFAULT_CATEGORIES = ['Utilities', 'Housing', 'Insurance', 'Subscriptions', 'Groceries', 'Dining out', 'Transport', 'Other'];

/** Month being viewed; shared by Bills, Income and Budget for the tab session. */
const vm = (() => { const n = new Date(); let y = n.getFullYear(), m = n.getMonth(); try { const s = sessionStorage.getItem('pa_view_month'); if (/^\d{4}-\d{2}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(5) - 1; } } catch (e) { /* ignore */ } return { y, m }; })();
export const viewMonth = () => ({ ...vm });
export function shiftMonth(d) { const x = new Date(vm.y, vm.m + d, 1); vm.y = x.getFullYear(); vm.m = x.getMonth(); try { sessionStorage.setItem('pa_view_month', monthKey(vm.y, vm.m)); } catch (e) { /* ignore */ } }

export function monthNav(onChange) {
  const go = (d) => () => { shiftMonth(d); onChange(); };
  return h('div', { class: 'mnav' },
    h('button', { class: 'btn sm ghost icon-only', type: 'button', 'aria-label': 'Previous month', onclick: go(-1) }, icon('chev', 'ic flip')),
    h('p', { class: 'tb-t', 'aria-live': 'polite', 'data-month': monthKey(vm.y, vm.m), text: fmtMonth(vm.y, vm.m) }),
    h('button', { class: 'btn sm ghost icon-only', type: 'button', 'aria-label': 'Next month', onclick: go(1) }, icon('chev')));
}
export const stat = (label, value, cls, id) => h('div', { class: 'card stat' }, h('small', { text: label }), h('b', { class: cls || null, 'data-stat': id || null, text: value }));
export const barClass = (pct) => (pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok');
export const wClass = (pct) => 'w' + Math.max(0, Math.min(100, Math.round(pct)));
export function bar(pct, label, neutral) { return h('div', { class: 'bar ' + (neutral ? 'ok' : barClass(pct)), role: 'img', 'aria-label': `${Math.round(pct)} percent ${label || 'used'}` }, h('i', { class: wClass(pct) })); }
/** Bill color dot. The app stores colors as '#rrggbb'; set through CSSOM (allowed by CSP style-src 'self'; no inline style attribute). */
export function colorDot(color, extra) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : null;
  const e = h('span', { class: 'dot ' + (hex ? '' : (DOT[color] || 'd-grn')) + (extra ? ' ' + extra : ''), 'aria-hidden': 'true' });
  if (hex) e.style.background = hex;
  return e;
}
export const DOT = { red: 'd-red', amber: 'd-amb', green: 'd-grn', gray: 'd-gry', cyan: 'd-cyn', violet: 'd-vio' };
export function emptyState({ icn, title, text, action }) {
  return h('section', { class: 'card empty' }, h('span', { class: 'e-i' }, icon(icn)), h('h2', { text: title }), h('p', { text }), action || null);
}
export function dueTag(iso, today, paid) {
  if (paid) return ['paid', 'Paid'];
  const d = Math.round((new Date(iso + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (d < 0) return ['bad', 'Overdue'];
  if (d === 0) return ['warn', 'Due today'];
  if (d === 1) return ['warn', 'Tomorrow'];
  return ['ok', `In ${d} days`];
}
export { money };
