/* Small DOM + formatting helpers. No innerHTML anywhere with dynamic data: text goes through text nodes. */
const SVGNS = 'http://www.w3.org/2000/svg';

export const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  bills: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15 9.2a6 6 0 1 1-5.8 5.8"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 12h.01M17.5 12h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1 .5 7.5z"/><path d="M9.5 13.5l2 2 3.5-3.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  doc: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
};

export function icon(name, cls = 'ic') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.5');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICONS[name] || ''; // constant strings only
  return s;
}

/** h('div', {class:'x', 'data-a':1}, child, 'text', [more]) - text is always a text node (never parsed as HTML). */
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const cents = (v) => Math.round(num(v) * 100) / 100;

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => fmt.format(cents(n));
/** Compact label used on gauge scales: $0, $250, $2.5k, $12k, $1.2M */
export function short(n) {
  n = num(n);
  if (n < 0) return '\u2212' + short(-n);
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10000) return '$' + (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '$' + Math.round(n);
}
export function parseMoney(v) {
  const s = String(v ?? '').trim().replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return NaN;
  return Number(s);
}

/* Dates are local calendar dates, as 'YYYY-MM-DD' (the same format the Android app stores). */
export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (iso) => new Date(iso + 'T00:00:00');
export const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && toISO(fromISO(s)) === s;
export const monthKey = (y, m) => `${y}-${pad(m + 1)}`;
export const todayISO = () => toISO(new Date());
export const fmtDay = (iso) => fromISO(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const fmtShort = (iso) => fromISO(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtMonth = (y, m) => new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
export const daysBetween = (aISO, bISO) => Math.round((fromISO(bISO) - fromISO(aISO)) / 86400000);

export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* Merchant marks, same order as the app: Plaid logo_url -> known-merchant favicon -> letter badge. */
const MERCHANT_DOMAINS = [[/united dairy farmers|\budf\b/i, 'udfinc.com'], [/geico/i, 'geico.com'], [/chipotle/i, 'chipotle.com'], [/runway/i, 'runway.com'], [/gettysburg marketplace/i, 'gettysburgmarketplace.com'], [/capital one/i, 'capitalone.com'], [/starbucks/i, 'starbucks.com'], [/mcdonald/i, 'mcdonalds.com'], [/kroger/i, 'kroger.com'], [/walmart/i, 'walmart.com'], [/target/i, 'target.com'], [/amazon/i, 'amazon.com'], [/speedway/i, 'speedway.com'], [/shell/i, 'shell.com'], [/netflix/i, 'netflix.com'], [/spotify/i, 'spotify.com'], [/pnc/i, 'pnc.com']];
export const txLogo = (x) => (x && (x.logo_url || x.logoUrl || x.merchant_logo_url || x.merchantLogoUrl || (x.counterparties && x.counterparties.find && (x.counterparties.find((c) => c && c.logo_url) || {}).logo_url) || (x.counterparty && x.counterparty.logo_url))) || '';
export function merchantSrc(name, logo) {
  if (logo && /^https:\/\//.test(logo)) return logo;
  const hit = MERCHANT_DOMAINS.find(([re]) => re.test(String(name || '')));
  return hit ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hit[1]) + '&sz=64' : '';
}
export function merchantMark(name, logo, cls = 'pp-merchant-logo') {
  const letter = (String(name || '').trim()[0] || '?').toUpperCase(), src = merchantSrc(name, logo);
  const el = h('span', { class: cls + ' pp-merchant-fallback', 'data-merchant-mark': '', text: letter });
  if (src) {
    const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer';
    img.onload = () => { el.textContent = ''; el.append(img); el.classList.add('has-img'); };
    img.src = src;
  }
  return el;
}
