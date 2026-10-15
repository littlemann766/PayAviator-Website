import { h, icon, money, todayISO, fmtShort, cents, monthKey, toISO, fromISO, uuid, num, fmtMonth } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast } from '../ui.js';
import { api } from '../api.js';
import { monthState, billOccurrences, billTotals, spendingInMonth, isFunds, incomeOccurrences, incomeTotals } from '../calc.js';
import { DEFAULT_CATEGORIES, monthNav, viewMonth, stat, emptyState, bar } from '../views.js';

let rerender = () => {};
const catList = () => { const s = new Set(DEFAULT_CATEGORIES); api.categories.list().forEach((c) => s.add(c.name)); api.bills.list().forEach((b) => b.category && s.add(b.category)); api.spending.list().forEach((x) => x.category && s.add(x.category)); const b = api.budget.get(monthKey(viewMonth().y, viewMonth().m)); if (b) Object.keys(b.categories || {}).forEach((c) => s.add(c)); return [...s]; };

function openSpending(sp) {
  const edit = !!sp, view = viewMonth(), nowM = new Date();
  const defDate = nowM.getFullYear() === view.y && nowM.getMonth() === view.m ? todayISO() : `${view.y}-${String(view.m + 1).padStart(2, '0')}-01`;
  const values = edit ? { name: sp.name, amount: sp.amount, date: sp.date, flow: isFunds(sp) ? 'refund' : 'spending', category: sp.category || 'Other', notes: sp.notes || '' } : { name: '', amount: '', date: defDate, flow: 'spending', category: 'Groceries', notes: '' };
  openSheet({
    title: edit ? 'Edit spending' : 'Add spending', sub: 'Counts toward your budget and Safe to Spend.', submitText: edit ? 'Save changes' : 'Add spending', values,
    fields: [
      { name: 'name', label: 'What was it?', type: 'text', required: true, requiredMsg: 'Enter what this was for.', placeholder: 'e.g. Groceries', max: 80 },
      { name: 'amount', label: 'Amount', type: 'money', required: true, requiredMsg: 'Enter an amount greater than $0.00.' },
      { name: 'date', label: 'Date', type: 'date', required: true, requiredMsg: 'Choose a date.' },
      { name: 'flow', label: 'Type', type: 'select', options: [{ v: 'spending', label: 'Spending' }, { v: 'refund', label: 'Refund or extra funds' }] },
      { name: 'category', label: 'Category', type: 'select', options: catList().map((c) => ({ v: c, label: c })) },
      { name: 'notes', label: 'Note', type: 'textarea', optional: true, max: 300 },
    ],
    onDelete: edit ? async (entry) => {
      if (!(await confirmDialog({ title: 'Delete this entry?', text: `\u201c${sp.name}\u201d will be removed here and in the app.`, confirmText: 'Delete' }))) return;
      entry.close(); const r = await api.spending.remove(sp.id); toast(r.queued ? 'Deleted. Will sync when you are back online.' : 'Deleted. Synced to your phone.');
    } : null,
    onSubmit: (v) => { const base = edit ? { ...sp } : {}; delete base.id; delete base.updatedAt; return api.spending.save({ id: edit ? sp.id : uuid(), ...base, name: v.name.slice(0, 80), amount: cents(v.amount), date: v.date, flow: v.flow, category: v.category, notes: v.notes }); },
  });
}

function openLimits() {
  const view = viewMonth(), key = monthKey(view.y, view.m), cur = api.budget.get(key) || { limit: 0, categories: {} };
  const cats = catList();
  const fields = [{ name: 'limit', label: 'Total monthly budget', type: 'money', allowZero: true, optional: true, hint: 'Leave blank to budget from your income.' }];
  const values = { limit: cur.limit ? cur.limit : '' };
  cats.forEach((c, i) => { fields.push({ name: 'c' + i, label: c, type: 'money', optional: true, allowZero: true }); values['c' + i] = cur.categories && cur.categories[c] ? cur.categories[c] : ''; });
  fields.push({ name: 'newName', label: 'New category', type: 'text', optional: true, max: 40, placeholder: 'e.g. Pets' }, { name: 'newLimit', label: 'New category limit', type: 'money', optional: true, allowZero: true });
  openSheet({
    title: `Budget limits \u00b7 ${fmtMonth(view.y, view.m)}`, sub: 'Set a limit for each category. Blank means no limit.', fields, values, submitText: 'Save limits',
    onSubmit: async (v) => {
      const categories = {};
      cats.forEach((c, i) => { const n = v['c' + i]; if (Number.isFinite(n) && n > 0) categories[c] = cents(n); });
      const name = String(v.newName || '').trim();
      if (name) { if (!(v.newLimit > 0)) throw new Error('Enter a limit for the new category.'); categories[name] = cents(v.newLimit); await api.categories.save(name); }
      return api.budget.save(key, { limit: Number.isFinite(v.limit) ? cents(v.limit) : 0, categories });
    },
  });
}

async function copyPrevious() {
  const view = viewMonth(), prev = new Date(view.y, view.m - 1, 1), py = prev.getFullYear(), pm = prev.getMonth();
  const nonRec = []; const seen = new Set();
  for (const o of billOccurrences(api.bills.list(), py, pm)) if (!o.bill.recurring && !seen.has(o.id)) { seen.add(o.id); nonRec.push(o.bill); }
  const prevBudget = api.budget.get(monthKey(py, pm)), hasCur = api.budget.get(monthKey(view.y, view.m));
  const copyBudget = !!prevBudget && !hasCur;
  if (!nonRec.length && !copyBudget) { toast(`Nothing to copy from ${prev.toLocaleDateString('en-US', { month: 'long' })}.`, 'warn'); return; }
  const parts = []; if (nonRec.length) parts.push(`${nonRec.length} one-time bill${nonRec.length === 1 ? '' : 's'}`); if (copyBudget) parts.push('your budget limits');
  if (!(await confirmDialog({ title: 'Copy previous month?', text: `Copy ${parts.join(' and ')} from ${prev.toLocaleDateString('en-US', { month: 'long' })} into ${fmtMonth(view.y, view.m)}?`, confirmText: 'Copy', danger: false, icn: 'copy' }))) return;
  const have = api.bills.list(); let n = 0; const ops = [];
  for (const b of nonRec) {
    const old = fromISO(b.due), day = Math.min(old.getDate(), new Date(view.y, view.m + 1, 0).getDate()), due = toISO(new Date(view.y, view.m, day));
    if (have.some((x) => !x.recurring && x.name === b.name && x.due === due)) continue;
    const { id, updatedAt, occ, ...rest } = b; ops.push(api.bills.save({ ...rest, id: uuid(), due, paid: false })); n++;
  }
  if (copyBudget) ops.push(api.budget.save(monthKey(view.y, view.m), { limit: prevBudget.limit, categories: prevBudget.categories }));
  const res = await Promise.all(ops);
  toast(res.some((r) => r.queued) ? `Copied ${n} bill${n === 1 ? '' : 's'}. Will sync when you are back online.` : `Copied${n ? ` ${n} bill${n === 1 ? '' : 's'}` : ''}${copyBudget ? ' and limits' : ''}. Synced to your phone.`);
}

function render(main) {
  const view = viewMonth(), key = monthKey(view.y, view.m), data = api.data();
  const ms = monthState(data, view.y, view.m), bud = api.budget.get(key);
  const bills = billOccurrences(data.bills, view.y, view.m), bt = billTotals(bills);
  const rows = spendingInMonth(data.spending, view.y, view.m).sort((a, b) => b.date.localeCompare(a.date));
  const spentOnly = rows.reduce((s, x) => s + (isFunds(x) ? -Math.abs(num(x.amount)) : Math.abs(num(x.amount))), 0);
  const spent = cents(bt.paid + spentOnly);
  const inc = incomeTotals(incomeOccurrences(data.income, view.y, view.m));
  const incomeBase = cents(inc.received + ms.funds);
  const budget = bud && bud.limit > 0 ? bud.limit : incomeBase;
  const left = cents(budget - spent);

  const bySpent = {};
  rows.filter((x) => !isFunds(x)).forEach((x) => { const c = x.category || 'Other'; bySpent[c] = (bySpent[c] || 0) + Math.abs(num(x.amount)); });
  bills.forEach((o) => { if (o.paid > 0) { const c = o.bill.category || 'Other'; bySpent[c] = (bySpent[c] || 0) + o.paid; } });
  const limits = bud && bud.categories ? Object.entries(bud.categories) : [];

  const actions = h('div', { class: 'tb-r' },
    h('button', { class: 'btn ghost', type: 'button', 'data-act': 'copy', onclick: copyPrevious }, icon('copy'), h('span', { text: 'Copy previous month' })),
    h('button', { class: 'btn primary', type: 'button', 'data-add': 'spending', onclick: () => openSpending(null) }, icon('plus'), h('span', { text: 'Add spending' })));

  const limitsCard = h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Monthly budget & limits' }), h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'limits', onclick: openLimits }, icon('pencil'), h('span', { text: 'Edit limits' }))),
    limits.length ? h('ul', { class: 'bars' }, limits.map(([c, lim]) => { const sp = cents(bySpent[c] || 0), pct = lim > 0 ? sp / lim * 100 : 0; return h('li', { 'data-cat': c }, h('div', { class: 'cr' }, h('b', { text: c }), h('span', null, money(sp), ' ', h('small', { text: `of ${money(lim)}` }))), bar(pct)); }))
      : h('p', { class: 'muted', text: 'No category limits yet. Tap \u201cEdit limits\u201d to set one.' }));

  const spendCard = h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Spending this month' })),
    rows.length ? h('ul', { class: 'slist sp-list' }, rows.map((x) => h('li', null, h('button', { class: 'rowl rowbtn', type: 'button', 'data-spend': x.id, 'aria-label': `Edit ${x.name}, ${money(x.amount)}`, onclick: () => openSpending(x) },
      h('span', { class: 'ib' }, icon(isFunds(x) ? 'coins' : 'cash')), h('div', { class: 'bn' }, h('b', { text: x.name }), h('small', { text: `${fmtShort(x.date)}${x.category ? ' \u00b7 ' + x.category : ''}` })), h('div', { class: 'amt' }, h('b', { class: isFunds(x) ? 'pos' : '', text: (isFunds(x) ? '+' : '') + money(Math.abs(x.amount)) })), icon('pencil', 'ic sm edit')))))
      : h('p', { class: 'muted', text: 'No spending entered for this month. Add what you spend in cash or elsewhere so Safe to Spend stays accurate.' }));

  const goals = data.goals;
  const goalCard = h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Savings goals' })),
    goals.length ? h('ul', { class: 'bars' }, goals.map((g) => { const pct = g.target > 0 ? num(g.saved) / g.target * 100 : 0; return h('li', null, h('div', { class: 'cr' }, h('b', { text: g.name }), h('span', null, money(g.saved || 0), ' ', h('small', { text: `of ${money(g.target || 0)}` }))), bar(pct, 'saved')); })) : h('p', { class: 'muted', text: 'No goals yet. Create goals in the Android app and they appear here.' }),
    h('p', { class: 's-note', text: 'Goals are view-only on the web for now.' }));

  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'tb-l' }, monthNav(() => rerender()), h('small', { text: `${limits.length} categor${limits.length === 1 ? 'y' : 'ies'} with limits` })), actions),
    h('div', { class: 'grid sum' }, stat(bud && bud.limit > 0 ? 'Monthly budget' : 'Income', money(budget), '', 'budget'), stat('Spent + bills', money(spent), '', 'spent'), stat('Left this month', money(left), left < 0 ? 'neg' : 'pos', 'left')),
    h('div', { class: 'grid two' }, h('div', { class: 'col-r' }, limitsCard, goalCard), spendCard));
}
bootPage({ key: 'budget.html', title: 'Budget', sub: 'Planning, categories and savings.', render: (m) => render(m) }).then((sh) => { if (sh) rerender = () => render(sh.main); });
