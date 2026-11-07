import { h, icon, money } from '../util.js';
import { bootPage, openSheet, confirmDialog, toast, signOutNow } from '../ui.js';
import { api } from '../api.js';
import { auth, authMessage } from '../auth.js';
import { planKey, planInfo, planCard, paintHeadingBadge } from '../plans.js';
import { routeSubscription, manageFailure, safePortalUrl } from '../../../assets/subscription-route.js';
import { beforeServerDelete, interpretPlaidDelete, deletionMessage } from '../delete-flow.js';
import { openImport } from '../import.js';

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

function accessDate(raw) {
  if (!raw) return '';
  const d = new Date(typeof raw === 'number' && raw < 1e12 ? raw * 1000 : raw);
  return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

function planSub() {
  if (planInfo(billing)) return planInfo(billing).msg;
  if (!billing) return 'Your first bank, with all its accounts, is free.';
  const through = accessDate(billing.periodEnd || billing.expiresAt);
  const source = billing.source == null ? '' : String(billing.source);
  if (source === 'stripe') {
    if (billing.cancelAtPeriodEnd) return through ? `Billed with Stripe. Cancellation is scheduled. Access until ${through}.` : 'Billed with Stripe. Cancellation is scheduled. No end date was returned.';
    return through ? `Billed with Stripe. Access until ${through}.` : 'Billed with Stripe. No end date was returned.';
  }
  if (source === 'play') return through ? `Billed with Google Play. Access until ${through}.` : 'Billed with Google Play. No end date was returned.';
  if (billing.plan === 'premium') return 'Plus is on. The status did not say whether Stripe or Google Play bills it.';
  return 'Your first bank, with all its accounts, is free. Plus lets you link more.';
}

async function openManage() {
  try {
    if (!auth.user) throw Object.assign(new Error('Sign in again.'), { code: 'SIGNIN' });
    const status = await api.billing();
    billing = status;
    const route = routeSubscription(status);
    if (route.action === 'stripe-portal') {
      const r = await api.billingPortal();
      const url = safePortalUrl(r && r.url);
      if (!url) throw Object.assign(new Error('Stripe did not return a billing link.'), { code: 'PORTAL_FAILED' });
      toast('Opening Stripe. This page has not cancelled Plus.');
      location.assign(url);
      return;
    }
    if (route.action === 'play') {
      toast('Opening Google Play. This page has not cancelled Plus.');
      location.assign(route.url);
      return;
    }
    toast(route.message, 'warn');
  } catch (e) {
    toast(manageFailure(e), 'warn');
  }
}

function openDeleteAccount() {
  const startUid = auth.user && auth.user.uid;
  openSheet({
    title: 'Delete your account', sub: 'This deletes your PayAviator sign-in and asks PayAviator to remove every linked bank connection. It does not close those accounts at your bank. Deleting your PayAviator account does not cancel a Stripe or Google Play subscription. The subscription can keep renewing until you cancel it there. You do not have to cancel it first, and you are not asked why. If you have not signed in recently, nothing is deleted until you sign in again. Bills you entered on your phone stay there.',
    extra: h('p', { class: 's-note' }, h('button', { type: 'button', class: 'linkbtn', 'data-act': 'manage-from-delete', onclick: (ev) => { ev.preventDefault(); openManage(); } }, 'Manage or cancel subscription')),
    submitText: 'Delete account', fields: [],
    onSubmit: async () => {
      const gate = beforeServerDelete({ recent: auth.hasRecentLogin(), startUid, currentUid: auth.user && auth.user.uid });
      if (!gate.go) throw Object.assign(new Error(deletionMessage(gate.code)), { code: gate.code });
      let plaid;
      try { plaid = await api.deletePlaidUser(); }
      catch (e) {
        const read = interpretPlaidDelete(null, e);
        throw Object.assign(new Error(deletionMessage(read.code)), { code: read.code });
      }
      const read = interpretPlaidDelete(plaid, null);
      if (!read.ok) throw Object.assign(new Error(deletionMessage(read.code)), { code: read.code });
      if (!auth.user || auth.user.uid !== startUid) throw Object.assign(new Error(deletionMessage('USER_CHANGED')), { code: 'USER_CHANGED' });
      try { await auth.deleteUser(); }
      catch (e) {
        const code = /requires-recent-login/.test((e && e.code) || '') ? 'REQUIRES_RECENT_LOGIN' : 'DELETE_FAILED';
        throw Object.assign(new Error(deletionMessage(code)), { code });
      }
      api.clearLocal();
      return { deleted: true };
    },
  });
}

function render(main) {
  const u = auth.user || {}, st = api.status, c = api.cushion.get();
  const cushionTxt = c.mode === 'percent' ? `${c.percent || 0}% of available money` : money(c.dollar || 0);
  const lastSync = st.lastSync ? new Date(st.lastSync).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet';
  const syncTag = st.status === 'ok' ? h('span', { class: 'tag ok', text: 'Up to date' }) : st.status === 'busy' ? h('span', { class: 'tag warn', text: 'Syncing' }) : h('span', { class: 'tag warn', text: st.status === 'off' ? 'Offline' : 'Problem' });
  const pk = planKey(billing), special = pk === 'founder' || pk === 'elite';
  const planName = pk === 'plus' ? 'Plus' : special ? planInfo(billing).title : 'Free plan';
  paintHeadingBadge(billing);
  const method = (u.providers || []).includes('google.com') ? 'Google' : (u.providers || []).includes('password') ? 'Email and password' : auth.demo ? 'Demo' : 'Google or email';

  main.replaceChildren(h('div', { class: 'grid two' },
    special ? planCard(billing) : null,
    h('section', { class: 'card' }, h('ul', { class: 'slist' }, h('li', null, h('span', { class: 'ib' }, icon('bank')), h('div', { class: 'bn' }, h('b', { text: 'Connected Accounts' }), h('small', { text: 'Linked banks, cash and what counts in Available Now' })), h('a', { class: 'lnk', href: 'accounts.html', 'data-connected-accounts': '', text: 'Open' })))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Profile' })), h('ul', { class: 'slist' },
      li('user', 'Name', u.displayName || (u.email || '').split('@')[0] || 'You'),
      li('mail', 'Email', u.email || '', u.emailVerified ? h('span', { class: 'tag ok', text: 'Verified' }) : h('span', { class: 'tag warn', text: 'Not verified' })),
      li('shield', 'Sign-in method', method))),
    h('section', { class: 'card', id: 'cushion' }, h('div', { class: 'row-h' }, h('h2', { text: 'Cushion' })), h('ul', { class: 'slist' }, li('shield', 'Protected money', cushionTxt, h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'cushion', onclick: openCushion }, icon('pencil'), h('span', { text: 'Edit' })))), h('p', { class: 's-note', text: 'Safe to Spend = available money minus your cushion.' })),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Import' })), h('ul', { class: 'slist' }, li('doc', 'Import from spreadsheet', 'Bring bills in from an Excel (.xlsx) or CSV file. You choose what comes over.', h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'import', onclick: () => openImport() }, icon('plus'), h('span', { text: 'Import' }))))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Sync' })), h('ul', { class: 'slist' },
      li('cloud', 'Status', `Last synced ${lastSync}${st.pending ? ` \u00b7 ${st.pending} change${st.pending > 1 ? 's' : ''} waiting` : ''}`, syncTag),
      li('phone', 'Your phone', 'Android PayAviator 4.1.4 or later syncs with this page', h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'sync', onclick: async () => { await api.sync(); toast(api.status.status === 'ok' ? 'Up to date.' : 'Could not sync right now. We will keep trying.', api.status.status === 'ok' ? 'ok' : 'warn'); } }, icon('refresh'), h('span', { text: 'Sync now' }))))),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Security' })), h('ul', { class: 'slist' },
      li('lock', 'Password', 'Send a reset link to your email', u.providers && u.providers.includes('password') ? h('button', { class: 'linkbtn lnk', type: 'button', text: 'Send link', onclick: async () => { try { await auth.sendReset(u.email); toast('Reset link sent. Use the newest email.'); } catch (e) { toast(authMessage(e) || 'Could not send the link.', 'warn'); } } }) : null),
      li('logout', 'Sign out', 'On this browser. Clears data held here.', h('button', { class: 'linkbtn lnk', type: 'button', 'data-act': 'signout', text: 'Sign out', onclick: signOutNow })),
      li('phone', 'App lock', 'Set up on your Android phone'))),
    h('section', { class: 'card', id: 'plan' }, h('div', { class: 'row-h' }, h('h2', { text: 'Plan & billing' })), h('ul', { class: 'slist' },
      li('card', planName, planSub(), (pk === 'plus' || special) ? null : h('a', { class: 'lnk', href: '../pricing.html', text: 'See plans' })),
      special ? null : li('doc', 'Manage or cancel', 'Stripe for a website subscription, Google Play for an app subscription. Opening it does not cancel Plus by itself.', h('button', { class: 'btn sm ghost', type: 'button', 'data-act': 'portal', onclick: openManage }, icon('card'), h('span', { text: 'Manage or cancel' })))),
      h('p', { class: 's-note', 'data-sub-note': '', text: 'The provider and end date above come from your account status. Nothing is cancelled until that provider says so.' })),
    h('section', { class: 'card' }, h('div', { class: 'row-h' }, h('h2', { text: 'Help & legal' })), h('ul', { class: 'slist' },
      li('mail', 'Support', 'support@payaviator.app', h('a', { class: 'lnk', href: 'mailto:support@payaviator.app', text: 'Email us' })),
      li('doc', 'Privacy policy and Terms', 'How we handle your data', h('span', null, h('a', { class: 'lnk', href: '../privacy.html', text: 'Privacy' }), ' \u00b7 ', h('a', { class: 'lnk', href: '../terms.html', text: 'Terms' }))))),
    h('section', { class: 'card danger', id: 'delete-account' }, h('div', { class: 'row-h' }, h('h2', { text: 'Delete your data or account' })), h('p', { class: 'muted', text: 'Delete synced data removes bills, income, spending and budget from PayAviator\u2019s servers and leaves your account and bank connections. This page cannot disconnect one bank. To delete the whole PayAviator account, use Delete account. You do not have to cancel Plus first, and deleting does not cancel it.' }),
      h('div', { class: 'tb-r' }, h('button', { class: 'btn danger-o', type: 'button', 'data-act': 'delete-sync', onclick: async () => { if (!(await confirmDialog({ title: 'Delete synced data?', text: 'This removes your synced bills, income, spending and budget from the cloud. It cannot be undone.', confirmText: 'Delete synced data' }))) return; try { const r = await api.deleteAllCloud(); toast(`Deleted ${r.deleted} synced item${r.deleted === 1 ? '' : 's'}.`); await api.init({ uid: auth.user.uid, getToken: (f) => auth.getToken(f), demo: auth.demo }); } catch (e) { toast(e.message || 'Could not delete synced data.', 'warn'); } } }, icon('trash'), h('span', { text: 'Delete synced data' })),
        h('button', { class: 'btn danger', type: 'button', 'data-act': 'delete-account', onclick: openDeleteAccount }, icon('trash'), h('span', { text: 'Delete my account' }))))));
}

bootPage({ key: 'settings.html', title: 'Settings', sub: 'Your profile, sync and plan.', render: (m) => render(m) }).then((sh) => { if (sh) { rerender = () => render(sh.main); api.billing().then((b) => { billing = b; rerender(); }).catch(() => {}); { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); } } });
