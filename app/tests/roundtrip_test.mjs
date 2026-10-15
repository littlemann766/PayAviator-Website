// Round-trip test: the Android app's REAL sync client (script id pa414-cloud-sync extracted from index.html, run in a vm with
// mock localStorage) and the web app's REAL data layer (app/js/api.js + codec.js + calc.js) talk through Lucian's REAL backend
// (in-memory store). Checks both directions, field loss, ids, deletes, occurrence overrides, and that neither side loops.
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

/* =============================================================== APP -> WEB */
console.log('[app -> web]');
const U1 = '3f2c8a52-5d3e-4c1b-9f0a-1a2b3c4d5e6f', U2 = 'b7a1d9c0-2e4f-4a6b-8c3d-9e8f7a6b5c4d';
const billA = { id: U1, name: 'Rent', amount: 1450, due: iso(1), recurring: true, recurrence: 'monthly', paid: false, color: '#ff8800', category: '', notes: 'landlord', autopay: true, notify: true, notifyDaysBefore: [3, 1], notifyTime: '08:30', notifySound: 'chime', notifyVibrate: false, dateMoves: { [iso(15)]: iso(17) }, recurringUntil: `${Y + 3}-01-01` };
const billOneTime = { id: U2, name: 'Vet', amount: 220.5, due: iso(10), recurring: false, recurrence: 'weekly', paid: true, color: '#00aa55', notify: false, notifyDaysBefore: [0], notifyTime: '09:00', notifySound: 'default', notifyVibrate: true };
const billOdd = { id: 'Old bill #7 / spaces', name: 'Gym', amount: 30, due: iso(5), recurring: true, recurrence: 'weekly', paid: false, color: '#7c98bd' };
phone.set('payAviator_v1', [billA, billOneTime, billOdd]);
phone.set('payAviator_bill_overrides_v1', { [`${U1}|${iso(1)}`]: { paid: true }, [`${U1}|${iso(15)}`]: { deleted: true, movedTo: iso(17) }, [`${U2}|${iso(10)}`]: { paid: true }, [`Old bill #7 / spaces|${iso(5)}`]: { deleted: true } });
phone.set('payAviator_bill_paid_amounts_v1', { [`${U1}|${iso(1)}`]: 700, [`${U2}|${iso(10)}`]: 220.5 });
phone.set('payAviator_instance_moves_v1', { [`${U1}|${iso(15)}`]: { due: iso(17), amount: 1450, name: 'Rent' } });
const P1 = 'c1111111-0000-4000-8000-000000000001', P2 = 'c2222222-0000-4000-8000-000000000002';
phone.set('payAviator_paychecks_v1', [
  { id: P1, amount: 2180.55, date: iso(2), frequency: 'biweekly', incomeType: 'salary', annualSalary: 56694.3 },
  { id: P2, amount: 480, date: iso(3), frequency: 'weekly', incomeType: 'hourly', annualSalary: 0 }]);
phone.set('payAviator_paycheck_overrides_v1', { [`${P1}|${iso(16)}`]: { amount: 2500 }, [`${P2}|${iso(10)}`]: { deleted: true } });
phone.sb.localStorage.setItem('payAviator_income_type_v1', 'salary'); phone.sb.localStorage.setItem('payAviator_hourly_wage_v1', '18.5'); phone.sb.localStorage.setItem('payAviator_annual_salary_v1', '56694.3');
phone.set('payAviator_budget_spending_v1', [
  { id: 'sp_1700000000_ab12', name: 'Groceries', amount: 84.2, date: iso(4), enteredAt: '2026-10-04T12:00:00.000Z', source: 'manual', flow: 'spending' },
  { id: 'rf_1700000001_cd34', name: 'Refund Target', amount: 20, date: iso(6), enteredAt: '2026-10-06T12:00:00.000Z', source: 'manual', flow: 'refund' },
  { id: 'e7d5ab9c-0000-4000-8000-00000000abcd', name: 'Coffee', amount: 6.5, date: iso(7), notes: 'oat latte' },
  { id: 'x1', description: 'money back from store', amount: 12, date: iso(8), type: 'refund', kind: 'refund' }]);
phone.set('payAviator_savings_goals_v1', [{ id: 'g-1', name: 'Trip', target: 1200, saved: 640, targetDate: `${Y + 1}-06-01`, transactions: [{ date: iso(2), amount: 40, note: 'x' }] }]);
phone.set('payAviator_monthly_budgets_v1', { [YM]: 3000, [`${Y}-${pad(((M + 11) % 12) + 1)}`]: 2800 });
phone.set('payAviator_category_map_v86', { ['id:' + U1]: 'Housing', ['id:' + U2]: 'Pets', 'name:gym': 'Health' });
phone.set('payaviator_payday_cushion_v2045', { type: 'percent', amount: 0, percent: 10 });
let r = await phone.sync(); ok('phone first sync ok', r && r.ok, r);
const items = (await srv('GET', '/api/sync/changes?since=0&limit=500')).items;
const kinds = {}; items.forEach((i) => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });
ok('app pushed all 7 kinds (bill, income, spending, goal, budget, category, cushion)', ['bill', 'income', 'spending', 'goal', 'budget', 'category', 'cushion'].every((k) => kinds[k] > 0), kinds);
const byId = (k, id) => items.find((i) => i.kind === k && i.id === id);
ok('app ids: bill=raw uuid, hashed when it has spaces/#, cushion=payday, budget=month:YYYY-MM, category=c:<key>, income profile=profile',
  byId('bill', U1) && items.some((i) => i.kind === 'bill' && /^h_/.test(i.id)) && byId('cushion', 'payday') && byId('budget', 'month:' + YM) && byId('category', 'c:id:' + U1) && byId('income', 'profile'), items.map((i) => i.kind + '|' + i.id));
ok('app bill data carries per-occurrence maps inside the record (_ov/_pa) and the raw id', byId('bill', U1).data._pa[iso(1)] === 700 && byId('bill', U1).data._ov[iso(15)].movedTo === iso(17) && byId('bill', U1).data.id === U1);
ok('app budget data = {month, amount}', eq(byId('budget', 'month:' + YM).data, { month: YM, amount: 3000 }));
ok('app cushion data = {type, amount, percent}', eq(byId('cushion', 'payday').data, { type: 'percent', amount: 0, percent: 10 }));

await api.sync();
const wb = api.bills.list(), find = (n) => wb.find((b) => b.name === n);
ok('web shows all 3 bills', wb.length === 3, wb.map((b) => b.name));
ok('web bill: raw fields, hex color, notes, recurrence', find('Rent').id === U1 && find('Rent').color === '#ff8800' && find('Rent').notes === 'landlord' && find('Rent').recurrence === 'monthly' && find('Rent').amount === 1450);
ok('web bill category comes from the app category map (id: key and name: key)', find('Rent').category === 'Housing' && find('Vet').category === 'Pets' && find('Gym').category === 'Health', wb.map((b) => b.category));
const occ = calc.billOccurrences(wb, Y, M), rent1 = occ.find((o) => o.id === U1 && o.iso === iso(1));
ok('web: partial payment from billPaidAmounts shows $700 of $1450 (partial)', rent1 && rent1.paid === 700 && rent1.status === 'partial', rent1);
ok('web: occurrence moved away on the app (dateMoves/deleted) is not shown on the original date', !occ.some((o) => o.id === U1 && o.iso === iso(15)));
ok('web: one-time bill paid in the app (billPaidAmounts) is Paid and view.paid=true', occ.find((o) => o.id === U2).status === 'paid' && find('Vet').paid === true);
ok('web: deleted occurrence override hides that weekly gym date', !occ.some((o) => o.id === items.find((i) => i.kind === 'bill' && /^h_/.test(i.id)).id && o.iso === iso(5)));
const wi = api.income.list();
ok('web income: profile record is NOT shown as a paycheck; 2 paychecks, unnamed -> "Paycheck"', wi.length === 2 && wi.every((x) => x.name === 'Paycheck'), wi);
const io = calc.incomeOccurrences(wi, Y, M);
ok('web income: per-date override amount used ($2500) and deleted occurrence skipped', io.some((o) => o.id === P1 && o.iso === iso(16) && o.amount === 2500) && !io.some((o) => o.id === P2 && o.iso === iso(10)));
ok('web income: incomeType/annualSalary preserved in view', wi.find((x) => x.id === P2).incomeType === 'hourly' && wi.find((x) => x.id === P1).annualSalary === 56694.3);
const ws = api.spending.list();
ok('web spending: 4 rows, amounts positive, flow/type refund recognised, description used as name', ws.length === 4 && calc.isFunds(ws.find((x) => x.id === 'rf_1700000001_cd34')) && calc.isFunds(ws.find((x) => x.id === 'x1')) && ws.find((x) => x.id === 'x1').name === 'money back from store' && !calc.isFunds(ws.find((x) => x.id === 'sp_1700000000_ab12')), ws);
ok('web budget: month amount -> limit', api.budget.get(YM).limit === 3000 && api.budget.list().length === 2);
ok('web cushion: percent 10 decoded', eq(api.cushion.get(), { mode: 'percent', dollar: 0, percent: 10 }));
ok('web goals: name/target/saved/transactions', api.goals.list()[0].target === 1200 && api.goals.list()[0].transactions[0].amount === 40);
ok('web category list built from the app map', ['Housing', 'Pets', 'Health'].every((n) => api.categories.list().some((c) => c.name === n)));
// no field loss: decode -> encode with no edits must give back exactly what the app wrote
let lossy = [];
for (const i of items) {
  const d = i.data; let back;
  if (i.kind === 'bill') back = C.encodeBill(i.id, C.decodeBill(i.id, d, { catMap: C.categoryMap(items.filter((x) => x.kind === 'category')) }), d);
  else if (i.kind === 'income' && i.id !== 'profile') back = C.encodeIncome(i.id, C.decodeIncome(i.id, d), d);
  else if (i.kind === 'spending') back = C.encodeSpending(i.id, C.decodeSpending(i.id, d), d);
  else if (i.kind === 'cushion') back = C.encodeCushion(C.decodeCushion(d), d);
  else if (i.kind === 'budget') back = C.encodeBudgetMonth(d.month, d.amount, d.categories, d);
  else continue;
  if (!eq(back, d)) lossy.push({ kind: i.kind, id: i.id, before: d, after: back });
}
ok('NO FIELD LOSS: decode then encode of every app record (no edits) is byte-identical', lossy.length === 0, lossy[0]);

/* =============================================================== WEB -> APP */
console.log('[web -> app]');
// edit an app bill on the web (amount + mark the 8th-of-month... use its due occurrence unpaid) -> app fields must survive
const rentView = api.bills.list().find((b) => b.id === U1);
await api.bills.save({ ...rentView, amount: 1500, occ: { ...rentView.occ, [iso(1)]: { paid: 1500 } } });
const WB = 'web-bill-0001';
await api.bills.save({ id: WB, name: 'Web Water', amount: 45.25, due: iso(12), recurring: true, recurrence: 'monthly', color: '#16e4ea', category: 'Utilities', notes: 'from web', paid: false, occ: { [iso(12)]: { paid: 45.25 } } });
const WO = 'web-onetime-01';
await api.bills.save({ id: WO, name: 'Web Parking', amount: 12, due: iso(20), recurring: false, recurrence: 'weekly', color: '#e5484d', category: '', notes: '', paid: true, occ: { [iso(20)]: { paid: 12 } } });
await api.income.save({ id: 'web-inc-0001', name: 'Freelance', amount: 650, date: iso(13), frequency: 'monthly' });
await api.spending.save({ id: 'web-sp-0001', name: 'Lunch', amount: 12.5, date: iso(9), flow: 'spending', category: 'Dining out', notes: '' });
await api.spending.save({ id: 'web-sp-0002', name: 'Return', amount: 30, date: iso(9), flow: 'refund', category: '', notes: '' });
await api.budget.save(YM, { limit: 3300, categories: { Groceries: 400, 'Dining out': 150 } });
await api.cushion.save({ mode: 'dollar', dollar: 75, percent: 0 });
await api.categories.save('Pet care');   // no-op on purpose: the web never writes kind 'category'
await api.bills.remove(U2);   // delete the app's one-time bill from the web
ok('web queue drained', api.status.pending === 0, api.status);
r = await phone.sync(); ok('phone sync after web edits ok', r && r.ok, r);
const bills = phone.ls('payAviator_v1', []), ov = phone.ls('payAviator_bill_overrides_v1', {}), pa = phone.ls('payAviator_bill_paid_amounts_v1', {});
const rentNow = bills.find((b) => b.id === U1);
ok('app: edited bill amount arrived (1500) and the app-only fields survived (notify*, autopay, dateMoves, recurringUntil)', rentNow.amount === 1500 && rentNow.notify === true && eq(rentNow.notifyDaysBefore, [3, 1]) && rentNow.notifyTime === '08:30' && rentNow.autopay === true && rentNow.dateMoves[iso(15)] === iso(17) && rentNow.recurringUntil === `${Y + 3}-01-01` && rentNow.color === '#ff8800', rentNow);
ok('app: split maps are not leaked into the bill record (_ov/_pa/_mv are stripped)', !('_ov' in rentNow) && !('_pa' in rentNow) && !('_mv' in rentNow));
ok('app: web payment on Rent -> billPaidAmounts[id|date]=1500 and billOverrides paid:true; moved-occurrence override intact', pa[`${U1}|${iso(1)}`] === 1500 && ov[`${U1}|${iso(1)}`].paid === true && ov[`${U1}|${iso(15)}`].movedTo === iso(17) && !!phone.ls('payAviator_instance_moves_v1', {})[`${U1}|${iso(15)}`]);
const wbill = bills.find((b) => b.id === WB);
ok('app: web-created bill has the app shape (id, name, amount number, due ISO, recurring, recurrence, paid, color hex, category, notes, notify defaults)', wbill && wbill.name === 'Web Water' && wbill.amount === 45.25 && wbill.due === iso(12) && wbill.recurring === true && wbill.recurrence === 'monthly' && wbill.paid === false && wbill.color === '#16e4ea' && wbill.category === 'Utilities' && wbill.notes === 'from web' && wbill.notify === false && Array.isArray(wbill.notifyDaysBefore), wbill);
ok('app: web payment on the new bill landed in the app per-date maps', pa[`${WB}|${iso(12)}`] === 45.25 && ov[`${WB}|${iso(12)}`].paid === true);
const wone = bills.find((b) => b.id === WO);
ok('app: web one-time paid bill -> paid:true + per-date maps (the app reads billPaidAmounts for one-time too)', wone && wone.paid === true && wone.recurring === false && pa[`${WO}|${iso(20)}`] === 12);
ok('app: bill deleted on web is gone and its override keys were dropped', !bills.some((b) => b.id === U2) && !Object.keys(ov).concat(Object.keys(pa)).some((k) => k.startsWith(U2 + '|')));
const pcs = phone.ls('payAviator_paychecks_v1', []), wpc = pcs.find((p) => p.id === 'web-inc-0001');
ok('app: web income = app paycheck shape {id, amount, date, frequency, incomeType:salary, annualSalary:0} (+name)', wpc && wpc.amount === 650 && wpc.date === iso(13) && wpc.frequency === 'monthly' && wpc.incomeType === 'salary' && wpc.annualSalary === 0 && wpc.name === 'Freelance', wpc);
ok('app: existing paychecks, their overrides and the income profile untouched', pcs.length === 3 && phone.ls('payAviator_paycheck_overrides_v1', {})[`${P1}|${iso(16)}`].amount === 2500 && phone.store.get('payAviator_hourly_wage_v1') === '18.5' && phone.store.get('payAviator_income_type_v1') === 'salary');
const sp = phone.ls('payAviator_budget_spending_v1', []), s1 = sp.find((x) => x.id === 'web-sp-0001'), s2 = sp.find((x) => x.id === 'web-sp-0002');
ok('app: web spending = {id,name,amount>0,date,flow,source,enteredAt(ISO),category}; refund has flow refund', s1 && s1.amount === 12.5 && s1.flow === 'spending' && s1.date === iso(9) && /^\d{4}-\d\d-\d\dT/.test(s1.enteredAt) && s1.source === 'web' && s2.flow === 'refund' && s2.amount === 30, [s1, s2]);
ok('app: app-only spending fields (type/kind/description) untouched', eq(sp.find((x) => x.id === 'x1'), { id: 'x1', description: 'money back from store', amount: 12, date: iso(8), type: 'refund', kind: 'refund' }));
const bud = phone.ls('payAviator_monthly_budgets_v1', {});
ok('app: budget month number updated (3300); extra `categories` field never leaks into the month map', bud[YM] === 3300 && Object.keys(bud).length === 2 && !('undefined' in bud), bud);
ok('cloud keeps the web category limits inside the month record', eq((await srv('GET', '/api/sync/changes?since=0&limit=500')).items.find((i) => i.id === 'month:' + YM).data, { month: YM, amount: 3300, categories: { Groceries: 400, 'Dining out': 150 } }));
ok('app: cushion = {type:dollar, amount:75, percent:0}', eq(phone.ls('payaviator_payday_cushion_v2045', null), { type: 'dollar', amount: 75, percent: 0 }));
const cmap = phone.ls('payAviator_category_map_v86', {});
ok('app: category map unchanged by the web', eq(cmap, { ['id:' + U1]: 'Housing', ['id:' + U2]: 'Pets', 'name:gym': 'Health' }), cmap);
ok('app: goal untouched', phone.ls('payAviator_savings_goals_v1', [])[0].transactions[0].note === 'x');
r = await phone.sync(); ok('phone second sync is quiet (no push loop, nothing deleted from the cloud)', r.ok && r.pushed === 0 && phone.status().queued === 0 && !(await srv('GET', '/api/sync/changes?since=0&limit=500')).items.some((i) => i.deleted && i.id !== U2), r);
ok('web category limits survive on the phone side round trip (cloud copy not tombstoned)', eq((await srv('GET', '/api/sync/changes?since=0&limit=500')).items.find((i) => i.id === 'month:' + YM).data.categories, { Groceries: 400, 'Dining out': 150 }));

/* =============================================================== APP -> WEB again (edit round trip) */
console.log('[app edit -> web]');
const b2 = phone.ls('payAviator_v1', []); const wb2 = b2.find((b) => b.id === WB); wb2.amount = 50; wb2.name = 'Water (phone)';
phone.set('payAviator_v1', b2);
const pap = phone.ls('payAviator_bill_paid_amounts_v1', {}); pap[`${WB}|${iso(12)}`] = 20; phone.set('payAviator_bill_paid_amounts_v1', pap);
await phone.sync(); await api.sync();
const back = api.bills.list().find((b) => b.id === WB), oc = calc.billOccurrences([back], Y, M).find((o) => o.iso === iso(12));
ok('web sees the phone edit (name, amount, new partial payment)', back.name === 'Water (phone)' && back.amount === 50 && oc.paid === 20 && oc.status === 'partial', oc);
// phone deletes a spending row and a bill -> web shows deletion
phone.set('payAviator_budget_spending_v1', phone.ls('payAviator_budget_spending_v1', []).filter((x) => x.id !== 'web-sp-0001'));
phone.set('payAviator_v1', phone.ls('payAviator_v1', []).filter((b) => b.id !== WO));
await phone.sync(); await api.sync();
ok('web sees phone deletes (tombstones)', !api.spending.list().some((x) => x.id === 'web-sp-0001') && !api.bills.list().some((b) => b.id === WO));
// web unmarks payment -> app: explicit 0 / unpaid
const rv = api.bills.list().find((b) => b.id === U1);
await api.bills.save({ ...rv, occ: { ...rv.occ, [iso(1)]: { ...rv.occ[iso(1)], paid: 0 } } });
await phone.sync();
ok('app: payment cleared on the web is an explicit 0 / paid:false (not a fallback to bill.paid)', phone.ls('payAviator_bill_paid_amounts_v1', {})[`${U1}|${iso(1)}`] === 0 && phone.ls('payAviator_bill_overrides_v1', {})[`${U1}|${iso(1)}`].paid === false);
// web->web consistency after full resync from cloud
const T2 = await import(pathToFileURL(WEB + '/js/api.js').href + '?x=1'); // fresh module instance == new browser session
await T2.api.init({ uid: UID + '-x', getToken: async () => TOKEN, demo: false }).catch(() => {});

console.log(`\n${pass} passed, ${fails.length} failed`); if (fails.length) console.log('FAILED:\n  ' + fails.join('\n  '));
server.close(); process.exit(fails.length ? 1 : 0);
