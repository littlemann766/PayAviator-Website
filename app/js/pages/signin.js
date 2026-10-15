import { h, icon, $ } from '../util.js';
import { auth, authMessage, demoEnabled } from '../auth.js';

const root = $('#root');
const q = new URLSearchParams(location.search);
const GOOGLE = () => {
  const s = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" class="g-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.8 0-5.2-1.9-6-4.5H2.4v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M6 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.4a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.4 7.1L6 9.9c.8-2.6 3.2-4.5 6-4.5z"/></svg>', 'image/svg+xml');
  return document.importNode(s.documentElement, true);
};

let mode = 'signin';
let card;

function field(id, label, type, ph, ac, errText) {
  const err = h('p', { class: 'err', id: id + '-e', hidden: true }, icon('alert', 'ic sm'), h('span', { text: errText }));
  const input = h('input', { id, name: id, type, placeholder: ph, autocomplete: ac, required: true, 'aria-describedby': id + '-e' });
  const wrap = h('div', { class: 'fld' }, h('label', { for: id, text: label }), h('div', { class: 'inp' }, input), err);
  return { wrap, input, bad(on) { wrap.classList.toggle('invalid', on); err.hidden = !on; if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); } };
}

function intro() {
  return h('section', { class: 'si-intro' },
    h('a', { class: 'brand dark', href: 'signin.html' }, h('img', { src: 'img/logo-64.png', width: 40, height: 40, alt: '' }), h('span', { text: 'PayAviator' })),
    h('h1', { text: 'All your accounts in one place.' }),
    h('p', { class: 'lead', text: 'See what is safe to spend, then manage your bills, income and budget on the web and on Android. One account, always in sync.' }),
    h('ul', { class: 'ticks' }, ['The same Safe to Spend gauge as the app', 'Changes sync to your phone automatically', 'Sign in with Google or email'].map((t) => h('li', null, icon('check'), h('span', { text: t })))));
}

function shell(cardNode) {
  root.replaceChildren(h('div', { class: 'si-wrap' }, intro(), cardNode),
    h('p', { class: 'si-foot' }, '\u00a9 2026 PayAviator \u00b7 ', h('a', { href: '../privacy.html', text: 'Privacy' }), ' \u00b7 ', h('a', { href: '../terms.html', text: 'Terms' }), ' \u00b7 support@payaviator.app'));
}

function goHome() { location.replace('index.html'); }

function viewSignin() {
  const demo = auth.demo, off = auth.state === 'unavailable';
  const email = field('em', 'Email', 'email', 'you@example.com', 'email', 'Enter the email you signed up with.');
  const pw = field('pw', 'Password', 'password', 'Password', mode === 'signup' ? 'new-password' : 'current-password', mode === 'signup' ? 'Use at least 6 characters.' : 'Enter your password.');
  const msg = h('p', { class: 'err', role: 'alert', hidden: true, 'data-msg': '' }, icon('alert', 'ic sm'), h('span'));
  const ok = h('p', { class: 'okmsg', role: 'status', hidden: true });
  const say = (t) => { msg.hidden = !t; msg.querySelector('span').textContent = t || ''; };
  const submit = h('button', { class: 'btn primary wide', type: 'submit', text: mode === 'signup' ? 'Create account' : 'Sign in' });
  const busy = async (fn) => { say(''); ok.hidden = true; submit.disabled = true; try { await fn(); } catch (e) { say(authMessage(e)); } finally { submit.disabled = false; } };

  const form = h('form', { novalidate: true, action: '#', onsubmit: (e) => {
    e.preventDefault();
    const eb = !email.input.value.trim(), pb = !pw.input.value || (mode === 'signup' && pw.input.value.length < 6);
    email.bad(eb); pw.bad(pb); if (eb) return email.input.focus(); if (pb) return pw.input.focus();
    busy(async () => {
      const u = mode === 'signup' ? await auth.signUp(email.input.value.trim(), pw.input.value) : await auth.signInEmail(email.input.value.trim(), pw.input.value);
      if (u && u.emailVerified) goHome(); else render();
    });
  } }, email.wrap, pw.wrap,
  mode === 'signin' ? h('p', null, h('button', { class: 'linkbtn', type: 'button', text: 'Forgot password?', onclick: () => {
    if (!email.input.value.trim()) { email.bad(true); return email.input.focus(); }
    busy(async () => { await auth.sendReset(email.input.value.trim()); ok.hidden = false; ok.textContent = 'If that email has an account, a reset link is on its way.'; });
  } })) : null, msg, ok, submit);

  const googleBtn = demo
    ? h('button', { class: 'btn google', type: 'button', 'data-demo': '', onclick: async () => { await auth.signInDemo(); goHome(); } }, icon('user'), h('span', { text: 'Continue as demo user' }))
    : h('button', { class: 'btn google', type: 'button', disabled: off, onclick: () => { say(''); auth.signInGoogle().then((u) => { if (u) (u.emailVerified ? goHome() : render()); }).catch((e) => say(authMessage(e))); } }, GOOGLE(), h('span', { text: 'Continue with Google' }));

  card = h('section', { class: 'si-card', 'aria-labelledby': 'si-h' },
    h('h2', { id: 'si-h', text: mode === 'signup' ? 'Create account' : 'Sign in' }),
    off ? h('div', { class: 'banner', role: 'alert' }, icon('alert'), h('p', null, h('b', { text: 'Sign-in is unavailable right now. ' }), 'We could not load the sign-in service. Check your connection and reload. ', h('button', { class: 'linkbtn', type: 'button', text: 'Reload', onclick: () => location.reload() }))) : null,
    demo ? h('div', { class: 'banner' }, icon('eye'), h('p', null, h('b', { text: 'Demo mode. ' }), 'Sample data on this computer only. Nothing is sent anywhere.')) : null,
    googleBtn, h('div', { class: 'or' }, h('span', { text: 'or use email' })),
    demo ? h('p', { class: 'msg', text: 'Email sign-in is disabled in demo mode.' }) : form,
    demo ? null : h('p', { class: 'alt' }, mode === 'signup' ? 'Already have an account? ' : 'New to PayAviator? ', h('button', { class: 'linkbtn', type: 'button', text: mode === 'signup' ? 'Sign in' : 'Create account', onclick: () => { mode = mode === 'signup' ? 'signin' : 'signup'; render(); } })),
    h('p', { class: 'fine' }, icon('lock'), h('span', { text: 'Verify your email once after creating an account. Use the newest email we send.' })));
  shell(card);
}

function viewVerify() {
  const u = auth.user;
  const status = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  const err = h('p', { class: 'err', role: 'alert', hidden: true }, icon('alert', 'ic sm'), h('span'));
  const say = (t) => { err.hidden = !t; err.querySelector('span').textContent = t || ''; };
  const resend = h('button', { class: 'btn ghost wide', type: 'button' });
  const cont = h('button', { class: 'btn primary wide', type: 'button', text: 'I verified, continue' });
  let timer;
  const tick = () => { const s = auth.resendRemaining(); resend.disabled = s > 0; resend.textContent = s > 0 ? `Resend email in ${s}s` : 'Resend verification email'; if (s <= 0) clearInterval(timer); };
  const recheck = async (loud) => {
    cont.disabled = true; say('');
    try { const v = await auth.checkVerified(); if (v) return goHome(); if (loud) say('Not verified yet. Open the newest email we sent, tap its link, then come back and tap this button again.'); }
    catch (e) { if (loud) say(authMessage(e)); }
    finally { cont.disabled = false; }
  };
  cont.addEventListener('click', () => recheck(true));
  resend.addEventListener('click', async () => {
    say(''); try { await auth.sendVerification(); status.textContent = 'Sent. Use the newest email: older links stop working.'; } catch (e) { say(authMessage(e)); }
    clearInterval(timer); timer = setInterval(tick, 1000); tick();
  });
  addEventListener('focus', () => recheck(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(false); });
  card = h('section', { class: 'si-card', 'aria-labelledby': 'si-h' },
    h('h2', { id: 'si-h', text: 'Verify your email' }),
    h('p', { class: 'msg' }, 'We sent a link to ', h('b', { text: u.email || 'your email' }), '. Tap it, then come back here. Only the newest email works.'),
    status, err, h('div', { class: 'stack' }, cont, resend, h('button', { class: 'btn ghost wide', type: 'button', text: 'Use a different account', onclick: async () => { await auth.signOut(); location.replace('signin.html'); } })));
  shell(card); tick(); if (auth.resendRemaining() > 0) timer = setInterval(tick, 1000);
}

function render() {
  if (auth.user && !auth.user.emailVerified) return viewVerify();
  viewSignin();
}

(async () => {
  document.title = 'Sign in \u00b7 PayAviator';
  shell(h('section', { class: 'si-card', 'aria-busy': 'true' }, h('h2', { text: 'Sign in' }), h('p', { class: 'msg', text: 'Loading\u2026' })));
  await auth.init();
  if (demoEnabled() && q.get('demo') === '1' && !auth.user) await auth.signInDemo();
  if (auth.user && auth.user.emailVerified) return goHome();
  render();
  const re = auth.takeRedirectError(); if (re) { const m = authMessage(re); if (m) { const e = card.querySelector('[data-msg]'); if (e) { e.hidden = false; e.querySelector('span').textContent = m; } } }
})();
