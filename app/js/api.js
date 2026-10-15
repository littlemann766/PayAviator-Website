/* PayAviator web data layer. ONE module; the rest of the app only talks to `api`.
 *
 * Wire contract = Lucian's final cloud sync (backend branch cloud-sync-pause-banks, docs/CLOUD_SYNC_AND_PAUSE.md):
 *   GET    /api/sync/changes?since=<seq>&limit=<1..500> -> { items:[{kind,id,data|null,updatedAt,deleted,seq}], next, more }
 *   POST   /api/sync/push { items:[{kind,id,data,updatedAt,deleted?}] } (max 200) -> { results:[{kind,id,status,reason?,winner?}] }
 *   DELETE /api/sync/all -> { deleted:n }
 * kinds: bill income spending cushion budget goal category. Last-write-wins on updatedAt (ms). Tombstones: deleted:true.
 * Plus (read only): GET /api/plaid/accounts, GET /api/plaid/transactions?limit=250, GET /api/billing/status.
 *
 * Swap point: ADAPTER below. 'stub' = in-memory/localStorage server with demo data that mirrors the same wire shapes;
 * 'live' = real fetch calls. Demo mode (?demo=1 on localhost) always forces the stub. */
import { uuid, num, toISO, monthKey, slug, todayISO, pad } from './util.js';
import * as C from './codec.js';

const ADAPTER = 'live'; // 'live' | 'stub'
export const API_BASE = 'https://api.payaviator.app';
export const KINDS = ['bill', 'income', 'spending', 'cushion', 'budget', 'goal', 'category'];
export const LIMITS = { maxPush: 200, maxItemBytes: 8 * 1024, maxFutureMs: 5 * 60 * 1000 };
const ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiErr = (message, code, status) => Object.assign(new Error(message), { code, status });

/* ------------------------------------------------------------------ transports */

/** Live transport: Bearer Firebase ID token. 401 -> refresh token once (getIdToken(true)). */
function liveTransport(getToken) {
  async function call(method, path, body, retried = false) {
    let token;
    try { token = await getToken(retried); } catch (e) { throw apiErr('Please sign in again.', 'SIGNIN', 401); }
    let r;
    try {
      r = await fetch(API_BASE + path, {
        method, cache: 'no-store', credentials: 'omit',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw apiErr('Can\u2019t reach PayAviator right now.', 'NETWORK', 0); }
    let data = {};
    try { data = await r.json(); } catch (e) { /* non-JSON error body */ }
    if (r.status === 401 && !retried) return call(method, path, body, true);
    if (!r.ok) throw apiErr(data.error || data.message || `Request failed (${r.status}).`, data.code || 'HTTP_' + r.status, r.status);
    return data;
  }
  return {
    mode: 'live',
    changes: (since, limit = 500) => call('GET', `/api/sync/changes?since=${encodeURIComponent(since)}&limit=${limit}`),
    push: (items) => call('POST', '/api/sync/push', { items }),
    deleteAll: () => call('DELETE', '/api/sync/all'),
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body || {}),
    del: (path) => call('DELETE', path),
  };
}

/** Stub "server": same validation, last-write-wins, seq cursor and response shapes as the real /api/sync. Persists to localStorage (demo only). */
function stubTransport(uid) {
  const KEY = 'pa_demo_server_v1:' + uid;
  let db = null;
  const load = () => {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db || !db.rows) { db = { seq: 0, rows: {} }; seedDemo(db); save(); }
    return db;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota: demo only */ } };
  const pub = (r) => ({ kind: r.kind, id: r.id, data: r.deleted ? null : r.data, updatedAt: r.updatedAt, deleted: !!r.deleted, seq: r.seq });
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
  const fp = (it) => stable({ d: !!it.deleted, v: it.deleted ? null : it.data });
  function validate(x, now) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return 'invalid_item';
    if (!KINDS.includes(x.kind)) return 'invalid_kind';
    if (typeof x.id !== 'string' || !ID_RE.test(x.id)) return 'invalid_id';
    if (!Number.isSafeInteger(x.updatedAt) || x.updatedAt <= 0) return 'invalid_updated_at';
    if (x.deleted !== undefined && typeof x.deleted !== 'boolean') return 'invalid_deleted';
    if (x.deleted !== true) {
      if (!x.data || typeof x.data !== 'object' || Array.isArray(x.data)) return 'invalid_data';
      if (new Blob([JSON.stringify(x.data)]).size > LIMITS.maxItemBytes) return 'too_large';
    }
    return null;
  }
  return {
    mode: 'stub',
    async changes(since, limit = 500) {
      const d = load(), lim = Math.max(1, Math.min(500, limit));
      const rows = Object.values(d.rows).filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      const page = rows.slice(0, lim);
      return { items: page.map(pub), next: page.length ? page[page.length - 1].seq : since, more: rows.length > lim };
    },
    async push(items) {
      if (!Array.isArray(items)) throw apiErr('items must be an array.', 'INVALID_BODY', 400);
      if (items.length > LIMITS.maxPush) throw apiErr('At most 200 items per push.', 'TOO_MANY_ITEMS', 413);
      const d = load(), now = Date.now(), results = [];
      for (const x of items) {
        const bad = validate(x, now);
        if (bad) { results.push({ kind: typeof x?.kind === 'string' ? x.kind : null, id: typeof x?.id === 'string' ? x.id : null, status: 'rejected', reason: bad }); continue; }
        const it = { kind: x.kind, id: x.id, data: x.deleted ? null : x.data, deleted: x.deleted === true, updatedAt: Math.min(x.updatedAt, now + LIMITS.maxFutureMs) };
        const k = it.kind + '|' + it.id, cur = d.rows[k];
        if (!cur) { d.rows[k] = { ...it, seq: ++d.seq }; results.push({ kind: it.kind, id: it.id, status: 'accepted' }); }
        else if (cur.updatedAt === it.updatedAt && fp(cur) === fp(it)) results.push({ kind: it.kind, id: it.id, status: 'accepted' });
        else if (it.updatedAt > cur.updatedAt || (it.updatedAt === cur.updatedAt && fp(it) > fp(cur))) { d.rows[k] = { ...it, seq: ++d.seq }; results.push({ kind: it.kind, id: it.id, status: 'accepted' }); }
        else results.push({ kind: it.kind, id: it.id, status: 'rejected', reason: 'stale', winner: pub(cur) });
      }
      save();
      return { results };
    },
    async deleteAll() { const d = load(); const n = Object.keys(d.rows).length; d.rows = {}; d.seq += 1; save(); return { deleted: n }; },
    async get(path) {
      const p = path.split('?')[0], qs = new URLSearchParams(location.search);
      if (p === '/api/plaid/accounts') return demoAccounts(qs);
      if (p === '/api/plaid/transactions') return demoTransactions(qs);
      if (p === '/api/billing/status') return { plan: 'free', source: null, linkedBanks: qs.get('bank') === '0' ? 0 : 1, limit: 1, expiresAt: null, productId: null, state: null, cancelAtPeriodEnd: false, periodEnd: null, grandfathered: qs.get('paused') === '1', pausedBanks: qs.get('paused') === '1' ? 1 : 0 };
      throw apiErr('Not found', 'HTTP_404', 404);
    },
    async post(path) { if (path === '/api/billing/stripe/portal') throw apiErr('Billing is not available in demo mode.', 'NO_STRIPE_CUSTOMER', 400); throw apiErr('Not found', 'HTTP_404', 404); },
    async del(path) { if (path === '/api/plaid/user') return { ok: true }; throw apiErr('Not found', 'HTTP_404', 404); },
    /** Demo/testing only: act like the phone pushed a change (so conflicts and pulls can be exercised). */
    _phone(kind, id, data, opts = {}) {
      const d = load(), k = kind + '|' + id, cur = d.rows[k];
      d.rows[k] = { kind, id, data: opts.deleted ? null : data, deleted: !!opts.deleted, updatedAt: opts.updatedAt || Date.now() + 1, seq: ++d.seq };
      save(); return pub(d.rows[k]);
    },
    _reset() { db = null; localStorage.removeItem(KEY); },
  };
}

/* ------------------------------------------------------------------ demo data (stub only) */
function seedDemo(db) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const day = (n) => toISO(new Date(y, m, n));
  const t = Date.now() - 60000;
  const put = (kind, id, data) => { db.rows[kind + '|' + id] = { kind, id, data, deleted: false, updatedAt: t, seq: ++db.seq }; };
  const bill = (id, d) => put('bill', id, { id, notify: false, notifyDaysBefore: [0], notifyTime: '09:00', notifySound: 'default', notifyVibrate: true, dateMoves: {}, autopay: false, notes: '', paid: false, recurring: true, recurrence: 'monthly', ...d });
  bill('demo-rent', { name: 'Rent', amount: 1450, due: day(1), color: '#3ddc97', category: 'Housing', _ov: { [day(1)]: { paid: true } }, _pa: { [day(1)]: 1450 } });
  bill('demo-electric', { name: 'Electric (Duke Energy)', amount: 118.37, due: day(Math.max(1, now.getDate() - 3)), color: '#e5484d', category: 'Utilities' });
  bill('demo-internet', { name: 'Internet', amount: 74.99, due: day(Math.min(28, now.getDate())), color: '#fbbf24', category: 'Utilities' });
  bill('demo-insurance', { name: 'Car insurance', amount: 132.4, due: day(Math.min(28, now.getDate() + 3)), color: '#3ddc97', category: 'Insurance' });
  bill('demo-phone', { name: 'Phone', amount: 65, due: day(Math.min(28, now.getDate() + 7)), color: '#16e4ea', category: 'Utilities' });
  bill('demo-stream', { name: 'Streaming', amount: 15.49, due: day(Math.min(28, now.getDate() + 9)), color: '#7c98bd', category: 'Subscriptions', recurring: false, recurrence: 'weekly', paid: true, _ov: { [day(Math.min(28, now.getDate() + 9))]: { paid: true } }, _pa: { [day(Math.min(28, now.getDate() + 9))]: 15.49 } });
  put('income', 'demo-pay', { id: 'demo-pay', name: 'Paycheck \u00b7 Acme Co.', amount: 2180.55, date: day(Math.max(1, now.getDate() - 13)), frequency: 'biweekly', incomeType: 'salary', annualSalary: 0 });
  put('income', 'demo-free', { id: 'demo-free', name: 'Freelance', amount: 650, date: day(Math.min(28, now.getDate() + 13 > 28 ? 28 : now.getDate() + 13)), frequency: 'monthly', incomeType: 'salary', annualSalary: 0 });
  put('income', 'profile', { profile: true, type: 'salary', wage: null, salary: '0' });
  put('spending', 'demo-sp1', { id: 'demo-sp1', name: 'Groceries', amount: 84.2, date: day(Math.max(1, now.getDate() - 2)), notes: '', flow: 'spending', source: 'manual', enteredAt: new Date(t).toISOString(), category: 'Groceries' });
  put('spending', 'demo-sp2', { id: 'demo-sp2', name: 'Coffee', amount: 6.5, date: day(Math.max(1, now.getDate() - 1)), notes: '', flow: 'spending', source: 'manual', enteredAt: new Date(t).toISOString(), category: 'Dining out' });
  put('cushion', C.CUSHION_ID, { type: 'dollar', amount: 0, percent: 0 });
  put('budget', C.budgetId(monthKey(y, m)), { month: monthKey(y, m), amount: 4200, categories: { Groceries: 600, 'Dining out': 200, Transport: 250, Utilities: 380, Subscriptions: 60 } });
  put('goal', 'demo-goal1', { id: 'demo-goal1', name: 'Emergency fund', target: 5000, saved: 1800, targetDate: '', transactions: [] });
  put('goal', 'demo-goal2', { id: 'demo-goal2', name: 'Trip', target: 1200, saved: 640, targetDate: '', transactions: [] });
}
function demoAccounts(qs) {
  if (qs.get('bank') !== '1' && qs.get('paused') !== '1') return { accounts: [], items: [], errors: [] };
  const item = { item_id: 'demo-item', institution_name: 'Demo Bank', status: 'good', paused: false, pause_reason: null, needs_update: false };
  const accounts = [
    { account_id: 'a1', name: 'Demo Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { available: 1840.62, current: 1840.62 }, institution_name: 'Demo Bank', item_id: 'demo-item' },
    { account_id: 'a2', name: 'Demo Savings', mask: '5678', type: 'depository', subtype: 'savings', balances: { available: 3200, current: 3200 }, institution_name: 'Demo Bank', item_id: 'demo-item' },
    { account_id: 'a3', name: 'Demo Credit Card', mask: '9012', type: 'credit', subtype: 'credit card', balances: { available: 4200, current: 0, limit: 4200 }, balance_used: 0, credit_limit: 4200, institution_name: 'Demo Bank', item_id: 'demo-item' },
  ];
  const items = [item], errors = [];
  if (qs.get('paused') === '1') {
    items.push({ item_id: 'demo-item2', institution_name: 'Second Demo Bank', status: 'paused', paused: true, pause_reason: 'plus_ended', needs_update: false });
    errors.push({ item_id: 'demo-item2', institution_name: 'Second Demo Bank', code: 'ITEM_PAUSED', message: 'Paused. Resubscribe to Plus to sync this bank.', needs_update: false, paused: true, pause_reason: 'plus_ended' });
  }
  return { accounts, items, errors };
}
function demoTransactions(qs) {
  if (qs.get('bank') !== '1' && qs.get('paused') !== '1') return { transactions: [], errors: [] };
  const d = (n) => toISO(new Date(Date.now() - n * 86400000));
  return { transactions: [
    { transaction_id: 't1', account_id: 'a1', date: d(0), name: 'Grocery Mart', merchant_name: 'Grocery Mart', amount: 52.18, pending: true, institution_name: 'Demo Bank' },
    { transaction_id: 't2', account_id: 'a1', date: d(1), name: 'Coffee House', merchant_name: 'Coffee House', amount: 6.5, pending: false, institution_name: 'Demo Bank' },
    { transaction_id: 't3', account_id: 'a1', date: d(3), name: 'Payroll deposit', merchant_name: 'Acme Co.', amount: -2180.55, pending: false, institution_name: 'Demo Bank' },
  ], errors: [] };
}

/* ------------------------------------------------------------------ sync engine */
const listeners = new Set();
const E = {
  transport: null, uid: null, rec: new Map(), queue: new Map(), cursor: 0,
  status: 'idle', lastSync: null, lastError: null, flushing: false, again: false, timer: null, poll: null, backoff: 2000, loaded: false,
};
const key = (kind, id) => kind + '|' + id;
const emit = (type, detail) => listeners.forEach((fn) => { try { fn({ type, ...detail }); } catch (e) { /* listener errors must not break sync */ } });
function setStatus(s) { if (E.status !== s) { E.status = s; emit('status', { status: s }); } }

function applyRemote(it) {
  const k = key(it.kind, it.id), cur = E.rec.get(k), q = E.queue.get(k);
  if (q && q.updatedAt >= it.updatedAt) return false;            // our pending edit is newer: it will win on push
  if (cur && cur.updatedAt > it.updatedAt) return false;         // already have newer
  E.rec.set(k, { kind: it.kind, id: it.id, data: it.deleted ? null : it.data, deleted: !!it.deleted, updatedAt: it.updatedAt });
  if (q) E.queue.delete(k);
  return true;
}

async function pull() {
  let changed = false, guard = 0;
  for (;;) {
    const r = await E.transport.changes(E.cursor, 500);
    for (const it of r.items || []) if (applyRemote(it)) changed = true;
    E.cursor = r.next ?? E.cursor;
    if (!r.more || ++guard > 200) break;
  }
  if (changed) emit('data', { source: 'remote' });
  return changed;
}

async function flush() {
  if (E.flushing) { E.again = true; return; }
  E.flushing = true; setStatus('busy');
  try {
    do {
      E.again = false;
      while (E.queue.size) {
        const batch = [...E.queue.values()].slice(0, LIMITS.maxPush);
        const sent = new Map(batch.map((b) => [key(b.kind, b.id), b.updatedAt]));
        const payload = batch.map((b) => (b.deleted ? { kind: b.kind, id: b.id, updatedAt: b.updatedAt, deleted: true } : { kind: b.kind, id: b.id, data: b.data, updatedAt: b.updatedAt }));
        const r = await E.transport.push(payload);
        for (const res of r.results || []) {
          const k = key(res.kind, res.id), q = E.queue.get(k);
          if (res.status === 'accepted') { if (q && q.updatedAt === sent.get(k)) E.queue.delete(k); }
          else if (res.reason === 'stale' && res.winner) {
            if (q && q.updatedAt === sent.get(k)) E.queue.delete(k);
            E.rec.delete(k); applyRemote(res.winner);
            emit('conflict', { kind: res.kind, id: res.id });
          } else { // validation / limit: drop so we do not loop forever, tell the UI
            if (q && q.updatedAt === sent.get(k)) E.queue.delete(k);
            E.lastError = { code: res.reason || 'rejected', kind: res.kind, id: res.id };
            emit('rejected', { kind: res.kind, id: res.id, reason: res.reason });
          }
        }
        // anything the server did not answer for stays queued; avoid a hot loop
        if (!(r.results || []).length) break;
      }
    } while (E.again);
    await pull();
    E.lastSync = Date.now(); E.lastError = null; E.backoff = 2000;
    setStatus('ok'); emit('data', { source: 'flush' });
    return true;
  } catch (e) {
    E.lastError = { code: e.code || 'ERROR', message: e.message };
    if (e.code === 'NETWORK') { setStatus('off'); scheduleRetry(); }
    else if (e.code === 'EMAIL_NOT_VERIFIED' || e.code === 'SIGNIN' || e.status === 401 || e.status === 403) { setStatus('error'); emit('auth', { code: e.code }); }
    else { setStatus('error'); scheduleRetry(); }
    return false;
  } finally { E.flushing = false; }
}
function scheduleRetry() {
  clearTimeout(E.timer);
  E.timer = setTimeout(() => { sync(); }, E.backoff);
  E.backoff = Math.min(E.backoff * 2, 60000);
}
export async function sync() { return flush(); }

function writeLocal(kind, id, data, deleted) {
  const k = key(kind, id), cur = E.rec.get(k);
  const updatedAt = Math.max(Date.now(), (cur ? cur.updatedAt : 0) + 1);
  const rec = { kind, id, data: deleted ? null : data, deleted: !!deleted, updatedAt };
  E.rec.set(k, rec);
  E.queue.set(k, rec);
  emit('data', { source: 'local' });
  return flush().then((ok) => ({ ok, synced: ok === true && !E.queue.has(k), queued: E.queue.has(k) }));
}

const live = (kind) => [...E.rec.values()].filter((r) => r.kind === kind && !r.deleted);
const wireOf = (kind, id) => { const r = E.rec.get(key(kind, id)); return r && !r.deleted ? r.data : undefined; };
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const stamp = (v, r) => ({ ...v, updatedAt: r.updatedAt });
const decodeList = (kind, fn) => live(kind).map((r) => { const v = fn(r); return v ? stamp(v, r) : null; }).filter(Boolean);
const catMap = () => C.categoryMap(live('category'));
function checkBudget(m) { if (!/^\d{4}-\d{2}$/.test(m)) throw apiErr('Invalid month', 'INVALID'); }

/* ------------------------------------------------------------------ public API */
export const api = {
  get adapter() { return E.transport ? E.transport.mode : null; },
  /** Call once after sign-in. getToken(force) returns a Firebase ID token (live only). */
  async init({ uid, getToken, demo }) {
    if (E.uid === uid && E.loaded) return;
    this.clearLocal();
    E.uid = uid;
    E.transport = (demo || ADAPTER === 'stub') ? stubTransport(uid) : liveTransport(getToken);
    E.loaded = true;
    await flush();
    clearInterval(E.poll);
    E.poll = setInterval(() => { if (!document.hidden) sync(); }, 30000);
    if (!E.wired) {
      E.wired = true;
      addEventListener('online', () => { if (E.loaded) sync(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden && E.loaded) sync(); });
    }
  },
  /** Sign-out: forget everything held in memory (and demo server data stays only under its own key). */
  clearLocal() {
    clearInterval(E.poll); clearTimeout(E.timer);
    E.rec.clear(); E.queue.clear(); E.cursor = 0; E.uid = null; E.transport = null; E.loaded = false; E.status = 'idle'; E.lastError = null; E.lastSync = null;
    emit('data', { source: 'clear' });
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  sync,
  get status() { return { status: E.status, pending: E.queue.size, lastSync: E.lastSync, error: E.lastError }; },

  /* sync feed primitives (documented interface) */
  changes: (since) => E.transport.changes(since),
  batch: (ops) => E.transport.push(ops), // ops = [{kind,id,data,updatedAt,deleted?}] (max 200)
  async deleteAllCloud() { const r = await E.transport.deleteAll(); this.clearLocal(); return r; },

  bills: {
    list: () => { const cm = catMap(); return decodeList('bill', (r) => C.decodeBill(r.id, r.data, { catMap: cm })).sort((a, b) => a.due.localeCompare(b.due) || byName(a, b)); },
    save: (bill) => { const id = bill.id || uuid(); return writeLocal('bill', id, C.encodeBill(id, bill, wireOf('bill', id)), false); },
    remove: (id) => writeLocal('bill', id, null, true),
    newId: uuid,
  },
  income: {
    list: () => decodeList('income', (r) => C.decodeIncome(r.id, r.data)).sort((a, b) => a.date.localeCompare(b.date) || byName(a, b)),
    save: (x) => { const id = x.id || uuid(); return writeLocal('income', id, C.encodeIncome(id, x, wireOf('income', id)), false); },
    remove: (id) => writeLocal('income', id, null, true),
  },
  spending: {
    list: () => decodeList('spending', (r) => C.decodeSpending(r.id, r.data)).sort((a, b) => b.date.localeCompare(a.date) || byName(a, b)),
    save: (x) => { const id = x.id || uuid(); return writeLocal('spending', id, C.encodeSpending(id, x, wireOf('spending', id)), false); },
    remove: (id) => writeLocal('spending', id, null, true),
  },
  budget: { // app: 'month:YYYY-MM' {month, amount}; web adds categories:{name:limit} inside the same record
    get: (month) => C.decodeBudgets(live('budget')).find((b) => b.id === month) || null,
    list: () => C.decodeBudgets(live('budget')),
    save: (month, d) => { checkBudget(month); const id = C.budgetId(month); return writeLocal('budget', id, C.encodeBudgetMonth(month, Math.max(0, num(d.limit)), d.categories || {}, wireOf('budget', id)), false); },
    remove: (month) => writeLocal('budget', C.budgetId(month), null, true),
  },
  categories: { // read-only: the app's category map (kind 'category') values; the web never writes this kind
    list: () => C.categoryNames(live('category')),
    save: async () => ({ ok: true, synced: true, queued: false }),
  },
  goals: { list: () => decodeList('goal', (r) => C.decodeGoal(r.id, r.data)).sort(byName) }, // read-only in phase 1
  cushion: {
    get: () => C.decodeCushion(wireOf('cushion', C.CUSHION_ID)), // default $0
    save: (d) => writeLocal('cushion', C.CUSHION_ID, C.encodeCushion(d, wireOf('cushion', C.CUSHION_ID)), false),
  },

  /* snapshot used by calc.js */
  data() {
    return { bills: this.bills.list(), income: this.income.list(), spending: this.spending.list(), goals: this.goals.list(), budgets: this.budget.list(), cushion: this.cushion.get() };
  },

  /* read-only server data (memory only, never persisted) */
  accounts: () => E.transport.get('/api/plaid/accounts'),
  transactions: (limit = 250) => E.transport.get('/api/plaid/transactions?limit=' + limit),
  billing: () => E.transport.get('/api/billing/status'),
  billingPortal: () => E.transport.post('/api/billing/stripe/portal', {}),
  /** Delete the whole account: server data first (DELETE /api/plaid/user), then the Firebase user. Caller clears local data. */
  deletePlaidUser: () => E.transport.del('/api/plaid/user'),

  /** Demo/test hook: the stub "server" so tests can simulate the phone. null in live mode. */
  get demo() { return E.transport && E.transport.mode === 'stub' ? { phone: E.transport._phone, reset: E.transport._reset } : null; },
};
export { todayISO, pad };
