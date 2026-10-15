import { h, icon, money, todayISO, fmtDay, fmtShort, toISO, fromISO, isISO, num, cents } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast, savedToast } from '../ui.js';
import { api } from '../api.js';
import { REPEATS, billOccurrences, billTotals, repeatLabel } from '../calc.js';
import { openBill, categoryOptions } from '../forms.js';
import { colorDot, DEFAULT_CATEGORIES, monthNav, viewMonth, stat, emptyState, dueTag } from '../views.js';

const filter = { q: '', cat: '', showPaid: false };
let rerender = () => {};

function billCard(o, today) {
  const b = o.bill, [cls, txt] = dueTag(o.iso, today, o.status === 'paid');
  const tag = o.status === 'partial' ? ['warn', 'Partly paid'] : [cls, txt];
  return h('button', { class: 'card bill link', type: 'button', 'data-bill': b.id, 'aria-label': `Edit ${b.name}, ${money(o.amount)}, ${fmtShort(o.iso)}`, onclick: () => openBill(b, o.iso) },
    colorDot(b.color),
    h('div', { class: 'bm' }, h('b', { text: b.name }), h('small', { text: `${b.recurring ? 'Recurring \u00b7 ' : ''}${o.status === 'paid' ? 'Paid' : o.status === 'partial' ? 'Partial payment' : 'Unpaid'}${b.autopay ? ' \u00b7 Autopay' : ''}` }), b.category ? h('span', { class: 'chip', text: b.category }) : null),
    h('div', { class: 'amt' }, h('b', { text: money(o.amount) }), h('span', { class: 'tag ' + tag[0], text: tag[1] })), icon('pencil', 'ic sm edit'));
}

function render(main) {
  const view = viewMonth(), all = api.bills.list();
  let occ = billOccurrences(all, view.y, view.m);
  const t = billTotals(occ), today = todayISO();
  const q = filter.q.trim().toLowerCase();
  const shown = occ.filter((o) => (filter.showPaid || o.status !== 'paid') && (!q || o.bill.name.toLowerCase().includes(q) || (o.bill.category || '').toLowerCase().includes(q)) && (!filter.cat || o.bill.category === filter.cat));
  const search = h('input', { type: 'search', placeholder: 'Search bills', 'aria-label': 'Search bills', value: filter.q });
  search.addEventListener('input', () => { filter.q = search.value; rerender(); const s = main.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
  const cat = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'), categoryOptions().map((c) => h('option', { value: c, selected: filter.cat === c }, c)));
  cat.addEventListener('change', () => { filter.cat = cat.value; rerender(); });
  const addBtn = h('button', { class: 'btn primary', type: 'button', 'data-add': 'bill', onclick: () => openBill(null) }, icon('plus'), h('span', { text: 'Add bill' }));
  const list = [];
  if (!all.length) list.push(emptyState({ icn: 'bills', title: 'No bills yet', text: 'Add your first bill to see due dates and what is left to pay. Bills you added in the phone app appear here after you update the app to 4.1.5 or later and sign in with the same account.', action: h('button', { class: 'btn primary', type: 'button', onclick: () => openBill(null) }, icon('plus'), h('span', { text: 'Add bill' })) }));
  else if (!shown.length) list.push(emptyState({ icn: 'search', title: occ.length ? 'No unpaid bills match' : 'No bills this month', text: occ.length ? 'Paid recurring bills return on their next due date. Turn on Show paid bills to see them.' : 'Nothing is due this month. Use the arrows to look at another month.' }));
  else { let last = ''; const wrap = h('div', { class: 'billwrap' }); for (const o of shown) { if (o.iso !== last) { wrap.append(h('h3', { class: 'day', text: fmtDay(o.iso) })); last = o.iso; } wrap.append(billCard(o, today)); } list.push(wrap); }
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'tb-l' }, monthNav(() => rerender()), h('small', { 'data-count': '', text: `${t.count} bill${t.count === 1 ? '' : 's'} \u00b7 ${money(t.total)} total` })), addBtn),
    h('div', { class: 'grid sum' }, stat('Unpaid this month', money(t.unpaid), '', 'unpaid'), stat('Overdue', t.overdue ? `${t.overdue} bill${t.overdue > 1 ? 's' : ''}` : 'None', t.overdue ? 'neg' : '', 'overdue'), stat('Paid so far', money(t.paid), '', 'paid')),
    h('div', { class: 'filters' }, h('label', { class: 'search' }, icon('search'), search), h('label', { class: 'sel2' }, cat, icon('chevd', 'ic sm'))), h('label', { class: 'showpaid' }, h('input', { type: 'checkbox', 'data-show-paid': '', checked: !!filter.showPaid, onchange: (e) => { filter.showPaid = e.target.checked; rerender(); } }), h('span', { text: 'Show paid bills' })), ...list);
}

bootPage({ key: 'bills.html', title: 'Bills', sub: 'Search, filter and manage your bills.', render: (m) => render(m) }).then((sh) => { if (sh) rerender = () => render(sh.main); });
