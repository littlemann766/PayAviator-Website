import { h, icon, money, todayISO, fmtShort, cents, uuid } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast } from '../ui.js';
import { api } from '../api.js';
import { INCOME_FREQ, incomeOccurrences, incomeTotals, freqLabel } from '../calc.js';
import { monthNav, viewMonth, stat, emptyState } from '../views.js';

let rerender = () => {};

function openIncome(inc) {
  const edit = !!inc, view = viewMonth(), nowM = new Date();
  const defDate = nowM.getFullYear() === view.y && nowM.getMonth() === view.m ? todayISO() : `${view.y}-${String(view.m + 1).padStart(2, '0')}-01`;
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

function render(main) {
  const view = viewMonth(), list = api.income.list(), today = todayISO();
  const occ = incomeOccurrences(list, view.y, view.m), t = incomeTotals(occ);
  const rows = occ.sort((a, b) => a.iso.localeCompare(b.iso));
  const add = h('button', { class: 'btn primary', type: 'button', 'data-add': 'income', onclick: () => openIncome(null) }, icon('plus'), h('span', { text: 'Add income' }));
  const body = !list.length ? emptyState({ icn: 'coins', title: 'No income yet', text: 'Add a paycheck or other money coming in. It counts toward Safe to Spend once it is received.', action: h('button', { class: 'btn primary', type: 'button', onclick: () => openIncome(null) }, icon('plus'), h('span', { text: 'Add income' })) })
    : !rows.length ? emptyState({ icn: 'coins', title: 'No income this month', text: 'Nothing is expected this month. Use the arrows to look at another month.' })
    : h('div', { class: 'billwrap' }, h('h3', { class: 'day', text: 'This month' }), rows.map((o) => h('button', { class: 'card bill link', type: 'button', 'data-income': o.id, 'aria-label': `Edit ${o.inc.name}, ${money(o.amount)}, ${fmtShort(o.iso)}`, onclick: () => openIncome(o.inc) },
      h('span', { class: 'dot ' + (o.received ? 'd-grn' : 'd-cyn'), 'aria-hidden': 'true' }),
      h('div', { class: 'bm' }, h('b', { text: o.inc.name }), h('small', { text: `${freqLabel(o.inc.frequency)} \u00b7 ${fmtShort(o.iso)}` })),
      h('div', { class: 'amt' }, h('b', { class: 'pos', text: money(o.amount) }), h('span', { class: 'tag ' + (o.received ? 'paid' : 'ok'), text: o.received ? 'Received' : 'Expected' })), icon('pencil', 'ic sm edit'))));
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'tb-l' }, monthNav(() => rerender()), h('small', { text: `${list.length} income source${list.length === 1 ? '' : 's'}` })), add),
    h('div', { class: 'grid sum' }, stat('Expected this month', money(t.expected), '', 'expected'), stat('Received', money(t.received), 'pos', 'received'), stat('Still to come', money(t.pending), '', 'pending')), body);
}
bootPage({ key: 'income.html', title: 'Income', sub: 'Paychecks and other money coming in.', render: (m) => render(m) }).then((sh) => { if (sh) rerender = () => render(sh.main); });
