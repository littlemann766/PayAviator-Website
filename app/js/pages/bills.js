import { h, icon, money, todayISO, fmtDay, fmtShort, toISO, fromISO, isISO, num, cents } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast, savedToast } from '../ui.js';
import { api } from '../api.js';
import { REPEATS, billOccurrences, billTotals, repeatLabel } from '../calc.js';
import { colorDot, DEFAULT_CATEGORIES, monthNav, viewMonth, stat, emptyState, dueTag } from '../views.js';

const filter = { q: '', cat: '' };
let rerender = () => {};

export function categoryOptions() {
  const set = new Set(DEFAULT_CATEGORIES);
  api.categories.list().forEach((c) => set.add(c.name));
  api.bills.list().forEach((b) => b.category && set.add(b.category));
  return [...set];
}

function openBill(bill, iso) {
  const edit = !!bill, recurring = edit && bill.recurring;
  const view = viewMonth();
  const today = todayISO(), nowM = new Date();
  const defDue = nowM.getFullYear() === view.y && nowM.getMonth() === view.m ? today : toISO(new Date(view.y, view.m, 1));
  const occIso = iso || (bill && bill.due);
  const paidNow = edit ? ((bill.occ && bill.occ[occIso] && bill.occ[occIso].paid) || 0) > 0 || (!(bill.occ && bill.occ[occIso] && bill.occ[occIso].paid != null) && !recurring && !!bill.paid) : false;
  const cats = categoryOptions();
  const values = edit ? { name: bill.name, amount: bill.amount, due: bill.due, repeat: bill.recurring ? bill.recurrence || 'weekly' : 'never', color: bill.color || '#ff0000', category: bill.category || 'Other', notes: bill.notes || '', paid: paidNow }
    : { name: '', amount: '', due: defDue, repeat: 'monthly', color: '#3ddc97', category: 'Utilities', notes: '', paid: false };
  const fields = [
    { name: 'name', label: 'Name', type: 'text', required: true, requiredMsg: 'Enter a name for this bill.', placeholder: 'e.g. Electric', max: 80 },
    { name: 'amount', label: 'Amount', type: 'money', required: true, requiredMsg: 'Enter the bill amount.' },
    { name: 'due', label: 'Due date', type: 'date', required: true, requiredMsg: 'Choose the due date.' },
    { name: 'repeat', label: 'Repeats', type: 'select', options: REPEATS },
    { name: 'category', label: 'Category', type: 'select', options: cats.map((c) => ({ v: c, label: c })) },
    { name: 'color', label: 'Color', type: 'color' },
    { name: 'notes', label: 'Note', type: 'textarea', optional: true, max: 300 },
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
      const data = { ...base, name: v.name.slice(0, 80), amount: cents(v.amount), due: v.due, recurring: recur, recurrence: recur ? v.repeat : 'weekly', color: v.color, category: v.category, notes: v.notes, catFromMap: !!(edit && bill.catFromMap && v.category === bill.category) };
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

function billCard(o, today) {
  const b = o.bill, [cls, txt] = dueTag(o.iso, today, o.status === 'paid');
  const tag = o.status === 'partial' ? ['warn', 'Partly paid'] : [cls, txt];
  return h('button', { class: 'card bill link', type: 'button', 'data-bill': b.id, 'aria-label': `Edit ${b.name}, ${money(o.amount)}, ${fmtShort(o.iso)}`, onclick: () => openBill(b, o.iso) },
    colorDot(b.color),
    h('div', { class: 'bm' }, h('b', { text: b.name }), h('small', { text: `Repeats ${repeatLabel(b).toLowerCase()} \u00b7 ${o.status === 'paid' ? 'Paid' : o.status === 'partial' ? 'Partly paid' : 'Unpaid'}` }), b.category ? h('span', { class: 'chip', text: b.category }) : null),
    h('div', { class: 'amt' }, h('b', { text: money(o.amount) }), h('span', { class: 'tag ' + tag[0], text: tag[1] })), icon('pencil', 'ic sm edit'));
}

function render(main) {
  const view = viewMonth(), all = api.bills.list();
  let occ = billOccurrences(all, view.y, view.m);
  const t = billTotals(occ), today = todayISO();
  const q = filter.q.trim().toLowerCase();
  const shown = occ.filter((o) => (!q || o.bill.name.toLowerCase().includes(q) || (o.bill.category || '').toLowerCase().includes(q)) && (!filter.cat || o.bill.category === filter.cat));
  const search = h('input', { type: 'search', placeholder: 'Search bills', 'aria-label': 'Search bills', value: filter.q });
  search.addEventListener('input', () => { filter.q = search.value; rerender(); const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
  const cat = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'), categoryOptions().map((c) => h('option', { value: c, selected: filter.cat === c }, c)));
  cat.addEventListener('change', () => { filter.cat = cat.value; rerender(); });
  const addBtn = h('button', { class: 'btn primary', type: 'button', 'data-add': 'bill', onclick: () => openBill(null) }, icon('plus'), h('span', { text: 'Add bill' }));
  const list = [];
  if (!all.length) list.push(emptyState({ icn: 'bills', title: 'No bills yet', text: 'Add your first bill to see due dates and what is left to pay. Bills you added in the phone app appear here after you update the app to 4.1.5 or later and sign in with the same account.', action: h('button', { class: 'btn primary', type: 'button', onclick: () => openBill(null) }, icon('plus'), h('span', { text: 'Add bill' })) }));
  else if (!shown.length) list.push(emptyState({ icn: 'search', title: occ.length ? 'No bills match' : 'No bills this month', text: occ.length ? 'Try a different search or category.' : 'Nothing is due this month. Use the arrows to look at another month.' }));
  else { let last = ''; const wrap = h('div', { class: 'billwrap' }); for (const o of shown) { if (o.iso !== last) { wrap.append(h('h3', { class: 'day', text: fmtDay(o.iso) })); last = o.iso; } wrap.append(billCard(o, today)); } list.push(wrap); }
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'tb-l' }, monthNav(() => rerender()), h('small', { 'data-count': '', text: `${t.count} bill${t.count === 1 ? '' : 's'} \u00b7 ${money(t.total)} total` })), addBtn),
    h('div', { class: 'grid sum' }, stat('Unpaid this month', money(t.unpaid), '', 'unpaid'), stat('Overdue', t.overdue ? `${t.overdue} bill${t.overdue > 1 ? 's' : ''}` : 'None', t.overdue ? 'neg' : '', 'overdue'), stat('Paid so far', money(t.paid), '', 'paid')),
    h('div', { class: 'filters' }, h('label', { class: 'search' }, icon('search'), search), h('label', { class: 'sel2' }, cat, icon('chevd', 'ic sm'))), ...list);
}

bootPage({ key: 'bills.html', title: 'Bills', sub: 'Search, filter and manage your bills.', render: (m) => render(m) }).then((sh) => { if (sh) rerender = () => render(sh.main); });
