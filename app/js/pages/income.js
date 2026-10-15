import { h, icon, money, todayISO, fmtShort, cents, uuid } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast } from '../ui.js';
import { api } from '../api.js';
import { INCOME_FREQ, incomeOccurrences, incomeTotals, freqLabel } from '../calc.js';
import { openIncome } from '../forms.js';
import { monthNav, viewMonth, stat, emptyState } from '../views.js';

let rerender = () => {};

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
