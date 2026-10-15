import { h, icon, money, todayISO, fmtDay, fmtShort, toISO, fromISO, pad } from '../util.js';
import { bootPage, toast } from '../ui.js';
import { api } from '../api.js';
import { billOnDate, billPaidAmount, incomeOnDate, incomeAmountOn, repeatLabel, freqLabel } from '../calc.js';
import { openBill, openIncome } from '../forms.js';
import { monthNav, viewMonth, shiftMonth, dueTag } from '../views.js';

const WD = [['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday']];
const INCOME_COLOR = '#15803d'; // the app's paycheck green
let selected = todayISO();
let rerender = () => {};

const HEX = /^#[0-9a-fA-F]{6}$/;
const FALLBACK = { red: '#e5484d', amber: '#fbbf24', green: '#3ddc97', gray: '#7c98bd', cyan: '#16e4ea', violet: '#a78bfa' };
const billColor = (b) => (HEX.test(String(b.color)) ? b.color : FALLBACK[b.color] || '#3ddc97');
/** Readable text on a bill-colored pill: navy on light colors, white on dark ones. */
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0d2a55' : '#ffffff';
}
const paint = (el, hex, ink) => { el.style.background = hex; if (ink) el.style.color = inkOn(hex); return el; };

function dayItems(iso, bills, incomes) {
  const d = fromISO(iso);
  const b = bills.filter((x) => billOnDate(x, d) && !(x.occ && x.occ[iso] && x.occ[iso].deleted)).map((x) => {
    const amount = Number(x.amount) || 0, paid = billPaidAmount(x, iso);
    return { bill: x, iso, amount, paid, status: paid <= 0 ? 'unpaid' : paid < amount ? 'partial' : 'paid' };
  }).sort((p, q) => String(p.bill.name).localeCompare(String(q.bill.name)));
  const i = incomes.filter((x) => incomeOnDate(x, d)).map((x) => ({ inc: x, iso, amount: incomeAmountOn(x, iso) })).filter((x) => x.amount > 0);
  return { b, i };
}

function dayLabel(iso, it) {
  const bits = [];
  if (it.b.length) bits.push(`${it.b.length} bill${it.b.length > 1 ? 's' : ''}`);
  if (it.i.length) bits.push(`${it.i.length} income`);
  return `${fmtDay(iso)}${bits.length ? ': ' + bits.join(', ') : ': nothing scheduled'}`;
}

function cell(iso, inMonth, today, it) {
  const day = Number(iso.slice(8));
  const cls = ['cday'];
  if (!inMonth) cls.push('muted'); if (iso === today) cls.push('today'); if (iso === selected) cls.push('sel');
  if (it.b.some((x) => x.status === 'partial')) cls.push('partial');
  const pills = h('div', { class: 'cev', 'aria-hidden': 'true' });
  const dots = h('div', { class: 'cdots', 'aria-hidden': 'true' });
  const maxPills = 3, all = [...it.b.map((x) => ({ k: 'b', x })), ...it.i.map((x) => ({ k: 'i', x }))];
  all.slice(0, maxPills).forEach(({ k, x }) => {
    const color = k === 'b' ? billColor(x.bill) : INCOME_COLOR;
    const name = k === 'b' ? x.bill.name : x.inc.name;
    const done = k === 'b' && x.status === 'paid';
    const p = paint(h('span', { class: 'pill' + (done ? ' done' : '') }, h('span', { class: 'pn', text: name }), h('span', { class: 'pa', text: money(x.amount).replace(/\.00$/, '') + (done ? ' \u2713' : '') })), color, true);
    pills.append(p);
  });
  if (all.length > maxPills) pills.append(h('span', { class: 'more-n', text: `+${all.length - maxPills} more` }));
  all.slice(0, 4).forEach(({ k, x }) => { const dot = h('i', { class: 'cd' }); dot.style.background = k === 'b' ? billColor(x.bill) : INCOME_COLOR; dots.append(dot); });
  if (all.length > 4) dots.append(h('b', { class: 'cd-n', text: `+${all.length - 4}` }));
  return h('button', { class: cls.join(' '), type: 'button', 'data-iso': iso, 'aria-pressed': String(iso === selected), 'aria-label': dayLabel(iso, it), onclick: () => select(iso, true) },
    h('span', { class: 'cnum', text: String(day) }), pills, dots);
}

function select(iso, scroll) {
  selected = iso;
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1], v = viewMonth();
  if (y !== v.y || m !== v.m) { const diff = (y - v.y) * 12 + (m - v.m); shiftMonth(diff); }
  rerender();
  if (scroll) { const p = document.querySelector('#day-panel'); if (p && matchMedia('(max-width:899px)').matches) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}

function panel(iso, it, today) {
  const rows = [];
  it.b.forEach((o) => {
    const b = o.bill, [cls, txt] = dueTag(iso, today, o.status === 'paid'), tag = o.status === 'partial' ? ['warn', 'Partly paid'] : [cls, txt];
    const dot = h('span', { class: 'dot', 'aria-hidden': 'true' }); dot.style.background = billColor(b);
    rows.push(h('button', { class: 'card bill link', type: 'button', 'data-bill': b.id, 'aria-label': `Edit ${b.name}, ${money(o.amount)}`, onclick: () => openBill(b, iso) },
      dot, h('div', { class: 'bm' }, h('b', { text: b.name }), h('small', { text: `Repeats ${repeatLabel(b).toLowerCase()} \u00b7 ${o.status === 'paid' ? 'Paid' : o.status === 'partial' ? 'Partly paid' : 'Unpaid'}` }), b.category ? h('span', { class: 'chip', text: b.category }) : null),
      h('div', { class: 'amt' }, h('b', { text: money(o.amount) }), h('span', { class: 'tag ' + tag[0], text: tag[1] })), icon('pencil', 'ic sm edit')));
  });
  it.i.forEach((o) => {
    const received = iso <= today, dot = h('span', { class: 'dot', 'aria-hidden': 'true' }); dot.style.background = INCOME_COLOR;
    rows.push(h('button', { class: 'card bill link', type: 'button', 'data-income': o.inc.id, 'aria-label': `Edit ${o.inc.name}, ${money(o.amount)}`, onclick: () => openIncome(o.inc) },
      dot, h('div', { class: 'bm' }, h('b', { text: o.inc.name }), h('small', { text: `Income \u00b7 ${freqLabel(o.inc.frequency)}` })),
      h('div', { class: 'amt' }, h('b', { class: 'pos', text: money(o.amount) }), h('span', { class: 'tag ' + (received ? 'paid' : 'ok'), text: received ? 'Received' : 'Expected' })), icon('pencil', 'ic sm edit')));
  });
  const addB = h('button', { class: 'btn primary', type: 'button', 'data-add': 'bill-day', onclick: () => openBill(null, null, { date: iso }) }, icon('plus'), h('span', { text: 'Add bill' }));
  const addI = h('button', { class: 'btn ghost', type: 'button', 'data-add': 'income-day', onclick: () => openIncome(null, { date: iso }) }, icon('plus'), h('span', { text: 'Add income' }));
  return h('section', { class: 'card dpanel', id: 'day-panel', 'aria-labelledby': 'day-t', tabindex: '-1' },
    h('div', { class: 'dp-h' }, h('div', null, h('h2', { id: 'day-t', text: fmtDay(iso) }), h('small', { text: rows.length ? `${it.b.length} bill${it.b.length === 1 ? '' : 's'}, ${it.i.length} income. Tap one to edit it.` : 'Nothing scheduled on this day.' })), h('div', { class: 'dp-a' }, addB, addI)),
    rows.length ? h('div', { class: 'billwrap' }, rows) : h('p', { class: 'muted dp-empty', text: 'Tap Add bill or Add income to put something on this day. It will appear in the app too.' }));
}

function render(main) {
  const v = viewMonth(), today = todayISO();
  const bills = api.bills.list(), incomes = api.income.list();
  // keep the selected day inside the month being viewed
  if (Number(selected.slice(0, 4)) !== v.y || Number(selected.slice(5, 7)) - 1 !== v.m) {
    selected = today.slice(0, 7) === `${v.y}-${pad(v.m + 1)}` ? today : `${v.y}-${pad(v.m + 1)}-01`;
  }
  const first = new Date(v.y, v.m, 1), start = new Date(v.y, v.m, 1 - first.getDay()), weeks = Math.ceil((first.getDay() + new Date(v.y, v.m + 1, 0).getDate()) / 7);
  const cells = [];
  for (let n = 0; n < weeks * 7; n++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n), iso = toISO(d);
    cells.push(cell(iso, d.getMonth() === v.m, today, dayItems(iso, bills, incomes)));
  }
  const goToday = h('button', { class: 'btn sm ghost', type: 'button', 'data-today': '', onclick: () => { const n = new Date(); shiftMonth((n.getFullYear() - viewMonth().y) * 12 + n.getMonth() - viewMonth().m); selected = todayISO(); rerender(); } }, 'Today');
  const addBtn = h('button', { class: 'btn primary', type: 'button', 'data-add': 'bill', onclick: () => openBill(null, null, { date: selected }) }, icon('plus'), h('span', { text: 'Add bill' }));
  const sel = dayItems(selected, bills, incomes);
  const legend = h('ul', { class: 'clegend', 'aria-label': 'Legend' },
    h('li', null, h('i', { class: 'cd lg-b' }), 'Bill (its own color)'), h('li', null, h('i', { class: 'cd lg-i' }), 'Income'), h('li', null, h('i', { class: 'lg-t' }), 'Today'), h('li', null, h('i', { class: 'lg-p' }), 'Partly paid'));
  main.replaceChildren(
    h('div', { class: 'toolbar' }, h('div', { class: 'tb-l cal-nav' }, monthNav(() => rerender()), goToday), addBtn),
    h('section', { class: 'card cal', 'aria-label': 'Calendar for ' + new Date(v.y, v.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) },
      h('div', { class: 'cwd', 'aria-hidden': 'true' }, WD.map(([s, l]) => h('span', { text: s, title: l }))),
      h('div', { class: 'cgrid', role: 'group', 'aria-label': 'Days of the month' }, cells), legend),
    panel(selected, sel, today));
}

bootPage({ key: 'calendar.html', title: 'Calendar', sub: 'Bills and income by day.', render: (m) => render(m) }).then((sh) => { if (sh) rerender = () => render(sh.main); });
void fmtShort; void toast;
