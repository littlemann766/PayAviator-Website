/* Shared add/edit forms for bills and income (used by Bills, Income and Calendar). */
import { todayISO, fmtShort, toISO, isISO, cents, uuid } from './util.js';
import { openSheet, confirmDialog, toast } from './ui.js';
import { api } from './api.js';
import { REPEATS, INCOME_FREQ } from './calc.js';
import { viewMonth } from './views.js';
import { DEFAULT_CATEGORIES } from './views.js';

export function categoryOptions() {
  const set = new Set(DEFAULT_CATEGORIES);
  api.categories.list().forEach((c) => set.add(c.name));
  api.bills.list().forEach((b) => b.category && set.add(b.category));
  return [...set];
}

export function openBill(bill, iso, opts = {}) {
  const edit = !!bill, recurring = edit && bill.recurring;
  const view = viewMonth();
  const today = todayISO(), nowM = new Date();
  const defDue = opts.date || (nowM.getFullYear() === view.y && nowM.getMonth() === view.m ? today : toISO(new Date(view.y, view.m, 1)));
  const occIso = iso || (bill && bill.due);
  const paidNow = edit ? ((bill.occ && bill.occ[occIso] && bill.occ[occIso].paid) || 0) > 0 || (!(bill.occ && bill.occ[occIso] && bill.occ[occIso].paid != null) && !recurring && !!bill.paid) : false;
  const cats = categoryOptions();
  const values = edit ? { name: bill.name, amount: bill.amount, due: bill.due, repeat: bill.recurring ? bill.recurrence || 'weekly' : 'never', color: bill.color || '#ff0000', category: bill.category || 'Other', notes: bill.notes || '', autopay: !!bill.autopay, paid: paidNow }
    : { name: '', amount: '', due: defDue, repeat: 'monthly', color: '#3ddc97', category: 'Utilities', notes: '', autopay: false, paid: false };
  const fields = [
    { name: 'name', label: 'Name', type: 'text', required: true, requiredMsg: 'Enter a name for this bill.', placeholder: 'e.g. Electric', max: 80 },
    { name: 'amount', label: 'Amount', type: 'money', required: true, requiredMsg: 'Enter the bill amount.' },
    { name: 'due', label: 'Due date', type: 'date', required: true, requiredMsg: 'Choose the due date.' },
    { name: 'repeat', label: 'Repeats', type: 'select', options: REPEATS },
    { name: 'category', label: 'Category', type: 'select', options: cats.map((c) => ({ v: c, label: c })) },
    { name: 'color', label: 'Color', type: 'color' },
    { name: 'notes', label: 'Note', type: 'textarea', optional: true, max: 300 },
    { name: 'autopay', type: 'switch', label: 'Autopay', hint: 'Just a reminder that this bill pays itself. Same as the app.' },
    { name: 'paid', type: 'switch', label: recurring ? `Paid for ${fmtShort(occIso)}` : 'Paid', hint: recurring ? 'Marks this one occurrence as paid.' : 'Counts toward what you have paid this month.' },
  ];
  openSheet({
    title: edit ? 'Edit bill' : 'Add bill', sub: edit ? 'Changes also appear in the app.' : 'It will appear in the app too.', fields, values, submitText: edit ? 'Save changes' : 'Add bill',
    onDelete: edit ? async (entry) => {
      const ok = await confirmDialog({ title: 'Delete this bill?', text: bill.recurring ? `\u201c${bill.name}\u201d and all of its repeats will be removed here and in the app.` : `\u201c${bill.name}\u201d will be removed here and in the app.`, confirmText: 'Delete bill' });
      if (!ok) return; entry.close(); const r = await api.bills.remove(bill.id); toast(r.queued ? 'Deleted. Will sync when you are back online.' : 'Deleted. Synced to your phone.');
    } : null,
    onSubmit: async (v) => {
      const recur = v.repeat !== 'never';
      const base = edit ? { ...bill } : {}; delete base.id; delete base.updatedAt;
      const data = { ...base, name: v.name.slice(0, 80), amount: cents(v.amount), due: v.due, recurring: recur, recurrence: recur ? v.repeat : 'weekly', color: v.color, category: v.category, notes: v.notes, autopay: !!v.autopay, catFromMap: !!(edit && bill.catFromMap && v.category === bill.category) };
      // paid marks live in occ (the app's per-date maps). One-time bill: its own due date; repeating bill: the occurrence being edited.
      const occ = { ...(base.occ || {}) }, target = recur ? (occIso && edit ? occIso : v.due) : v.due;
      if (!recur && edit && bill.due !== v.due) delete occ[bill.due];
      if (v.paid) occ[target] = { ...(occ[target] || {}), paid: cents(v.amount) }; else if (occ[target] && occ[target].paid != null) occ[target] = { ...occ[target], paid: 0 };
      data.occ = occ; data.paid = !recur && v.paid;
      if (!isISO(data.due)) throw new Error('Choose a valid due date.');
      return api.bills.save({ id: edit ? bill.id : api.bills.newId(), ...data });
    },
  });
}

export function openIncome(inc, opts = {}) {
  const edit = !!inc, view = viewMonth(), nowM = new Date();
  const defDate = opts.date || (nowM.getFullYear() === view.y && nowM.getMonth() === view.m ? todayISO() : `${view.y}-${String(view.m + 1).padStart(2, '0')}-01`);
  const values = edit ? { name: inc.name, amount: inc.amount, date: inc.date, frequency: inc.frequency || 'biweekly' } : { name: '', amount: '', date: defDate, frequency: 'biweekly' };
  openSheet({
    title: edit ? 'Edit income' : 'Add income', sub: edit ? 'Changes also appear in the app.' : 'It will appear in the app too.', submitText: edit ? 'Save changes' : 'Add income', values,
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, requiredMsg: 'Enter a name, like \u201cPaycheck\u201d.', placeholder: 'e.g. Paycheck', max: 80 },
      { name: 'amount', label: 'Amount (each time)', type: 'money', required: true, requiredMsg: 'Enter the amount you receive.' },
      { name: 'date', label: 'Pay date', type: 'date', required: true, requiredMsg: 'Choose a pay date.', hint: 'For repeating income, use any one pay date. We work out the rest.' },
      { name: 'frequency', label: 'Repeats', type: 'select', options: INCOME_FREQ },
    ],
    onDelete: edit ? async (entry) => {
      if (!(await confirmDialog({ title: 'Delete this income?', text: `\u201c${inc.name}\u201d will be removed here and in the app.`, confirmText: 'Delete income' }))) return;
      entry.close(); const r = await api.income.remove(inc.id); toast(r.queued ? 'Deleted. Will sync when you are back online.' : 'Deleted. Synced to your phone.');
    } : null,
    onSubmit: (v) => {
      const base = edit ? { ...inc } : {}; delete base.id; delete base.updatedAt;
      return api.income.save({ id: edit ? inc.id : uuid(), ...base, name: v.name.slice(0, 80), amount: cents(v.amount), date: v.date, frequency: v.frequency }); // codec keeps the app's incomeType/annualSalary; an amount typed here on an hourly paycheck switches it to 'salary' so the phone does not recompute it
    },
  });
}

