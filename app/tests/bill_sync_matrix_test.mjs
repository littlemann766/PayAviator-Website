// Per-field two-way BILL sync matrix: every bill field/occurrence state edited on the phone (real app sync client) shows on the web (real api.js/codec/calc)
// and vice versa, through the real backend. Test data only. Usage: node app/tests/bill_sync_matrix_test.mjs [/path/to/app/index.html] [/path/to/PayAviator-Backend]
// Usage: node app/tests/roundtrip_test.mjs [/path/to/app/index.html] [/path/to/PayAviator-Backend]
import http from 'node:http'; import vm from 'node:vm'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WEB = path.resolve(HERE, '..');
const APP_HTML = process.argv[2] || '/workspace/pa-420/wt-sync/index.html', BE = process.argv[3] || '/workspace/PayAviator-Backend';
if (!fs.existsSync(APP_HTML) || !fs.existsSync(BE + '/node_modules')) { console.log('SKIP: app html or backend not found'); process.exit(0); }
let pass = 0; const fails = [];
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fails.push(n); console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function canon(v) { if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])); return v; }

/* ---- real backend ---- */
const { buildApp, JWT_SECRET } = await import(`${BE}/test/helpers.js`);
const { SignJWT } = await import(`${BE}/node_modules/jose/dist/webapi/index.js`);
const { app } = buildApp();
const tok = (sub) => new SignJWT({ email_verified: true }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(JWT_SECRET));
const server = http.createServer((req, res) => app(req, res)).listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
const BASE = 'http://127.0.0.1:' + server.address().port, UID = 'rt-user';
const TOKEN = await tok(UID);
async function srv(method, p, body) { const r = await fetch(BASE + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }

/* ---- the phone: app sync client in a vm ---- */
function makePhone() {
  const store = new Map();
  class Storage { getItem(k) { return store.has(k) ? store.get(k) : null; } setItem(k, v) { store.set(k, String(v)); } removeItem(k) { store.delete(k); } get length() { return store.size; } key(i) { return [...store.keys()][i] ?? null; } }
  const sb = { console, JSON, Math, Date, Promise, Number, String, Object, Array, Map, Set, Error, Intl, Storage, encodeURIComponent, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
  sb.window = sb; sb.localStorage = new Storage(); sb.navigator = { onLine: true };
  sb.document = { visibilityState: 'visible', addEventListener() {}, dispatchEvent() {} }; sb.addEventListener = () => {}; sb.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
  sb.PayAviatorAuth = { isSignedIn: () => true, getState: () => ({ uid: UID, email: 'a@b.c', emailVerified: true }) };
  sb.PayAviatorBankApi = async (p, opt = {}) => { const r = await fetch(BASE + p, { method: opt.method || 'GET', headers: { Authorization: 'Bearer ' + TOKEN, ...(opt.headers || {}) }, body: opt.body }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'http ' + r.status), { status: r.status, code: j.code }); return j; };
  vm.createContext(sb);
  const html = fs.readFileSync(APP_HTML, 'utf8'), a = html.indexOf('<script id="pa414-cloud-sync">'), b = html.indexOf('</script>', a);
  vm.runInContext(html.slice(a + '<script id="pa414-cloud-sync">'.length, b), sb);
  const ls = (k, d) => { const v = store.get(k); return v == null ? d : JSON.parse(v); };
  return { sb, store, ls, set: (k, v) => sb.localStorage.setItem(k, JSON.stringify(v)), sync: () => sb.PayAviatorSync.sync('manual'), status: () => sb.PayAviatorSync.status() };
}

/* ---- the web: real api.js in Node with tiny DOM shims, fetch redirected to the local backend ---- */
const g = globalThis; const wstore = new Map();
g.localStorage = { getItem: (k) => (wstore.has(k) ? wstore.get(k) : null), setItem: (k, v) => wstore.set(k, String(v)), removeItem: (k) => wstore.delete(k) };
g.addEventListener = () => {}; g.document = { hidden: false, addEventListener() {}, createElement() { return {}; } }; g.location = { search: '', hostname: 'localhost' };
const realFetch = g.fetch; g.fetch = (u, o) => realFetch(String(u).replace('https://api.payaviator.app', BASE), o);
const { api } = await import(pathToFileURL(WEB + '/js/api.js').href);
const calc = await import(pathToFileURL(WEB + '/js/calc.js').href);
const C = await import(pathToFileURL(WEB + '/js/codec.js').href);
await api.init({ uid: UID, getToken: async () => TOKEN, demo: false });
ok('web uses the live adapter', api.adapter === 'live');

const now = new Date(), Y = now.getFullYear(), M = now.getMonth(), pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${Y}-${pad(M + 1)}-${pad(d)}`, YM = `${Y}-${pad(M + 1)}`;
const phone = makePhone();

/* ---- helpers: what the APP would compute from its own storage (copies of billPaidAmount / isRecurringOnDate / hidden-date rules) ---- */
const appBills = () => phone.ls('payAviator_v1', []), appOv = () => phone.ls('payAviator_bill_overrides_v1', {}), appPa = () => phone.ls('payAviator_bill_paid_amounts_v1', {}), appMv = () => phone.ls('payAviator_instance_moves_v1', {});
function appPaid(b, d) { const k = `${b.id}|${d}`, o = appOv()[k], pa = appPa()[k]; const fb = (o && typeof o === 'object') ? (o.paid !== undefined ? !!o.paid : !!b.paid) : (o !== undefined && o !== null ? !!o : !!b.paid); return Number(pa ?? (fb ? b.amount : 0)) || 0; }
function appOn(b, d) {
  const mv = { ...(b.dateMoves || {}) }; for (const k of Object.keys(appMv())) if (k.startsWith(b.id + '|')) mv[k.slice(b.id.length + 1)] = appMv()[k].due;
  if (b.recurringUntil && d >= b.recurringUntil) return false; if (Object.prototype.hasOwnProperty.call(mv, d)) return false;
  if (appOv()[`${b.id}|${d}`] && appOv()[`${b.id}|${d}`].deleted) return false;
  if (!b.recurring) return b.due === d;
  const diff = Math.round((new Date(d + 'T00:00:00') - new Date(b.due + 'T00:00:00')) / 86400000); if (diff < 0) return false;
  const f = b.recurrence || 'weekly'; if (f === 'weekly') return diff % 7 === 0; if (f === 'biweekly') return diff % 14 === 0;
  if (f === 'monthly') { const s = new Date(b.due + 'T00:00:00'), t = new Date(d + 'T00:00:00'); return t.getDate() === Math.min(s.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()); } return false;
}
const days = []; for (let m = M - 1; m <= M + 2; m++) { const dim = new Date(Y, m + 1, 0).getDate(); for (let d = 1; d <= dim; d++) days.push(new Date(Y, m, d)); }
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/* one number per (bill, date) for both sides: [] of 'iso:paid' for dates the bill shows on */
function appView(id) { const b = appBills().find((x) => x.id === id); return b ? days.map(isoOf).filter((d) => appOn(b, d)).map((d) => d + ':' + appPaid(b, d)) : null; }
function webView(id) { const b = api.bills.list().find((x) => x.id === id); if (!b) return null; return days.map(isoOf).filter((d) => calc.billOnDate(b, new Date(d + 'T00:00:00')) && !(b.occ[d] && b.occ[d].deleted)).map((d) => d + ':' + calc.billPaidAmount(b, d)); }
const syncBoth = async () => { await phone.sync(); await api.sync(); };
const webSync = async () => { await api.sync(); await phone.sync(); };
const newPhoneBill = (o) => ({ id: o.id, name: 'n', amount: 10, due: iso(10), recurring: false, recurrence: 'weekly', paid: false, color: '#112233', notify: false, notifyDaysBefore: [0], notifyTime: '09:00', notifySound: 'default', notifyVibrate: true, dateMoves: {}, autopay: false, ...o });
const sameView = (n, id) => ok(`${n}: app and web agree on every occurrence and paid amount`, eq(appView(id), webView(id)), { app: appView(id), web: webView(id) });
const setBills = (list) => phone.set('payAviator_v1', list);
const PRE = 'mx-';

/* =================================================================== APP -> WEB, one field at a time */
console.log('[app -> web: fields]');
const base = [];
for (const [k, o] of Object.entries({
  w: { name: 'Weekly one', recurring: true, recurrence: 'weekly' }, b: { name: 'Biweekly one', recurring: true, recurrence: 'biweekly', due: iso(3) },
  m: { name: 'Monthly 31', recurring: true, recurrence: 'monthly', due: `${Y}-${pad(M + 1)}-28` }, o: { name: 'One time', recurring: false },
  c: { name: 'Colored', color: '#abcdef', category: 'Insurance', notes: 'n1', autopay: true }, p: { name: 'Paid one', recurring: false, paid: true }, r: { name: 'Rec paid fallback', recurring: true, recurrence: 'weekly', paid: true },
})) base.push(newPhoneBill({ id: PRE + k, ...o }));
setBills(base);
phone.set('payAviator_bill_overrides_v1', { [`${PRE}w|${iso(10)}`]: { paid: true }, [`${PRE}b|${iso(17)}`]: { deleted: true }, [`${PRE}m|${iso(28)}`]: { paid: false }, [`${PRE}o|${iso(10)}`]: { paid: true } });
phone.set('payAviator_bill_paid_amounts_v1', { [`${PRE}w|${iso(10)}`]: 4.5, [`${PRE}m|${iso(28)}`]: 0, [`${PRE}p|${iso(10)}`]: 10 });
await syncBoth();
for (const k of ['w', 'b', 'm', 'o', 'c', 'p', 'r']) sameView('app-made ' + k, PRE + k);
let wbv = api.bills.list().find((b) => b.id === PRE + 'c');
ok('app -> web: color, category, notes, autopay', wbv.color === '#abcdef' && wbv.category === 'Insurance' && wbv.notes === 'n1' && wbv.autopay === true, wbv);
// edit each field on the phone
const edits = { name: ['name', 'Renamed'], amount: ['amount', 77.77], color: ['color', '#010203'], category: ['category', 'Utilities'], notes: ['notes', 'changed'], autopay: ['autopay', false], recurrence: ['recurrence', 'biweekly'], due: ['due', iso(11)], recurring: ['recurring', false] };
for (const [label, [field, val]] of Object.entries(edits)) {
  const list = appBills(); const b = list.find((x) => x.id === PRE + 'w'); b[field] = val; setBills(list); await syncBoth();
  const w = api.bills.list().find((x) => x.id === PRE + 'w');
  ok(`app edit ${label} -> web`, field === 'recurrence' || field === 'due' || field === 'recurring' ? w[field] === val : (field === 'autopay' ? w.autopay === false : w[field] === val), w);
  if (['recurrence', 'due', 'recurring'].includes(field)) sameView('app edit ' + label, PRE + 'w');
}
// recurringUntil (app "delete this and future")
{ const list = appBills(); const b = list.find((x) => x.id === PRE + 'm'); b.recurringUntil = `${Y}-${pad(M + 2)}-01`; setBills(list); await syncBoth(); sameView('app recurringUntil', PRE + 'm'); }
// app marks one occurrence paid / unpaid / partial / deleted
{ const o = appOv(), pa = appPa(); o[`${PRE}b|${iso(3)}`] = { paid: true }; delete pa[`${PRE}b|${iso(3)}`]; o[`${PRE}b|${iso(31 > 28 ? 24 : 31)}`] = { deleted: true }; pa[`${PRE}b|${iso(3)}`] = 3; phone.set('payAviator_bill_overrides_v1', o); phone.set('payAviator_bill_paid_amounts_v1', pa); await syncBoth(); sameView('app paid/partial/deleted occurrence', PRE + 'b'); }
// app move one occurrence (dateMoves + instance move + moved one-time bill)
{ const list = appBills(), b = list.find((x) => x.id === PRE + 'r'); b.dateMoves = { [iso(10)]: iso(12) }; list.push(newPhoneBill({ id: PRE + 'r-mv', name: 'Rec paid fallback', amount: b.amount, due: iso(12), recurring: false })); setBills(list); const mv = appMv(); mv[`${PRE}r|${iso(10)}`] = { due: iso(12), amount: b.amount, name: b.name }; phone.set('payAviator_instance_moves_v1', mv); await syncBoth(); sameView('app moved occurrence (original)', PRE + 'r'); sameView('app moved occurrence (moved copy)', PRE + 'r-mv'); }
// app deletes a bill and an occurrence-only tombstone
setBills(appBills().filter((b) => b.id !== PRE + 'o')); await syncBoth();
ok('app delete bill -> web tombstone (bill gone)', !api.bills.list().some((b) => b.id === PRE + 'o'));

/* =================================================================== WEB -> APP, one field at a time */
console.log('[web -> app: fields]');
const WID = PRE + 'web1';
await api.bills.save({ id: WID, name: 'Web bill', amount: 19.99, due: iso(9), recurring: true, recurrence: 'weekly', color: '#16e4ea', category: 'Utilities', notes: '', paid: false, autopay: true, occ: {} });
await webSync(); let ab = appBills().find((b) => b.id === WID);
ok('web-made bill: app has autopay=true from the web form', ab && ab.autopay === true, ab);
sameView('web-made bill', WID);
const wedits = { name: 'Web renamed', amount: 33.33, color: '#e5484d', category: 'Insurance', notes: 'web note', autopay: false, recurrence: 'biweekly', due: iso(12) };
for (const [field, val] of Object.entries(wedits)) {
  const cur = api.bills.list().find((b) => b.id === WID); await api.bills.save({ ...cur, [field]: val }); await webSync(); ab = appBills().find((b) => b.id === WID);
  ok(`web edit ${field} -> app`, ab && ab[field] === val, ab); if (['recurrence', 'due'].includes(field)) sameView('web edit ' + field, WID);
}
// recurring -> one-time and back
{ const cur = api.bills.list().find((b) => b.id === WID); await api.bills.save({ ...cur, recurring: false }); await webSync(); sameView('web recurring->one-time', WID);
  const c2 = api.bills.list().find((b) => b.id === WID); await api.bills.save({ ...c2, recurring: true, recurrence: 'weekly' }); await webSync(); sameView('web one-time->recurring', WID); }
// mark paid / partial / unpaid on web for a recurring occurrence
{ const cur = api.bills.list().find((b) => b.id === WID), d = cur.due; await api.bills.save({ ...cur, occ: { ...cur.occ, [d]: { paid: cur.amount } } }); await webSync(); sameView('web paid occurrence', WID);
  const c2 = api.bills.list().find((b) => b.id === WID); await api.bills.save({ ...c2, occ: { ...c2.occ, [d]: { paid: 5 } } }); await webSync(); sameView('web partial payment', WID);
  const c3 = api.bills.list().find((b) => b.id === WID); await api.bills.save({ ...c3, occ: { ...c3.occ, [d]: { paid: 0 } } }); await webSync(); sameView('web unpaid again', WID); }
// web edits an app bill that has overrides, moves and recurringUntil: nothing lost, view identical
{ const cur = api.bills.list().find((b) => b.id === PRE + 'm'); await api.bills.save({ ...cur, name: 'Monthly web-edited' }); await webSync(); sameView('web edit of bill with recurringUntil', PRE + 'm');
  const cr = api.bills.list().find((b) => b.id === PRE + 'r'); await api.bills.save({ ...cr, notes: 'x' }); await webSync(); sameView('web edit of bill with a moved occurrence', PRE + 'r'); ok('moved occurrence still moved after web edit', appBills().find((b) => b.id === PRE + 'r').dateMoves[iso(10)] === iso(12) && !!appMv()[`${PRE}r|${iso(10)}`]); }
// web delete a recurring bill
await api.bills.remove(PRE + 'b'); await webSync();
ok('web delete recurring bill -> app: bill and its override keys gone', !appBills().some((b) => b.id === PRE + 'b') && !Object.keys(appOv()).concat(Object.keys(appPa())).some((k) => k.startsWith(PRE + 'b|')));
const q = await phone.sync(); ok('quiet after the matrix (no loop)', q.ok && q.pushed === 0, q);
ok('every web-made bill field is the app type (amount number, hex color, ISO due)', appBills().filter((b) => b.id.startsWith(PRE + 'web')).every((b) => typeof b.amount === 'number' && /^#[0-9a-f]{6}$/i.test(b.color) && /^\d{4}-\d\d-\d\d$/.test(b.due)));
const apiSrc = fs.readFileSync(WEB + '/js/api.js', 'utf8'), ivs = [...apiSrc.matchAll(/setInterval\([\s\S]*?\},\s*(\d+)\)/g)].map((m) => +m[1]);
ok('web sync: no polling timer under 5 minutes; pulls on focus/visibility/online', ivs.length > 0 && Math.min(...ivs) >= 300000 && /addEventListener\('focus'/.test(apiSrc) && /visibilitychange/.test(apiSrc) && /addEventListener\('online'/.test(apiSrc), ivs);
console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
server.close(); process.exit(fails.length ? 1 : 0);
