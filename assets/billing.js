/* PayAviator web billing: Firebase email sign-in + Stripe Checkout / Customer Portal via api.payaviator.app */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const API = 'https://api.payaviator.app';
const app = initializeApp({ apiKey: 'AIzaSyAJ72nfiPWkccGTAzMd0XGODCjabSqFRyM', authDomain: 'payaviator-app.firebaseapp.com', projectId: 'payaviator-app', storageBucket: 'payaviator-app.firebasestorage.app', messagingSenderId: '1015603414892' });
const auth = getAuth(app);
const $ = (s, r = document) => r.querySelector(s);
const PRICES = { monthly: '$3.99', yearly: '$29.99' }, PER = { monthly: 'month', yearly: 'year' };

let authReady;
const ready = new Promise((r) => (authReady = r));
onAuthStateChanged(auth, (u) => { authReady(); document.dispatchEvent(new CustomEvent('pa-auth', { detail: u })); });

function authMsg(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'That email and password don\u2019t match an account. Use the same account you use in the PayAviator app.';
  if (/invalid-email/.test(c)) return 'Please enter a valid email address.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/network/.test(c)) return 'Can\u2019t reach the sign-in service. Check your connection and try again.';
  if (/user-disabled/.test(c)) return 'This account is disabled. Contact support@payaviator.app.';
  return 'Sign-in failed. Please try again.';
}

async function api(path, opts = {}) {
  const u = auth.currentUser;
  if (!u) throw Object.assign(new Error('Please sign in first.'), { code: 'SIGNIN' });
  const token = await u.getIdToken();
  let r;
  try {
    r = await fetch(API + path, { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) { throw Object.assign(new Error('Can\u2019t reach PayAviator right now. Check your connection and try again.'), { code: 'NETWORK' }); }
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw Object.assign(new Error(data.error || data.message || ('Request failed (' + r.status + ').')), { code: data.code || ('HTTP_' + r.status), status: r.status });
  return data;
}

/* ---------- sign-in sheet (shared) ---------- */
function signInSheet() {
  let dlg = $('#signinSheet');
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'signinSheet'; dlg.className = 'sheet'; dlg.setAttribute('aria-labelledby', 'siTitle');
  dlg.innerHTML = `<form method="dialog" class="sheet-x"><button class="xbtn" aria-label="Close">\u00d7</button></form>
  <h2 id="siTitle">Sign in to PayAviator</h2>
  <p class="note">Use the same account you use in the PayAviator app.</p>
  <form id="siForm" class="fields" novalidate>
    <label>Email<input type="email" name="email" autocomplete="email" required></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
    <p class="hint err" id="siErr" role="alert"></p>
    <button class="btn primary subbtn" type="submit" id="siBtn">Sign in</button>
    <p class="fine"><button type="button" class="linkbtn" id="siForgot">Forgot password?</button> \u00b7 No account yet? Create one in the <a href="/index.html#get">PayAviator app</a> first.</p>
  </form>`;
  document.body.appendChild(dlg);
  const f = $('#siForm', dlg), err = $('#siErr', dlg), btn = $('#siBtn', dlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; err.classList.remove('ok');
    const email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) { err.textContent = 'Enter your email and password.'; return; }
    btn.disabled = true; btn.textContent = 'Signing in\u2026';
    try { await signInWithEmailAndPassword(auth, email, pw); dlg.close('ok'); }
    catch (x) { err.textContent = authMsg(x); }
    finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('#siForgot', dlg).addEventListener('click', async () => {
    err.classList.remove('ok');
    const email = f.email.value.trim();
    if (!email) { err.textContent = 'Type your email above, then tap \u201cForgot password?\u201d again.'; f.email.focus(); return; }
    try { await sendPasswordResetEmail(auth, email); err.classList.add('ok'); err.textContent = 'If that email has an account, a reset link is on its way.'; }
    catch (x) { err.textContent = authMsg(x); }
  });
  return dlg;
}
function requireSignIn() {
  return ready.then(() => auth.currentUser ? auth.currentUser : new Promise((res, rej) => {
    const d = signInSheet();
    const onClose = () => { d.removeEventListener('close', onClose); auth.currentUser ? res(auth.currentUser) : rej(Object.assign(new Error(''), { code: 'CANCELLED' })); };
    d.addEventListener('close', onClose);
    d.showModal(); setTimeout(() => $('input[name=email]', d).focus(), 30);
  }));
}

/* ---------- pricing page ---------- */
function initPricing() {
  const form = $('#subForm'); if (!form) return;
  const agree = $('#agree'), btn = $('#subBtn'), hint = $('#subHint'), renew = $('#renewNotice'), who = $('#whoami');
  let busy = false;
  const sync = () => {
    const p = form.plan.value;
    btn.textContent = busy ? 'Opening secure checkout\u2026' : `Subscribe \u00b7 ${PRICES[p]}/${PER[p]}`;
    btn.disabled = busy;
    renew.textContent = `${PRICES[p]} today, then renews at ${PRICES[p]}/${PER[p]} until you cancel.`;
  };
  form.addEventListener('change', () => { hint.textContent = ''; sync(); });
  document.addEventListener('pa-auth', (e) => {
    const u = e.detail;
    who.innerHTML = u ? `Signed in as <b></b> \u00b7 <button type="button" class="linkbtn" id="soBtn">Sign out</button>` : '';
    if (u) { $('b', who).textContent = u.email; $('#soBtn').onclick = () => signOut(auth); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy) return;
    hint.classList.remove('ok');
    if (!agree.checked) { hint.textContent = 'Please check the box above to continue.'; agree.focus(); return; }
    hint.textContent = '';
    try {
      await requireSignIn();
      busy = true; sync();
      const r = await api('/api/billing/stripe/checkout', { method: 'POST', body: { plan: form.plan.value } });
      if (!r.url) throw new Error('Checkout didn\u2019t start. Please try again.');
      hint.classList.add('ok'); hint.textContent = 'Taking you to secure checkout\u2026';
      location.assign(r.url);
    } catch (x) {
      busy = false; sync();
      if (x.code === 'CANCELLED') return;
      hint.textContent = x.code === 'ALREADY_SUBSCRIBED' || /already/i.test(x.message) ? 'You already have Plus. Manage it from your account page.' : (x.message || 'Something went wrong. Please try again.');
    }
  });
  sync();
}

/* ---------- account page ---------- */
function initAccount() {
  const box = $('#acct'); if (!box) return;
  const out = $('#acctOut'), signedOut = $('#acctSignedOut'), msg = $('#acctMsg'), mBtn = $('#manageBtn');
  $('#acctSignIn').addEventListener('click', () => requireSignIn().catch(() => {}));
  $('#acctSignOut').addEventListener('click', () => signOut(auth));
  document.addEventListener('pa-auth', async (e) => {
    const u = e.detail;
    out.hidden = !u; signedOut.hidden = !!u; msg.textContent = '';
    if (!u) return;
    $('#acctEmail').textContent = u.email;
    const plan = $('#acctPlan'), detail = $('#acctDetail');
    plan.textContent = 'Checking\u2026'; detail.textContent = '';
    try {
      const s = await api('/api/billing/status');
      const ent = s.entitlement || s.plan || s.tier || {};
      const isPlus = !!(s.plus || s.isPlus || s.premium || s.active || ent.active || /plus|premium/i.test(typeof ent === 'string' ? ent : (ent.tier || ent.plan || '')) || /active|trialing/i.test(s.status || s.subscriptionStatus || ''));
      plan.textContent = isPlus ? 'PayAviator Plus' : 'Free';
      plan.className = 'badge' + (isPlus ? ' green' : '');
      const end = s.currentPeriodEnd || s.periodEnd || s.expiresAt || ent.expiresAt || ent.currentPeriodEnd;
      const cancelling = s.cancelAtPeriodEnd || ent.cancelAtPeriodEnd;
      const d = end ? new Date(typeof end === 'number' && end < 1e12 ? end * 1000 : end) : null;
      const ds = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      detail.textContent = isPlus ? (cancelling ? `Cancelled. Plus stays on until ${ds || 'the end of the paid period'}.` : (ds ? `Renews on ${ds}.` : 'Active. Open the app to link more banks.')) : 'Your first bank account is free. Plus lets you link more.';
      box.dataset.status = JSON.stringify(s);
    } catch (x) { plan.textContent = 'Unknown'; detail.textContent = x.message; }
  });
  mBtn.addEventListener('click', async () => {
    msg.classList.remove('ok'); msg.textContent = ''; mBtn.disabled = true; mBtn.textContent = 'Opening\u2026';
    try {
      const r = await api('/api/billing/stripe/portal', { method: 'POST', body: {} });
      if (!r.url) throw new Error('Couldn\u2019t open the billing portal. Please try again.');
      location.assign(r.url);
    } catch (x) {
      msg.innerHTML = x.code === 'NO_STRIPE_CUSTOMER' ? 'You don\u2019t have a web subscription yet. <a href="/pricing.html">See plans</a>. If you subscribed in the app, manage it in Google Play under Payments &amp; subscriptions.' : '';
      if (x.code !== 'NO_STRIPE_CUSTOMER') msg.textContent = x.message;
    } finally { mBtn.disabled = false; mBtn.textContent = 'Manage subscription'; }
  });
}

initPricing();
initAccount();
