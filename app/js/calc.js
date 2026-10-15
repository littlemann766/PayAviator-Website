/* Safe to Spend and month maths. A documented SUBSET of the Android app's logic (see README "Differences").
   Ported from /workspace/pa-420/wt/index.html (4.1.4): isRecurringOnDate, paycheckOnDate, monthlyIncomeFor,
   monthlyPaidFor, PayAviatorMonthState985 (ledger), pp967 state() (Safe to Spend), pp973Scale (gauge scale). */
import { num, cents, toISO, fromISO, daysBetween, todayISO } from './util.js';

export const REPEATS = [
  { v: 'never', label: 'Never' },
  { v: 'weekly', label: 'Weekly' },
  { v: 'biweekly', label: 'Every 2 weeks' },
  { v: 'monthly', label: 'Monthly' },
];
export const INCOME_FREQ = [
  { v: 'one-time', label: 'One time' },
  { v: 'weekly', label: 'Weekly' },
  { v: 'biweekly', label: 'Every 2 weeks' },
  { v: 'semimonthly', label: 'Twice a month' },
  { v: 'monthly', label: 'Monthly' },
];
export const repeatLabel = (b) => (b.recurring ? (REPEATS.find((r) => r.v === b.recurrence) || {}).label || 'Weekly' : 'Never');
export const freqLabel = (f) => (INCOME_FREQ.find((r) => r.v === f) || {}).label || 'Every 2 weeks';

const lastDayOf = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Does bill `b` ({due, recurring, recurrence, recurringUntil?, occ?}) fall on local date `d`? (app: isRecurringOnDate) */
export function billOnDate(b, d) {
  const iso = toISO(d);
  if (b.recurringUntil && iso >= b.recurringUntil) return false;
  if (b.dateMoves && Object.prototype.hasOwnProperty.call(b.dateMoves, iso)) return false; // moved occurrence = its own one-time bill in the app
  if (!b.recurring) return b.due === iso;
  const start = fromISO(b.due), target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((target - start) / 86400000);
  if (diff < 0) return false;
  const freq = b.recurrence || 'weekly';
  if (freq === 'weekly') return diff % 7 === 0;
  if (freq === 'biweekly') return diff % 14 === 0;
  if (freq === 'monthly') return target.getDate() === Math.min(start.getDate(), lastDay(target));
  return false;
}
const lastDay = lastDayOf;

/** Per-occurrence paid amount (app: billPaidAmount): occ[iso].paid overrides, else bill.paid means fully paid. */
export function billPaidAmount(b, iso) {
  const o = b.occ && b.occ[iso];
  if (o && o.paid != null) return Math.max(0, num(o.paid));
  return b.paid ? num(b.amount) : 0;
}

export function monthDates(y, m) {
  const out = [], last = new Date(y, m + 1, 0).getDate();
  for (let day = 1; day <= last; day++) out.push(new Date(y, m, day));
  return out;
}

/** All bill occurrences in a month, sorted by date then name. */
export function billOccurrences(bills, y, m) {
  const rows = [], today = todayISO();
  for (const d of monthDates(y, m)) {
    const iso = toISO(d);
    for (const b of bills) {
      if (!billOnDate(b, d)) continue;
      if (b.occ && b.occ[iso] && b.occ[iso].deleted) continue;
      const amount = num(b.amount), paid = billPaidAmount(b, iso);
      const status = paid <= 0 ? 'unpaid' : paid < amount ? 'partial' : 'paid';
      rows.push({ bill: b, id: b.id, iso, amount, paid, status, overdue: status !== 'paid' && iso < today });
    }
  }
  return rows.sort((a, b) => a.iso.localeCompare(b.iso) || String(a.bill.name).localeCompare(String(b.bill.name)));
}
export function billTotals(occ) {
  let total = 0, paid = 0, overdue = 0;
  for (const o of occ) { total += o.amount; paid += Math.min(o.paid, o.amount) || 0; if (o.overdue) overdue++; }
  return { total: cents(total), paid: cents(paid), unpaid: cents(Math.max(0, total - paid)), overdue, count: occ.length };
}

export function incomeOnDate(p, d) {
  const start = fromISO(p.date), target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((target - start) / 86400000);
  if (diff < 0) return false;
  const f = p.frequency;
  if (f === 'one-time') return diff === 0;
  if (f === 'weekly') return diff % 7 === 0;
  if (f === 'biweekly' || f === 'bi-weekly') return diff % 14 === 0;
  if (f === 'monthly') return target.getDate() === Math.min(start.getDate(), lastDay(target));
  if (f === 'semimonthly' || f === 'semi-monthly' || f === 'semi_monthly') {
    const day = target.getDate(), ld = lastDay(target), a = start.getDate();
    if (a === 1 || a === 15) return day === 1 || day === 15;
    return day === Math.min(a, ld) || day === Math.min(a + 15 > ld ? ld : a + 15, ld);
  }
  return diff % 14 === 0;
}
export function incomeAmountOn(p, iso) {
  const o = p.occ && p.occ[iso];
  if (o && o.deleted) return 0;
  if (o && o.amount != null) return cents(Math.max(0, num(o.amount)));
  return cents(Math.max(0, num(p.amount)));
}
/** Income occurrences in a month with `received` = on or before today. */
export function incomeOccurrences(list, y, m) {
  const rows = [], today = todayISO();
  for (const d of monthDates(y, m)) {
    const iso = toISO(d);
    for (const p of list) {
      if (!incomeOnDate(p, d)) continue;
      const amount = incomeAmountOn(p, iso);
      if (amount <= 0 && p.occ && p.occ[iso] && p.occ[iso].deleted) continue;
      rows.push({ inc: p, id: p.id, iso, amount, received: iso <= today });
    }
  }
  return rows;
}
export function incomeTotals(occ) {
  let expected = 0, received = 0;
  for (const o of occ) { expected += o.amount; if (o.received) received += o.amount; }
  return { expected: cents(expected), received: cents(received), pending: cents(expected - received) };
}

export const isFunds = (x) => /^(refund|funds|credit)$/i.test(String((x && (x.flow || x.type)) || ''));
export function spendingInMonth(list, y, m) {
  return list.filter((x) => { const d = fromISO(x.date); return d.getFullYear() === y && d.getMonth() === m; });
}
export function goalContributions(goals, y, m) {
  let t = 0;
  for (const g of goals) for (const x of g.transactions || []) {
    const d = fromISO(x.date || '');
    if (!isNaN(d) && d.getFullYear() === y && d.getMonth() === m) t += Math.max(0, num(x.amount));
  }
  return t;
}

/** Ledger (app: PayAviatorMonthState985): received checks + funds - paid bills - spending - savings. */
export function monthState(data, y, m) {
  const rows = spendingInMonth(data.spending, y, m);
  const funds = rows.filter(isFunds).reduce((s, x) => s + Math.abs(num(x.amount)), 0);
  const spending = rows.filter((x) => !isFunds(x)).reduce((s, x) => s + Math.abs(num(x.amount)), 0);
  const occ = billOccurrences(data.bills, y, m), bt = billTotals(occ);
  const inc = incomeTotals(incomeOccurrences(data.income, y, m));
  const savings = goalContributions(data.goals, y, m);
  const available = inc.received + funds - bt.paid - spending - savings;
  return { income: inc.received, expectedIncome: inc.expected, funds, spending, billsPaid: bt.paid, savings, available: cents(available), remaining: bt.unpaid, totalBills: bt.total };
}

export const cushionAmount = (c, base = 0) => {
  if (!c) return 0;
  return c.mode === 'percent' ? Math.max(0, base) * Math.min(100, Math.max(0, num(c.percent))) / 100 : Math.max(0, num(c.dollar));
};

/* Bank account helpers (app: kind(), bal(), included()). Accounts come from /api/plaid/accounts. */
export function acctKind(a) {
  const t = String(a.type || '').toLowerCase(), st = String(a.subtype || '').toLowerCase();
  if (t === 'credit' || t === 'loan' || /credit|mortgage|student|auto/.test(st)) return 'debt';
  if (/savings|money market|certificate|(^|\s)cd(\s|$)/.test(st)) return 'savings';
  if (t === 'depository' && /checking|cash management/.test(st)) return 'checking';
  return t === 'depository' ? 'cash' : 'other';
}
export function acctBal(a, which = 'available', signed = false) {
  const b = a.balances || {};
  const av = a.available ?? b.available, cur = a.current ?? b.current ?? a.balance;
  const v = num(which === 'current' ? (cur ?? av) : (av ?? cur));
  return signed ? v : Math.max(0, v);
}
/* Same rule as the Android app (PayAviatorAvailableNow): checking only by default (savings, money market, CD, HSA, prepaid are left out),
   credit/loan/investment never count, and the per-account Include/Exclude choice (payaviator_account_choices_v920) wins. */
export const CHOICES_KEY = 'payaviator_account_choices_v920';
const nrm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function acctChoiceKeys(a) {
  const id = String(a.id || a.account_id || a.accountId || '');
  const mask = nrm(a.mask), inst = nrm(a.institutionName || a.institution || a.institution_name || 'Connected institution');
  const first = mask ? [inst, mask, nrm(a.type), nrm(a.subtype), nrm(a.officialName || a.official_name || a.name)].join('|') : (id || [inst, nrm(a.type), nrm(a.subtype), nrm(a.name)].join('|'));
  return [first, id].filter(Boolean);
}
export function readChoices() { try { const c = JSON.parse(localStorage.getItem(CHOICES_KEY) || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (_) { return {}; } }
export function acctChoice(a) { const c = readChoices(); for (const k of acctChoiceKeys(a)) if (typeof c[k] === 'boolean') return c[k]; return undefined; }
export function setAcctChoice(a, on) { const c = readChoices(); acctChoiceKeys(a).forEach((k) => { c[k] = !!on; }); localStorage.setItem(CHOICES_KEY, JSON.stringify(c)); }
const savingsLike = (a) => /^(savings|money market|cd|certificate of deposit|hsa|cash isa|prepaid)$/.test(nrm(a.subtype));
export function acctIncluded(a) {
  if (nrm(a.type) !== 'depository') return false;
  const c = acctChoice(a);
  return c !== undefined ? c : !savingsLike(a);
}

/** Safe to Spend (app: pp967 state()). Linked spendable accounts are the authority when present; otherwise the ledger. */
export function safeToSpend(data, accounts, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const ms = monthState(data, y, m);
  const inc = accounts.filter(acctIncluded);
  const bankAvailable = inc.reduce((s, a) => s + acctBal(a, 'available', true), 0);
  const bankSavings = accounts.filter((a) => acctKind(a) === 'savings').reduce((s, a) => s + acctBal(a), 0);
  const creditUsed = accounts.filter((a) => acctKind(a) === 'debt').reduce((s, a) => s + acctBal(a, 'current'), 0);
  const source = inc.length ? 'bank' : 'ledger';
  const available = Math.max(0, source === 'bank' ? bankAvailable : ms.available);
  const cushion = cents(cushionAmount(data.cushion, available));
  const safe = cents(Math.max(0, available - cushion));
  return { ...ms, source, available: cents(available), bankAvailable: cents(bankAvailable), savings: cents(bankSavings), creditUsed: cents(creditUsed), cushion, safe, hasBank: inc.length > 0 };
}

/* Gauge scale (app: pp973Scale + niceMax). */
export function niceMax(v) {
  v = Math.max(100, num(v));
  const raw = v * 1.12, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
export function gaugeScale(value, main = true) {
  const v = Math.max(0, num(value));
  if (main) { let max = niceMax(v); if (max < 500) max = 500; return { max, marks: [0, 0.25, 0.5, 0.75, 1].map((k) => k * max) }; }
  const max = niceMax(v);
  return { max, marks: [0, 0.1, 0.25, 0.5, 1].map((k) => k * max) };
}
/** Needle position 0..1 across the evenly spaced labels, linear between marks. */
export function gaugePos(value, marks) {
  const v = Math.max(0, Math.min(num(value), marks[marks.length - 1]));
  for (let i = 0; i < marks.length - 1; i++) {
    if (v <= marks[i + 1]) { const span = marks[i + 1] - marks[i] || 1; return (i + (v - marks[i]) / span) / (marks.length - 1); }
  }
  return 1;
}
export { daysBetween };
