/* Firebase web Auth (Google + email only; no phone). Loads the Firebase SDK the same way the site's assets/billing.js does
   (ESM from www.gstatic.com, same public web config / project payaviator-app). Demo mode never loads Firebase. */
const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
const FB_CONFIG = { apiKey: 'AIzaSyAJ72nfiPWkccGTAzMd0XGODCjabSqFRyM', authDomain: 'payaviator-app.firebaseapp.com', projectId: 'payaviator-app', storageBucket: 'payaviator-app.firebasestorage.app', messagingSenderId: '1015603414892' }; // public by design
export const COOLDOWN_MS = 60000;
const RESEND_KEY = 'pa_resend_at';

const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
/** DEV_MOCK: only on localhost, only via ?demo=1 (remembered for the tab session). Always OFF on real hosts. */
export function demoEnabled() {
  if (!isLocal) return false;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '1') sessionStorage.setItem('pa_demo', '1');
    if (q.get('demo') === '0') { sessionStorage.removeItem('pa_demo'); sessionStorage.removeItem('pa_demo_user'); }
    return sessionStorage.getItem('pa_demo') === '1';
  } catch (e) { return false; }
}
export const DEMO_USER = Object.freeze({ uid: 'demo-user', email: 'demo@example.com', displayName: 'Demo User', emailVerified: true, providers: ['demo'] });

export function authMessage(e) {
  const c = (e && e.code) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'That email and password don\u2019t match an account. If you sign in to the app with Google, choose \u201cContinue with Google\u201d.';
  if (/account-exists-with-different-credential|credential-already-in-use/.test(c)) return 'This email already has an account with a different sign-in method. Try \u201cContinue with Google\u201d or your email and password.';
  if (/email-already-in-use/.test(c)) return 'That email already has an account. If you made it with Google, choose \u201cContinue with Google\u201d. Otherwise, sign in instead.';
  if (/weak-password/.test(c)) return 'Please use a password with at least 6 characters.';
  if (/popup-closed-by-user|cancelled-popup-request/.test(c)) return '';
  if (/unauthorized-domain|operation-not-allowed/.test(c)) return 'Google sign-in isn\u2019t available here right now. Please use email, or try again later.';
  if (/invalid-email/.test(c)) return 'Please enter a valid email address.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/network/.test(c)) return 'Can\u2019t reach the sign-in service. Check your connection and try again.';
  if (/user-disabled/.test(c)) return 'This account is disabled. Contact support@payaviator.app.';
  if (/requires-recent-login/.test(c)) return 'For your security, please sign out, sign in again, and then delete your account right away.';
  if (c === 'pa/cooldown') return e.message;
  if (c === 'pa/unavailable') return 'Sign-in is unavailable right now (could not load the sign-in service). Check your connection and reload.';
  return 'Sign-in failed. Please try again.' + (c ? ' (' + c + ')' : '');
}

const A = { state: 'loading', user: null, fb: null, auth: null, demo: false, subs: new Set() };
const pub = (u) => (u ? { uid: u.uid, email: u.email || '', displayName: u.displayName || '', emailVerified: !!u.emailVerified, providers: (u.providerData || []).map((p) => p.providerId) } : null);
const notify = () => A.subs.forEach((f) => f(A.user));

function withTimeout(p, ms, code) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code })), ms))]); }

export const auth = {
  get state() { return A.state; },
  get user() { return A.user; },
  get demo() { return A.demo; },
  onChange(fn) { A.subs.add(fn); return () => A.subs.delete(fn); },

  /** Resolves once the initial session is known. state becomes 'ready' or 'unavailable' (Firebase could not load). */
  async init() {
    if (A.initP) return A.initP;
    A.initP = (async () => {
      A.demo = demoEnabled();
      if (A.demo) {
        A.user = sessionStorage.getItem('pa_demo_user') === '1' ? { ...DEMO_USER } : null;
        A.state = 'ready'; return A;
      }
      try {
        const [app, au] = await withTimeout(Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js')]), 10000, 'pa/unavailable');
        A.fb = au;
        A.auth = au.getAuth(app.initializeApp(FB_CONFIG));
        await au.setPersistence(A.auth, au.browserSessionPersistence); // session only: closing the tab signs out
        try { await au.getRedirectResult(A.auth); } catch (e) { A.redirectError = e; }
        await new Promise((res) => { let first = true; au.onAuthStateChanged(A.auth, (u) => { A.user = pub(u); A.state = 'ready'; notify(); if (first) { first = false; res(); } }); });
      } catch (e) { A.state = 'unavailable'; A.user = null; }
      return A;
    })();
    return A.initP;
  },
  takeRedirectError() { const e = A.redirectError; A.redirectError = null; return e; },

  async signInDemo() { A.user = { ...DEMO_USER }; sessionStorage.setItem('pa_demo_user', '1'); notify(); return A.user; },
  async signInEmail(email, pw) { this._need(); const r = await A.fb.signInWithEmailAndPassword(A.auth, email, pw); A.user = pub(r.user); return A.user; },
  async signUp(email, pw) {
    this._need(); const r = await A.fb.createUserWithEmailAndPassword(A.auth, email, pw);
    A.user = pub(r.user); await this.sendVerification(true); return A.user;
  },
  async signInGoogle() {
    this._need();
    const p = new A.fb.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    try { const r = await A.fb.signInWithPopup(A.auth, p); A.user = pub(r.user); return A.user; }
    catch (e) {
      const c = (e && e.code) || '';
      try { console.warn('[auth] Google sign-in error:', c, e && e.message); } catch (_) {}
      if (/popup-blocked|operation-not-supported-in-this-environment|web-storage-unsupported/.test(c) || (mobile && /internal-error/.test(c))) { await A.fb.signInWithRedirect(A.auth, p); return null; }
      throw e;
    }
  },
  async sendReset(email) { this._need(); await A.fb.sendPasswordResetEmail(A.auth, email); },
  _need() { if (A.demo) throw Object.assign(new Error('Demo mode: use \u201cContinue as demo user\u201d.'), { code: 'pa/demo' }); if (!A.auth) throw Object.assign(new Error('unavailable'), { code: 'pa/unavailable' }); },

  /** Seconds until another verification email may be sent (60 s cooldown). */
  resendRemaining() {
    const t = Number(sessionStorage.getItem(RESEND_KEY) || 0);
    return Math.max(0, Math.ceil((t + COOLDOWN_MS - Date.now()) / 1000));
  },
  async sendVerification(first = false) {
    const left = this.resendRemaining();
    if (!first && left > 0) throw Object.assign(new Error(`Please wait ${left} seconds. Only the newest email works, so use the newest one.`), { code: 'pa/cooldown' });
    if (A.demo) { sessionStorage.setItem(RESEND_KEY, String(Date.now())); return; }
    this._need();
    await A.fb.sendEmailVerification(A.auth.currentUser);
    sessionStorage.setItem(RESEND_KEY, String(Date.now()));
  },
  /** After the user says "I verified" (and on tab focus): reload the user, then force a fresh ID token so the server stops seeing the old "not verified" claim. */
  async checkVerified() {
    if (A.demo) return true;
    const u = A.auth && A.auth.currentUser; if (!u) return false;
    await u.reload();
    await u.getIdToken(true);
    A.user = pub(u); notify();
    return u.emailVerified;
  },
  async getToken(force = false) {
    if (A.demo) return 'demo-token';
    const u = A.auth && A.auth.currentUser; if (!u) throw Object.assign(new Error('Signed out'), { code: 'SIGNIN' });
    return u.getIdToken(force);
  },
  /** Permanently delete the Firebase user. Throws code 'auth/requires-recent-login' if the sign-in is too old. */
  async deleteUser() {
    if (A.demo) { await this.signOut(); return; }
    const u = A.auth && A.auth.currentUser; if (!u) throw Object.assign(new Error('Signed out'), { code: 'SIGNIN' });
    await A.fb.deleteUser(u);
    A.user = null; notify();
  },
  /** Sign out and clear everything held on this browser. */
  async signOut() {
    try { if (A.demo) { sessionStorage.removeItem('pa_demo_user'); Object.keys(localStorage).filter((k) => k.startsWith('pa_demo_server_v1:')).forEach((k) => localStorage.removeItem(k)); } else if (A.auth) await A.fb.signOut(A.auth); } catch (e) { /* still clear below */ }
    A.user = null; sessionStorage.removeItem(RESEND_KEY); notify();
  },
};
