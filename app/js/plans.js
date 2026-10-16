/* Plan tiers shown in the web app. Single source of truth for Founder / Aviator Elite / Plus / Free.
 * Data comes from GET /api/billing/status:
 *   - Backend today: plan 'comp' + source 'comp' (COMP_FIREBASE_UIDS). That is shown as Aviator Elite.
 *   - Founder is shown only when the backend says so: tier 'founder' (preferred), or plan/source 'founder'.
 *     (CLIENT-SIDE FALLBACK: none by identity. No email or uid is hardcoded here. Until the backend sends
 *      tier 'founder', the owner account shows as Aviator Elite.)
 */
import { h } from './util.js';
const SVGNS = 'http://www.w3.org/2000/svg';
const PATHS = {
  star: 'M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z',
  crown: 'M3 8l5 4 4-7 4 7 5-4-2 11H5z',
};
function glyph(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'currentColor'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.setAttribute('class', 'pg');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', PATHS[name]); s.appendChild(p);
  return s;
}
const T = (v) => String(v == null ? '' : v).toLowerCase();

export function planKey(b) {
  if (!b) return 'free';
  const t = T(b.tier), p = T(b.plan), s = T(b.source);
  if (t === 'founder' || p === 'founder' || s === 'founder') return 'founder';
  if (t === 'elite' || p === 'elite' || s === 'elite' || p === 'comp' || s === 'comp') return 'elite';
  if (p === 'premium') return 'plus';
  return 'free';
}
export const isSpecial = (b) => { const k = planKey(b); return k === 'founder' || k === 'elite'; };
export const PLANS = {
  elite: { key: 'elite', name: 'Aviator Elite', sub: 'Complimentary', title: 'Aviator Elite - Complimentary', msg: 'Thank you for helping us test PayAviator.', banks: 'Unlimited while testing', icon: 'star' },
  founder: { key: 'founder', name: 'Founder', sub: 'Free forever', title: 'Founder - Free forever', msg: 'Every feature included.', banks: 'No limit', icon: 'crown' },
};
export const planInfo = (b) => PLANS[planKey(b)] || null;

/** Founder = outlined pill (style A). Aviator Elite = round seal (style B). Returns null for Free / Plus. */
export function planBadge(b) {
  const p = planInfo(b); if (!p) return null;
  if (p.key === 'founder') return h('span', { class: 'pbadge pill founder', 'data-plan-badge': 'founder', title: p.title }, glyph('crown'), h('span', { text: p.name }));
  return h('span', { class: 'pbadge seal elite', 'data-plan-badge': 'elite', title: p.title }, h('i', null, glyph('star')), h('span', { text: p.name }));
}
/** The "Your plan" card for Founder / Elite (null otherwise). */
export function planCard(b) {
  const p = planInfo(b); if (!p) return null;
  return h('section', { class: 'card plan-special ' + p.key, 'data-plan-card': p.key }, h('p', { class: 'kicker l', text: 'Your plan' }), h('div', { class: 'pc-badge' }, planBadge(b)), h('h2', { 'data-plan': '', text: p.title }), h('p', { class: 'muted', text: p.msg }), h('p', { class: 'pc-banks' }, 'Linked banks: ', h('b', { 'data-banks': '', text: p.banks })));
}
/** Put the badge next to the page heading (h1). Safe to call repeatedly. */
export function paintHeadingBadge(b) {
  const h1 = document.querySelector('.ttl h1'); if (!h1) return;
  h1.querySelectorAll('[data-plan-badge]').forEach((n) => n.remove());
  const bd = planBadge(b); if (bd) h1.appendChild(bd);
}
