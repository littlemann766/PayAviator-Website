import { h, icon, money } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast, signOutNow } from '../ui.js';
import { api } from '../api.js';
import { auth, authMessage } from '../auth.js';

let rerender = () => {};
let billing = null;
const li = (ic, title, sub, trailing) => h('li', null, h('span', { class: 'ib' }, icon(ic)), h('div', { class: 'bn' }, h('b', { text: title }), h('small', { text: sub })), trailing || null);

function openCushion() {
  const c = api.cushion.get();
  openSheet({
    title: 'Cushion', sub: 'Money you protect. It is kept out of Safe to Spend.', submitText: 'Save cushion', values: { mode: c.mode, dollar: c.dollar || '', percent: c.percent || '' },
    fields: [
      { name: 'mode', label: 'Protect', type: 'select', options: [{ v: 'dollar', label: 'A dollar amount' }, { v: 'percent', label: 'A percent of available money' }] },
      { name: 'dollar', label: 'Dollar amount', type: 'money', optional: true, allowZero: true, hint: 'Used when you protect a dollar amount. Default is $0.00.' },
      { name: 'percent', label: 'Percent (0 to 100)', type: 'number', optional: true, max: 6, hint: 'Used when you protect a percent.', validate: (v) => (v !== '' && !(Number(v) >= 0 && Number(v) <= 100) ? 'Enter a percent from 0 to 100.' : null) },
    ],
    onSubmit: (v) => api.cushion.save({ mode: v.mode, dollar: Number.isFinite(v.dollar) ? v.dollar : 0, percent: Number.isFinite(v.percent) ? v.percent : 0 }),
  });
}

function planSub() {
  if (!billing) return 'Your first bank, with all its accounts, is free.';
  if (billing.plan === 'premium') {
    const e = billing.periodEnd || billing.expiresAt, d = e ? new Date(typeof e === 'number' && e < 1e12 ? e * 1000 : e) : null;
    const ds = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    return billing.cancelAtPeriodEnd ? `Cancelled. Plus stays on until ${ds || 'the end of the paid period'}.` : ds ? `Renews on ${ds}.` : 'Active.';
  }
  return 'Your first bank, with all its accounts, is free. Plus lets you link more.';
}

async function openPortal() {
  try { const r = await api.billingPortal(); if (!r.url) throw new Error('Couldn\u2019t open the billing portal. Please try again.'); location.assign(r.url); }
  catch (e) { toast(e.code === 'NO_STRIPE_CUSTOMER' ? 'No web subscription yet. See plans, or manage Play subscriptions in Google Play.' : (e.message || 'Could not open billing.'), 'warn'); }
}

function openDeleteAccount() {
  openSheet({
    title: 'Delete your account', sub: 'This permanently deletes your PayAviator account, linked banks and synced data. It cannot be undone. Data on your phone stays until you delete it there. Subscriptions bought in Google Play or Stripe must be cancelled separately.',
    submitText: 'Delete my account forever', values: { confirm: '' },
    fields: [{ name: 'confirm', label: 'Type DELETE to confirm', type: 'text', validate: (v) => (String(v).trim() === 'DELETE' ? null : 'Type DELETE in capital letters to continue.') }],
    onSubmit: async () => {
      try { await api.deletePlaidUser(); } catch (e) { if (e.status !== 404) throw e; }
      try { await api.deleteAllCloud().catch(() => {}); await auth.deleteUser(); }
      catch (e) { throw Object.assign(new Error(authMessage(e) || 'Could not delete the account. Please try again or email support@payaviator.app.'), { code: e.code }); }
      api.clearLocal(); location.replace('signin.html?deleted=1');
    },
  });
}

function render(main) {
  const u = auth.user || {}, st = api.status, c = api.cushion.get();
  const cushionTxt = c.mode === 'percent' ? `${c.percent || 0}% of available money` : money(c.dollar || 0);
  const lastSync = st.lastSync ? new Date(st.lastSync).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet';
  const syncTag = st.status === 'ok' ? h('span', { class: 'tag ok', text: 'Up to date' }) : st.status === 'busy' ? h('span', { class: 'tag warn', text: 'Syncing' }) : h('span', { class: 'tag warn', text: st.status === 'off' ? 'Offline' : 'Problem' });
  const planName = !billing ? 'Free plan' : billing.plan === 'premium' ? 'Plus' : billing.plan === 'comp' ? 'Complimentary plan' : 'Free plan';
  const method = (u.providers || []).includes('google.com') ? 'Google' : (u.providers || []).includes('password') ? 'Email and password' : auth.demo ? 'Demo' : 'Google or email';

  main.replaceChildren(h('div', { class: 'grid two' },
    h('section', { class: 'card' }, h('ul', { class: 'slist' }, h('li', null, h('span', { class: 'ib' }, icon('bank')), h('div', { class: 'bn' }, h('b', { text: 'Connected Accounts' }), h('small', { text: 'Linked banks, cash and what counts in Available Now' })), h('a', { class: 'lnk', href: 'accounts.html', 'data-connected-accounts': '', text: 'Open' })))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Profile' })), h('ul', { class: 'slist' },
      li('user', 'Name', u.displayName || (u.email || '').split('@')[0] || 'You'),
      li('mail', 'Email', u.email || '', u.emailVerified ? h('span', { class: 'tag ok', text: 'Verified' }) : h('span', { class: 'tag warn', text: 'Not verified' })),
      li('shield', 'Sign-in method', method))),
    h('section', { class: 'card', id: 'cushion' }, h('div', { class: 'row-h' }, h('h2', { text: 'Cushion' })), h('ul', { class: 'slist' }, li('shield', 'Protected money', cushionTxt, h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'cushion', onclick: openCushion }, icon('pencil'), h('span', { text: 'Edit' })))), h('p', { class: 's-note', text: 'Safe to Spend = available money minus your cushion.' })),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Sync' })), h('ul', { class: 'slist' },
      li('cloud', 'Status', `Last synced ${lastSync}${st.pending ? ` \u00b7 ${st.pending} change${st.pending > 1 ? 's' : ''} waiting` : ''}`, syncTag),
      li('phone', 'Your phone', 'Android PayAviator 4.1.4 or later syncs with this page', h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'sync', onclick: async () => { await api.sync(); toast(api.status.status === 'ok' ? 'Up to date.' : 'Could not sync right now. We will keep trying.', api.status.status === 'ok' ? 'ok' : 'warn'); } }, icon('refresh'), h('span', { text: 'Sync now' }))))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Security' })), h('ul', { class: 'slist' },
      li('lock', 'Password', 'Send a reset link to your email', u.providers && u.providers.includes('password') ? h('button', { class: 'linkbtn lnk', type: 'button', text: 'Send link', onclick: async () => { try { await auth.sendReset(u.email); toast('Reset link sent. Use the newest email.'); } catch (e) { toast(authMessage(e) || 'Could not send the link.', 'warn'); } } }) : null),
      li('logout', 'Sign out', 'On this browser. Clears data held here.', h('button', { class: 'linkbtn lnk', type: 'button', 'data-act': 'signout', text: 'Sign out', onclick: signOutNow })),
      li('phone', 'App lock', 'Set up on your Android phone'))),
    h('section', { class: 'card', id: 'plan' }, h('div', { class: 'row-h' }, h('h2', { text: 'Plan & billing' })), h('ul', { class: 'slist' },
      li('card', planName, planSub(), billing && billing.plan === 'premium' ? null : h('a', { class: 'lnk', href: '../pricing.html', text: 'See plans' })),
      li('doc', 'Manage subscription', 'Update your card, see receipts or cancel in Stripe', h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'portal', onclick: openPortal }, icon('card'), h('span', { text: 'Manage' })))),
      h('p', { class: 's-note', text: 'Subscribed in the Android app? Manage it in Google Play under Payments & subscriptions.' })),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Help & legal' })), h('ul', { class: 'slist' },
      li('mail', 'Support', 'support@payaviator.app', h('a', { class: 'lnk', href: 'mailto:support@payaviator.app', text: 'Email us' })),
      li('doc', 'Privacy policy and Terms', 'How we handle your data', h('span', null, h('a', { class: 'lnk', href: '../privacy.html', text: 'Privacy' }), ' \u00b7 ', h('a', { class: 'lnk', href: '../terms.html', text: 'Terms' }))))),
    h('section', { class: 'card danger' }, h('div', { class: 'row-h' }, h('h2', { text: 'Delete your data or account' })), h('p', { class: 'muted', text: 'Delete synced cloud data removes your bills, income, spending and budget from PayAviator\u2019s servers. Data on your phone stays until you clear it there. To delete your whole account, linked banks and all, use Delete account.' }),
      h('div', { class: 'tb-r' }, h('button', { class: 'btn danger-o', type: 'button', 'data-act': 'delete-sync', onclick: async () => { if (!(await confirmDialog({ title: 'Delete synced data?', text: 'This removes your synced bills, income, spending and budget from the cloud. It cannot be undone.', confirmText: 'Delete synced data' }))) return; try { const r = await api.deleteAllCloud(); toast(`Deleted ${r.deleted} synced item${r.deleted === 1 ? '' : 's'}.`); await api.init({ uid: auth.user.uid, getToken: (f) => auth.getToken(f), demo: auth.demo }); } catch (e) { toast(e.message || 'Could not delete synced data.', 'warn'); } } }, icon('trash'), h('span', { text: 'Delete synced data' })),
        h('button', { class: 'btn danger', type: 'button', 'data-act': 'delete-account', onclick: openDeleteAccount }, icon('trash'), h('span', { text: 'Delete my account' }))))));
}

bootPage({ key: 'settings.html', title: 'Settings', sub: 'Your profile, sync and plan.', render: (m) => render(m) }).then((sh) => { if (sh) { rerender = () => render(sh.main); api.billing().then((b) => { billing = b; rerender(); }).catch(() => {}); { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); } } });
