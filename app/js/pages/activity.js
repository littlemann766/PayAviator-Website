import { h, icon, money } from '../util.js';
import { bootPage } from '../ui.js';
import { api } from '../api.js';
import { activityRows, rangeTabs, actList, normRange, RANGE_WORD } from '../activity.js';

let acct = { accounts: [] }, tx = { loaded: false, list: [], failed: false };
let range = normRange(new URLSearchParams(location.search).get('range'));
let rerender = () => {};

async function load() {
  try { const r = await api.accounts(); acct = { accounts: r.accounts || [] }; } catch (e) { acct = { accounts: [] }; }
  try { const r = await api.transactions(250); tx = { loaded: true, list: Array.isArray(r.transactions) ? r.transactions : [], failed: false }; } catch (e) { tx = { loaded: true, list: [], failed: true }; }
  rerender();
}

function render(main) {
  const rows = activityRows(tx.list, api.data().spending, null, acct.accounts, range);
  const out = rows.filter((r) => r.amt < 0).reduce((a, r) => a + -r.amt, 0), inn = rows.filter((r) => r.amt > 0).reduce((a, r) => a + r.amt, 0);
  const url = new URL(location.href); url.searchParams.set('range', range); history.replaceState(null, '', url);
  main.replaceChildren(
    h('p', null, h('a', { class: 'more back', href: 'index.html', 'data-back': '' }, icon('chev', 'ic sm flip'), ' Back to Home')),
    h('section', { class: 'card activity full', 'aria-labelledby': 'g-act' },
      h('div', { class: 'row-h' }, h('h2', { id: 'g-act', text: 'All activity' }), h('span', { class: 'sp-period', 'data-count': '', text: rows.length + (rows.length === 1 ? ' item' : ' items') })),
      rangeTabs(range, (r) => { range = r; render(main); }),
      h('p', { class: 'muted', 'data-summary': '', text: 'Showing ' + RANGE_WORD[range] + (rows.length ? ' \u00b7 out ' + money(out) + ' \u00b7 in ' + money(inn) : '') }),
      tx.failed ? h('p', { class: 'muted', text: 'Bank transactions could not be loaded. Showing what you added.' }) : null,
      actList(rows, range, false)));
}

bootPage({ key: 'index.html', title: 'Activity', sub: 'Everything that came in or went out.', render: (m) => render(m) }).then((sh) => { if (sh) { rerender = () => render(sh.main); load(); } });
