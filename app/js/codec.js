/* Wire <-> view codec. PURE (no DOM, no imports) so it also runs in Node tests.
 *
 * The Android app (4.1.4, script id pa414-cloud-sync) is the source of truth for the `data` of every sync kind.
 * Records in the web's memory (E.rec) hold the WIRE `data` exactly as the app writes it. The pages only ever see
 * VIEW objects produced by decode*(), and writes go through encode*(view, priorWire) which starts from a copy of the
 * prior wire object so unknown fields (notify*, dateMoves, autopay, source, enteredAt, ...) are never lost.
 * See app/SYNC_SHAPES.md for the full spec. */

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const FUNDS_RE = /^(refund|funds|credit)$/i;

/* ---- per-occurrence maps: the app keeps them as flat maps keyed "<billId>|<ISO date>" and the sync client
   carries them INSIDE the record as _ov (billOverrides), _pa (billPaidAmounts), _mv (instance moves). ---- */

/** Bill view: {id,name,amount,due,recurring,recurrence,color,category,notes,paid,recurringUntil,autopay,occ,dateMoves}
 *  occ[iso] = {paid?:number, deleted?:true}. `paid` = paid amount on the bill's own due date > 0. */
export function decodeBill(id, w, ctx = {}) {
  if (!isObj(w)) return null;
  const ov = isObj(w._ov) ? w._ov : {}, pa = isObj(w._pa) ? w._pa : {}, amount = num(w.amount);
  const occ = {};
  for (const iso of new Set([...Object.keys(ov), ...Object.keys(pa)])) {
    const o = {}, v = isObj(ov[iso]) ? ov[iso] : null;
    if (hasOwn(pa, iso)) o.paid = Math.max(0, num(pa[iso]));
    else if (v && v.paid !== undefined) o.paid = v.paid ? amount : 0;
    if (v && v.deleted) o.deleted = true;
    if (Object.keys(o).length) occ[iso] = o;
  }
  const moves = isObj(w.dateMoves) ? w.dateMoves : {};
  const due = typeof w.due === 'string' ? w.due : '';
  /* `paid` is the bill's own fallback flag. For a RECURRING bill it must stay the raw wire flag (the app's b.paid): deriving it from the first
     due date made every later occurrence without its own entry look Paid on the web (the Child Support / Rent / Amanda mismatch). */
  const paidOnDue = w.recurring ? !!w.paid : (occ[due] && occ[due].paid != null ? occ[due].paid > 0 : !!w.paid);
  const cm = ctx.catMap || {};
  const category = (typeof w.category === 'string' && w.category.trim()) || cm['id:' + (w.id != null ? w.id : id)] || cm['name:' + String(w.name || '').trim().toLowerCase()] || '';
  return {
    id, name: String(w.name == null ? '' : w.name), amount, due, recurring: !!w.recurring, recurrence: w.recurrence || 'weekly',
    color: typeof w.color === 'string' && w.color ? w.color : '#ff0000', category, notes: typeof w.notes === 'string' ? w.notes : '',
    catFromMap: !(typeof w.category === 'string' && w.category.trim()) && !!category,
    paid: paidOnDue, recurringUntil: w.recurringUntil || undefined, autopay: !!w.autopay, occ, dateMoves: moves,
  };
}

/** Build the wire bill. view fields: name, amount, due, recurring, recurrence, color, category, notes, paid, occ (paid/deleted marks). */
export function encodeBill(id, view, prior) {
  const w = isObj(prior) ? clone(prior) : {};
  const oldDue = w.due;
  w.id = isObj(prior) && prior.id != null ? prior.id : id;   // the app's raw id (record id may be a hashed form of it)
  w.name = view.name; w.amount = view.amount; w.due = view.due; w.recurring = !!view.recurring;
  w.recurrence = view.recurring ? view.recurrence : 'weekly';
  w.color = view.color;
  const priorCat = isObj(prior) && typeof prior.category === 'string' ? prior.category.trim() : '';
  if (!(view.catFromMap && !priorCat)) { // do not bake the category-map fallback into the record
    if ((isObj(prior) && 'category' in prior) || view.category) w.category = view.category || '';   // never add empty keys the app did not have
  }
  if ((isObj(prior) && 'notes' in prior) || view.notes) w.notes = view.notes || '';
  if (!isObj(prior)) { w.paid = false; w.notify = false; w.notifyDaysBefore = [0]; w.notifyTime = '09:00'; w.notifySound = 'default'; w.notifyVibrate = true; w.dateMoves = {}; w.autopay = false; }
  const ov = isObj(w._ov) ? w._ov : {}, pa = isObj(w._pa) ? w._pa : {};
  const viewOcc = isObj(view.occ) ? view.occ : {};
  // one-time bill whose due date changed: its paid state travels with it (the app re-keys the same way)
  if (!view.recurring && oldDue && oldDue !== view.due) {
    if (hasOwn(pa, oldDue)) { pa[view.due] = pa[oldDue]; delete pa[oldDue]; }
    if (hasOwn(ov, oldDue)) { ov[view.due] = ov[oldDue]; delete ov[oldDue]; }
  }
  for (const iso of Object.keys(viewOcc)) {
    const o = viewOcc[iso] || {};
    if (o.paid != null) { pa[iso] = Math.max(0, num(o.paid)); ov[iso] = { ...(isObj(ov[iso]) ? ov[iso] : {}), paid: num(o.paid) > 0 }; }
    if (o.deleted && !(isObj(ov[iso]) && ov[iso].deleted)) ov[iso] = { ...(isObj(ov[iso]) ? ov[iso] : {}), deleted: true };
  }
  // a paid mark the user cleared on the web -> explicit 0 / unpaid (never silently fall back to bill.paid)
  for (const iso of new Set([...Object.keys(pa), ...Object.keys(ov).filter((k) => isObj(ov[k]) && ov[k].paid !== undefined)])) {
    if (!(isObj(viewOcc[iso]) && viewOcc[iso].paid != null) && (hasOwn(pa, iso) ? num(pa[iso]) > 0 : ov[iso].paid)) { pa[iso] = 0; ov[iso] = { ...(isObj(ov[iso]) ? ov[iso] : {}), paid: false }; }
  }
  if (!view.recurring) w.paid = num(pa[view.due]) > 0;
  if (Object.keys(ov).length) w._ov = ov; else delete w._ov;
  if (Object.keys(pa).length) w._pa = pa; else delete w._pa;
  return w;
}

/** Income view: {id,name,amount,date,frequency,incomeType,annualSalary,occ}. The app's paychecks have no `name`; the web adds one. */
export function decodeIncome(id, w) {
  if (!isObj(w) || w.profile === true || id === 'profile' || typeof w.date !== 'string') return null;
  const ov = isObj(w._ov) ? w._ov : {}, occ = {};
  for (const iso of Object.keys(ov)) { const v = ov[iso]; if (!isObj(v)) continue; const o = {}; if (v.deleted) o.deleted = true; if (v.amount !== undefined) o.amount = num(v.amount); if (Object.keys(o).length) occ[iso] = o; }
  return { id, name: typeof w.name === 'string' && w.name ? w.name : 'Paycheck', amount: num(w.amount), date: w.date, frequency: w.frequency || 'biweekly', incomeType: w.incomeType || 'hourly', annualSalary: num(w.annualSalary), occ };
}
export function encodeIncome(id, view, prior) {
  const w = isObj(prior) ? clone(prior) : {};
  w.id = isObj(prior) && prior.id != null ? prior.id : id;
  if ((isObj(prior) && 'name' in prior) || view.name !== 'Paycheck') w.name = view.name;   // the app's paychecks have no name; 'Paycheck' is only the display fallback
  w.amount = view.amount; w.date = view.date; w.frequency = view.frequency;
  if (!isObj(prior)) { w.incomeType = 'salary'; w.annualSalary = 0; }
  else if (w.incomeType !== 'salary' && num(prior.amount) !== num(view.amount)) { w.incomeType = 'salary'; w.annualSalary = 0; } // an explicit amount typed on the web would otherwise be overridden by the phone's hours x wage
  return w;
}

/** Spending view: {id,name,amount,date,flow,category,notes}. amount is always positive; refund/funds/credit is carried by flow||type. */
export function decodeSpending(id, w) {
  if (!isObj(w)) return null;
  const flow = w.flow || w.type || 'spending';
  return { id, name: String(w.name != null ? w.name : (w.description || '')), amount: Math.abs(num(w.amount)), date: typeof w.date === 'string' ? w.date : '', flow, category: typeof w.category === 'string' ? w.category : '', notes: typeof w.notes === 'string' ? w.notes : '' };
}
export function encodeSpending(id, view, prior, now = new Date()) {
  const w = isObj(prior) ? clone(prior) : {};
  w.id = isObj(prior) && prior.id != null ? prior.id : id;
  if (!(isObj(prior) && !('name' in prior) && 'description' in prior && view.name === prior.description)) w.name = view.name;
  w.amount = Math.abs(view.amount); w.date = view.date;
  if ((isObj(prior) && 'notes' in prior) || view.notes) w.notes = view.notes || '';
  if (view.category) w.category = view.category; else delete w.category;
  const wantFunds = FUNDS_RE.test(String(view.flow));
  const hadFunds = isObj(prior) && FUNDS_RE.test(String(prior.flow || prior.type || ''));
  if (!isObj(prior)) { w.flow = wantFunds ? 'refund' : 'spending'; w.source = 'web'; w.enteredAt = now.toISOString(); }
  else if (wantFunds !== hadFunds) { w.flow = wantFunds ? 'refund' : 'spending'; if (!wantFunds) { delete w.type; delete w.kind; } else { w.type = 'refund'; w.kind = 'refund'; } }
  return w;
}

/** Goal (read only on web): {id,name,target,saved,targetDate,transactions:[{date,amount}]} */
export function decodeGoal(id, w) {
  if (!isObj(w)) return null;
  return { id, name: String(w.name || ''), target: num(w.target), saved: num(w.saved), targetDate: w.targetDate || '', transactions: Array.isArray(w.transactions) ? w.transactions.filter(isObj).map((t) => ({ date: t.date, amount: num(t.amount) })) : [] };
}

/** Budget. App: id 'month:YYYY-MM', data {month:'YYYY-MM', amount:number}. Web view: {id:'YYYY-MM', month, limit, categories}.
 *  The app has no per-category limits, so the web adds an extra `categories:{name:limit}` field INSIDE the same record. The app's
 *  sync client keeps only `amount` when it applies a record (known limitation: a phone edit of that month's number drops the
 *  web's category limits; listed as an app tweak in SYNC_SHAPES.md). Separate web-only records are NOT usable: the app's scan
 *  would see them as "gone locally" and push a delete for them. */
export const budgetId = (ym) => 'month:' + ym;
export function decodeBudgets(recs) {
  const out = [];
  for (const r of recs) {
    if (r.kind !== 'budget' || r.deleted || !isObj(r.data)) continue;
    const m = /^month:(\d{4}-\d{2})$/.exec(r.id);
    if (!m) continue;
    const cats = {};
    if (isObj(r.data.categories)) for (const k of Object.keys(r.data.categories)) cats[k] = num(r.data.categories[k]);
    out.push({ id: m[1], month: m[1], limit: num(r.data.amount), categories: cats });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
export function encodeBudgetMonth(ym, limit, categories, prior) {
  const w = { ...(isObj(prior) ? clone(prior) : {}), month: ym, amount: num(limit) };
  if (categories && Object.keys(categories).length) w.categories = categories; else delete w.categories;
  return w;
}

/** Cushion. App: id 'payday', {type:'dollar'|'percent', amount, percent}. Web view: {mode, dollar, percent}. */
export const CUSHION_ID = 'payday';
export function decodeCushion(w) {
  const o = isObj(w) ? w : {};
  return { mode: o.type === 'percent' ? 'percent' : 'dollar', dollar: Math.max(0, num(o.amount)), percent: Math.max(0, num(o.percent)) };
}
export function encodeCushion(view, prior) {
  return { ...(isObj(prior) ? clone(prior) : {}), type: view.mode === 'percent' ? 'percent' : 'dollar', amount: Math.max(0, num(view.dollar)), percent: Math.min(100, Math.max(0, num(view.percent))) };
}

/** Category. App: kind 'category', id 'c:<key>' (hashed 'h_..' when the key has spaces), data {key:'id:<billId>'|'name:<lower name>', value:'Utilities'}.
 *  Read-only on the web (used as the fallback category of bills). The web never writes this kind: any record without the app's
 *  `key` would be deleted by the app's scan. The web's category pick-list = defaults + map values + categories used by bills,
 *  spending and budget limits. */
export function categoryMap(recs) {
  const m = {};
  for (const r of recs) if (r.kind === 'category' && !r.deleted && isObj(r.data) && typeof r.data.key === 'string' && typeof r.data.value === 'string') m[r.data.key] = r.data.value;
  return m;
}
export function categoryNames(recs) {
  const s = new Set();
  for (const r of recs) if (r.kind === 'category' && !r.deleted && isObj(r.data) && typeof r.data.value === 'string' && r.data.value.trim()) s.add(r.data.value.trim());
  return [...s].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
}
