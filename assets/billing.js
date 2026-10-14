/* PayAviator web billing: Firebase Google + email sign-in + Stripe Checkout / Customer Portal via api.payaviator.app */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const API = 'https://api.payaviator.app';
const app = initializeApp({ apiKey: 'AIzaSyAJ72nfiPWkccGTAzMd0XGODCjabSqFRyM', authDomain: 'payaviator-app.firebaseapp.com', projectId: 'payaviator-app', storageBucket: 'payaviator-app.firebasestorage.app', messagingSenderId: '1015603414892' });
const auth = getAuth(app);
const gProvider = new GoogleAuthProvider();
gProvider.setCustomParameters({ prompt: 'select_account' });
let redirectErr = null;
getRedirectResult(auth).catch((e) => { redirectErr = e; });
const $ = (s, r = document) => r.querySelector(s);
const PRICES = { monthly: '$3.99', yearly: '$29.99' }, PER = { monthly: 'month', yearly: 'year' };

let authReady;
const ready = new Promise((r) => (authReady = r));
onAuthStateChanged(auth, (u) => { authReady(); document.dispatchEvent(new CustomEvent('pa-auth', { detail: u })); });

function authMsg(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'That email and password don\u2019t match an account. If you sign in to the app with Google, tap \u201cContinue with Google\u201d above. New here? Tap \u201cCreate account\u201d below.';
  if (/account-exists-with-different-credential|credential-already-in-use/.test(c)) return 'This email already has an account with a different sign-in method. Try \u201cContinue with Google\u201d or your email and password.';
  if (/email-already-in-use/.test(c)) return 'That email already has an account. If you made it with Google, tap \u201cContinue with Google\u201d above. Otherwise, sign in instead.';
  if (/weak-password/.test(c)) return 'Please use a password with at least 6 characters.';
  if (/popup-closed-by-user|cancelled-popup-request/.test(c)) return '';
  if (/unauthorized-domain|operation-not-allowed/.test(c)) return 'Google sign-in isn\u2019t available here right now. Please use email, or try again later.';
  if (/invalid-email/.test(c)) return 'Please enter a valid email address.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/network/.test(c)) return 'Can\u2019t reach the sign-in service. Check your connection and try again.';
  if (/user-disabled/.test(c)) return 'This account is disabled. Contact support@payaviator.app.';
  return 'Sign-in failed. Please try again.';
}
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
async function googleSignIn() {
  try { return await signInWithPopup(auth, gProvider); }
  catch (e) {
    const c = (e && e.code) || '';
    if (/popup-blocked|operation-not-supported-in-this-environment|web-storage-unsupported/.test(c) || (MOBILE && /internal-error/.test(c))) { await signInWithRedirect(auth, gProvider); return null; }
    throw e;
  }
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
  <p class="note" id="siNote">Use the same account you use in the PayAviator app.</p>
  <button type="button" class="btn gbtn" id="siGoogle"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg><span>Continue with Google</span></button>
  <p class="or"><span>or use email</span></p>
  <form id="siForm" class="fields" novalidate>
    <label>Email<input type="email" name="email" autocomplete="email" required></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
    <p class="hint err" id="siErr" role="alert"></p>
    <button class="btn primary subbtn" type="submit" id="siBtn">Sign in</button>
    <p class="fine" id="siFoot"></p>
  </form>`;
  document.body.appendChild(dlg);
  const f = $('#siForm', dlg), err = $('#siErr', dlg), btn = $('#siBtn', dlg), foot = $('#siFoot', dlg), gBtn = $('#siGoogle', dlg);
  let mode = 'signin';
  const label = () => mode === 'signup' ? 'Create account' : 'Sign in';
  const setMode = (m) => {
    mode = m; err.textContent = ''; err.classList.remove('ok');
    $('#siTitle', dlg).textContent = m === 'signup' ? 'Create your PayAviator account' : 'Sign in to PayAviator';
    $('#siNote', dlg).textContent = m === 'signup' ? 'One account works on payaviator.app and in the app.' : 'Use the same account you use in the PayAviator app.';
    f.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    f.password.placeholder = m === 'signup' ? 'At least 6 characters' : '';
    btn.textContent = label();
    foot.innerHTML = m === 'signup'
      ? 'Already have an account? <button type="button" class="linkbtn" data-m="signin">Sign in</button>'
      : '<button type="button" class="linkbtn" id="siForgot">Forgot password?</button> \u00b7 New here? <button type="button" class="linkbtn" data-m="signup">Create account</button>';
    dlg.dataset.mode = m;
  };
  foot.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.m) { setMode(t.dataset.m); f.email.focus(); return; }
    if (t.id !== 'siForgot') return;
    err.classList.remove('ok');
    const email = f.email.value.trim();
    if (!email) { err.textContent = 'Type your email above, then tap \u201cForgot password?\u201d again.'; f.email.focus(); return; }
    try { await sendPasswordResetEmail(auth, email); err.classList.add('ok'); err.textContent = 'If that email has a password account, a reset link is on its way. If you use Google, tap \u201cContinue with Google\u201d instead.'; }
    catch (x) { err.textContent = authMsg(x); }
  });
  gBtn.addEventListener('click', async () => {
    err.textContent = ''; err.classList.remove('ok'); gBtn.disabled = true;
    try { const r = await googleSignIn(); if (r) dlg.close('ok'); }
    catch (x) { err.textContent = authMsg(x); }
    finally { gBtn.disabled = false; }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; err.classList.remove('ok');
    const email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) { err.textContent = 'Enter your email and password.'; return; }
    btn.disabled = true; btn.textContent = mode === 'signup' ? 'Creating account\u2026' : 'Signing in\u2026';
    try {
      if (mode === 'signup') {
        const c = await createUserWithEmailAndPassword(auth, email, pw);
        try { await sendEmailVerification(c.user, { url: location.origin + location.pathname }); } catch (v) {}
      } else await signInWithEmailAndPassword(auth, email, pw);
      dlg.close('ok');
    } catch (x) { err.textContent = authMsg(x); }
    finally { btn.disabled = false; btn.textContent = label(); }
  });
  setMode('signin');
  dlg.addEventListener('close', () => { setMode('signin'); f.password.value = ''; });
  if (redirectErr) err.textContent = authMsg(redirectErr);
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
      const end = (s.cancelAtPeriodEnd && s.periodEnd) || s.currentPeriodEnd || s.periodEnd || s.expiresAt || ent.expiresAt || ent.currentPeriodEnd;
      const cancelling = s.cancelAtPeriodEnd || ent.cancelAtPeriodEnd;
      const d = end ? new Date(typeof end === 'number' && end < 1e12 ? end * 1000 : end) : null;
      const ds = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '';
      detail.textContent = (s.cancelAtPeriodEnd && s.periodEnd && ds) ? `Plus stays on until ${ds}.` : isPlus ? (cancelling ? `Cancelled. Plus stays on until ${ds || 'the end of the paid period'}.` : (ds ? `Renews on ${ds}.` : 'Active. Open the app to link more banks.')) : 'Your first bank account is free. Plus lets you link more.';
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
