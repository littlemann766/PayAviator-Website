/* App shell, toast, layers (side panel / full-screen sheet / confirm dialog) with focus trap, form builder, page boot + auth guard. */
import { h, icon, $, $$, num, parseMoney, isISO } from './util.js';
import { auth } from './auth.js';
import { api } from './api.js';

export const IDLE_MS = 30 * 60 * 1000; // idle sign-out for shared devices
const NAV = [['home', 'Home', 'index.html'], ['cal', 'Calendar', 'calendar.html'], ['bills', 'Bills', 'bills.html'], ['coins', 'Income', 'income.html'], ['pie', 'Budget', 'budget.html'], ['gear', 'Settings', 'settings.html']];

/* ---------------------------------------------------------------- toast */
let toastEl, toastT;
export function toast(msg, kind = 'ok') {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true }); document.body.append(toastEl); }
  toastEl.replaceChildren(icon(kind === 'ok' ? 'cloud' : 'alert'), h('span', { text: msg }));
  toastEl.classList.toggle('bad', kind !== 'ok');
  toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 4200);
}
export const savedToast = (res) => toast(res && res.queued ? 'Saved. Will sync to your phone when you are back online.' : 'Saved. Synced to your phone.', 'ok');

/* ---------------------------------------------------------------- layers */
const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function setInert(on) { const r = $('#root'); if (r) { r.inert = on; if (on) r.setAttribute('aria-hidden', 'true'); else r.removeAttribute('aria-hidden'); } }
function onKey(e) {
  const top = stack[stack.length - 1]; if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); top.close(); return; }
  if (e.key !== 'Tab') return;
  const f = $$(FOCUSABLE, top.node).filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || !top.node.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !top.node.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}
document.addEventListener('keydown', onKey, true);
export function openLayer(kind, content, { initialFocus, onClose } = {}) {
  const from = document.activeElement;
  const node = h('div', { class: 'layer' + (stack.length ? ' over' : ''), 'data-kind': kind });
  const scrim = h('div', { class: 'scrim' });
  node.append(scrim, content);
  document.body.append(node);
  document.body.classList.add('has-sheet'); setInert(true);
  const entry = { node, close() { if (!stack.includes(entry)) return; stack.splice(stack.indexOf(entry), 1); node.remove(); if (!stack.length) { document.body.classList.remove('has-sheet'); setInert(false); } if (from && from.isConnected && from.focus) from.focus(); onClose && onClose(); } };
  scrim.addEventListener('click', () => entry.close());
  stack.push(entry);
  const f = (initialFocus && initialFocus()) || $('input:not([type=radio]):not([type=checkbox]),select,textarea', content) || $('button.btn', content);
  if (f) f.focus();
  return entry;
}

export function confirmDialog({ title, text, confirmText = 'Confirm', danger = true, icn = 'alert' }) {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (done) return; done = true; entry.close(); resolve(v); };
    const cancel = h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => fin(false) });
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: confirmText, onclick: () => fin(true) });
    const dlg = h('section', { class: 'dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-t', 'aria-describedby': 'dlg-d' },
      h('span', { class: 'dlg-i' + (danger ? ' bad' : '') }, icon(icn)), h('h2', { id: 'dlg-t', text: title }), h('p', { id: 'dlg-d', text: text }), h('div', { class: 'dlg-f' }, cancel, ok));
    const entry = openLayer('dialog', dlg, { initialFocus: () => cancel, onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

/* ---------------------------------------------------------------- forms */
let fid = 0;
function buildField(spec, values) {
  const id = 'f' + (++fid) + '-' + spec.name, errId = id + '-e';
  const wrap = h('div', { class: 'fld' + (spec.type === 'switch' ? ' swrow' : ''), 'data-name': spec.name });
  let get, el;
  const err = h('p', { class: 'err', id: errId, hidden: true }, icon('alert', 'ic sm'), h('span'));
  const init = values[spec.name];
  const label = (txt) => h('label', { for: id }, txt, spec.optional ? h('em', null, ' (optional)') : null);
  if (spec.type === 'color') {
    // hex values = the app's bill colors ('#rrggbb'); a custom color already on the bill is kept as an extra swatch
    const colors = [['#3ddc97', 'Green'], ['#16e4ea', 'Cyan'], ['#fbbf24', 'Amber'], ['#e5484d', 'Red'], ['#a78bfa', 'Violet'], ['#7c98bd', 'Gray']];
    const cur = /^#[0-9a-fA-F]{6}$/.test(String(init)) ? String(init).toLowerCase() : '#3ddc97';
    if (!colors.some(([k]) => k === cur)) colors.push([cur, 'Current color']);
    const fs = h('fieldset', { class: 'fld', 'data-name': spec.name }, h('legend', { text: spec.label }));
    const sws = h('div', { class: 'sws' });
    colors.forEach(([k, n]) => { const sw = h('span', { class: 'swc' }); sw.style.background = k; sws.append(h('label', { class: 'sw' }, h('input', { type: 'radio', name: id, value: k, checked: cur === k }), sw, h('span', { class: 'sr', text: n }))); });
    fs.append(sws);
    return { node: fs, get: () => (fs.querySelector('input:checked') || {}).value || cur, validate: () => null, setErr() {} };
  }
  if (spec.type === 'switch') {
    el = h('input', { id, type: 'checkbox', role: 'switch', checked: !!init });
    wrap.append(h('div', null, h('label', { for: id, text: spec.label }), spec.hint ? h('p', { class: 'hint', text: spec.hint }) : null), h('label', { class: 'switch' }, el, h('span', { class: 'track' })));
    get = () => el.checked;
    return { node: wrap, get, validate: () => null, setErr() {} };
  }
  let inpWrap;
  if (spec.type === 'select') {
    el = h('select', { id, 'aria-describedby': errId }, spec.options.map((o) => h('option', { value: o.v, selected: String(init ?? spec.options[0].v) === String(o.v) }, o.label)));
    inpWrap = h('div', { class: 'inp sel' }, el, icon('chevd', 'ic sm'));
    get = () => el.value;
  } else if (spec.type === 'textarea') {
    el = h('textarea', { id, rows: 3, maxlength: spec.max || 500, 'aria-describedby': errId }); el.value = init || '';
    inpWrap = h('div', { class: 'inp' }, el); get = () => el.value.trim();
  } else if (spec.type === 'money') {
    el = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', 'aria-describedby': errId }); el.value = init != null && init !== '' ? String(init) : '';
    inpWrap = h('div', { class: 'inp has-pre' }, h('span', { class: 'pre', text: '$' }), el); get = () => el.value.trim();
  } else {
    el = h('input', { id, type: spec.type === 'date' ? 'date' : spec.type === 'number' ? 'text' : 'text', inputmode: spec.type === 'number' ? 'decimal' : null, maxlength: spec.max || 80, placeholder: spec.placeholder || '', autocomplete: 'off', 'aria-describedby': errId }); el.value = init != null ? String(init) : '';
    inpWrap = h('div', { class: 'inp' }, el); get = () => el.value.trim();
  }
  if (spec.required) el.setAttribute('aria-required', 'true');
  wrap.append(...[label(spec.label), inpWrap, spec.hint ? h('p', { class: 'hint', text: spec.hint }) : null, err].filter(Boolean));
  const setErr = (msg) => { wrap.classList.toggle('invalid', !!msg); err.hidden = !msg; err.querySelector('span').textContent = msg || ''; if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); };
  el.addEventListener('input', () => { if (wrap.classList.contains('invalid')) setErr(spec.validate ? spec.validate(get(), null) : null); });
  const validate = () => {
    const v = get();
    let msg = null;
    if (spec.required && (v === '' || v == null)) msg = spec.requiredMsg || 'This field is required.';
    else if (v !== '' && spec.type === 'money') { const n = parseMoney(v); if (!(n > 0) && !spec.allowZero) msg = 'Enter an amount greater than $0.00.'; else if (!(n >= 0)) msg = 'Enter a valid amount, like 25.00.'; else if (n > 1e9) msg = 'That amount is too large.'; }
    else if (v !== '' && spec.type === 'date' && !isISO(v)) msg = 'Enter a valid date.';
    else if (v !== '' && spec.type === 'number' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) msg = 'Enter a valid number.';
    if (!msg && spec.validate) msg = spec.validate(v, null);
    setErr(msg); return msg;
  };
  return { node: wrap, el, get: () => { const v = get(); return spec.type === 'money' ? (v === '' ? NaN : parseMoney(v)) : spec.type === 'number' ? (v === '' ? NaN : Number(v)) : v; }, validate, setErr };
}

/** Side panel on desktop, full-screen sheet on phones (CSS decides). onSubmit(values) -> Promise<{queued}|any>; throw to keep it open. */
export function openSheet({ title, sub, fields, values = {}, submitText = 'Save', onSubmit, onDelete, extra }) {
  const built = fields.map((f) => buildField(f, values));
  const tid = 'sheet-t' + (++fid);
  const submit = h('button', { class: 'btn primary', type: 'submit', text: submitText });
  const del = onDelete ? h('button', { class: 'btn danger-o', type: 'button', onclick: async () => { const ok = await onDelete(entry); void ok; } }, icon('trash'), h('span', { text: 'Delete' })) : null;
  const formErr = h('p', { class: 'err form-err', role: 'alert', hidden: true }, icon('alert', 'ic sm'), h('span'));
  const form = h('form', { novalidate: true, action: '#', onsubmit: async (e) => {
    e.preventDefault();
    let firstBad = null;
    built.forEach((b, i) => { const m = b.validate(); if (m && !firstBad) firstBad = b; });
    if (firstBad) { (firstBad.el || firstBad.node.querySelector('input')).focus(); return; }
    const vals = {}; fields.forEach((f, i) => { vals[f.name] = built[i].get(); });
    submit.disabled = true; formErr.hidden = true;
    try { const res = await onSubmit(vals, entry); entry.close(); savedToast(res); }
    catch (err) { submit.disabled = false; formErr.hidden = false; formErr.querySelector('span').textContent = (err && err.message) || 'Could not save. Please try again.'; }
  } },
    h('header', { class: 'sheet-h' }, h('div', null, h('h2', { id: tid, text: title }), sub ? h('p', { text: sub }) : null),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => entry.close() }, icon('x'))),
    h('div', { class: 'sheet-b' }, built.map((b) => b.node), extra || null, formErr),
    h('footer', { class: 'sheet-f' }, del, h('span', { class: 'sp' }), h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => entry.close() }), submit));
  const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid }, form);
  const entry = openLayer('sheet', sheet);
  return entry;
}

/** Read-only detail sheet (rows of [label, value]); same layer/focus-trap as the edit sheets. */
export function openInfoSheet({ title, sub, rows }) {
  const tid = 'info-t' + (++fid);
  const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'data-info-sheet': '' },
    h('header', { class: 'sheet-h' }, h('div', null, h('h2', { id: tid, text: title }), sub ? h('p', { text: sub }) : null), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => entry.close() }, icon('x'))),
    h('div', { class: 'sheet-b' }, h('dl', { class: 'info-dl' }, rows.filter((r) => r[1] !== '' && r[1] != null).map(([k, v]) => h('div', { class: 'info-row' }, h('dt', { text: k }), h('dd', { text: String(v) }))))),
    h('footer', { class: 'sheet-f' }, h('span', { class: 'sp' }), h('button', { class: 'btn ghost', type: 'button', text: 'Close', onclick: () => entry.close() })));
  const entry = openLayer('sheet', sheet, { initialFocus: () => sheet.querySelector('.btn') });
  return entry;
}

/* ---------------------------------------------------------------- shell + boot */
const SYNC_TXT = { idle: 'Starting\u2026', ok: 'Synced', busy: 'Syncing\u2026', off: 'Offline', error: 'Sync problem' };
function syncPill() {
  const el = h('span', { class: 'sync ok', role: 'status', 'data-sync': '' }, h('i', { class: 'sd', 'aria-hidden': 'true' }), h('span', { text: 'Synced' }));
  return el;
}
function paintSync() {
  const { status, pending } = api.status;
  $$('[data-sync]').forEach((el) => {
    el.className = 'sync ' + (status === 'busy' ? 'busy' : status === 'ok' ? 'ok' : status === 'idle' ? 'busy' : 'off');
    const t = status === 'off' && pending ? `Offline \u00b7 ${pending} waiting` : SYNC_TXT[status] || 'Synced';
    el.lastElementChild.textContent = t; el.dataset.sync = status;
  });
}

function navLinks(key, cls) {
  const cur = key === 'accounts.html' ? 'settings.html' : key; // Connected Accounts lives under Settings, like the app
  return NAV.map(([i, l, href]) => h('a', { href, class: href === cur ? 'on' : null, 'aria-current': href === cur ? 'page' : null }, icon(i), h('span', { text: l })));
}

function accountMenu() {
  const u = auth.user || {}, name = u.displayName || (u.email || 'You').split('@')[0];
  const menu = h('div', { class: 'menu', id: 'acct-menu', role: 'menu', hidden: true },
    h('div', { class: 'menu-h' }, h('b', { text: name }), h('small', { text: u.email || '' })),
    h('a', { role: 'menuitem', href: 'settings.html' }, icon('user'), h('span', { text: 'Profile and settings' })),
    h('a', { role: 'menuitem', href: 'accounts.html' }, icon('bank'), h('span', { text: 'Linked banks' })),
    h('a', { role: 'menuitem', href: '../index.html' }, icon('eye'), h('span', { text: 'Back to payaviator.app' })),
    h('a', { role: 'menuitem', href: 'mailto:support@payaviator.app' }, icon('mail'), h('span', { text: 'Support' })), h('hr'),
    h('button', { role: 'menuitem', class: 'mi', type: 'button', 'data-signout': '', onclick: signOutNow }, icon('logout'), h('span', { text: 'Sign out' })));
  const btn = h('button', { class: 'av-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'acct-menu', 'aria-label': 'Account menu' },
    h('span', { class: 'av' }, icon('user')), h('span', { class: 'av-t' }, h('b', { text: name }), h('small', { text: u.email || '' })), icon('chevd', 'ic sm'));
  const set = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(menu.hidden); if (!menu.hidden) { const f = menu.querySelector('a,button'); f && f.focus(); } });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden && !stack.length) { set(false); btn.focus(); } });
  return h('div', { class: 'acct' }, btn, menu);
}

export async function signOutNow() {
  api.clearLocal();
  await auth.signOut();
  location.replace('signin.html');
}

/** Builds the page chrome and returns { main, setHeader }. */
export function mountShell({ key, title, sub, actions }) {
  const root = $('#root');
  const u = auth.user;
  const side = h('aside', { class: 'side' },
    h('a', { class: 'brand', href: 'index.html' }, h('img', { src: 'img/logo-64.png', width: 36, height: 36, alt: '' }), h('span', { text: 'PayAviator' })),
    h('p', { class: 'side-cap', text: 'Menu' }), h('nav', { 'aria-label': 'Main' }, navLinks(key)),
    h('div', { class: 'side-foot' }, h('div', { class: 'plan-mini' }, h('b', { text: auth.demo ? 'Demo mode' : 'Signed in' }), h('small', { text: auth.demo ? 'Sample data, nothing is saved to your account.' : (u && u.email) || '' })), syncPill()));
  const main = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  const hd = h('div', { class: 'ttl' }, h('h1', { text: title }), h('p', { text: sub || '' }));
  const top = h('header', { class: 'top' }, h('div', { class: 'top-in' }, hd, h('div', { class: 'tools' }, syncPill(), accountMenu())));
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Main' }, navLinks(key));
  root.replaceChildren(h('a', { class: 'skip', href: '#main', text: 'Skip to content' }), side, h('div', { class: 'main' }, top, main), tabs);
  document.title = `${title} \u00b7 PayAviator`;
  paintSync();
  return { main, setHeader(t, s) { hd.firstChild.textContent = t; hd.lastChild.textContent = s || ''; } };
}

export function showFatal(title, text, retry) {
  const root = $('#root');
  root.replaceChildren(h('div', { class: 'fatal' }, h('div', { class: 'card empty' }, h('span', { class: 'e-i' }, icon('alert')), h('h2', { text: title }), h('p', { text }),
    retry ? h('button', { class: 'btn primary', type: 'button', text: 'Try again', onclick: retry }) : null, h('a', { class: 'btn ghost', href: 'mailto:support@payaviator.app', text: 'Contact support' }))));
}

let idleTimer;
function watchIdle() {
  let last = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => { last = Date.now(); }, { passive: true }));
  clearInterval(idleTimer);
  idleTimer = setInterval(() => { if (Date.now() - last > IDLE_MS) { clearInterval(idleTimer); signOutNow(); } }, 15000);
}

/** Boot a protected page: guard auth, init data layer, mount shell, render, re-render on data changes. */
export async function bootPage({ key, title, sub, render }) {
  await auth.init();
  if (auth.state === 'unavailable') { showFatal('Sign-in service unavailable', 'We could not load the sign-in service, so we cannot confirm who you are. Check your connection and try again. Your data is safe.', () => location.reload()); return; }
  if (!auth.user) { location.replace('signin.html'); return; }
  if (!auth.user.emailVerified) { location.replace('signin.html?verify=1'); return; }
  auth.onChange((u) => { if (!u) location.replace('signin.html'); });
  const shell = mountShell({ key, title, sub });
  try { await api.init({ uid: auth.user.uid, getToken: (f) => auth.getToken(f), demo: auth.demo }); } catch (e) { /* status shows the error */ }
  let authRetry = false;
  const paint = () => { try { render(shell.main, shell); } catch (e) { console.error(e); } };
  api.subscribe(async (ev) => {
    if (ev.type === 'status') paintSync();
    if (ev.type === 'data') { paintSync(); if (ev.source !== 'clear') paint(); }
    if (ev.type === 'conflict') toast('Updated on your phone. Showing the newest version.', 'warn');
    if (ev.type === 'rejected') toast('One change could not be saved (' + (ev.reason || 'rejected') + ').', 'warn');
    if (ev.type === 'auth') {
      if (!authRetry) { authRetry = true; try { await auth.checkVerified(); await api.sync(); } catch (e) { /* fall through */ } authRetry = false; }
      if (api.status.status === 'error' && api.status.error && api.status.error.code === 'EMAIL_NOT_VERIFIED') location.replace('signin.html?verify=1');
    }
  });
  paintSync(); paint(); watchIdle();
  return shell;
}
export { num };
