/* PayAviator Subscribe page.
   Set prices here. Lucky wires Stripe Checkout by replacing window.PayAviatorSubscribe.onSubscribe. */
const PRICES = { monthly: '$3.99', yearly: '$29.99' };
/* Stripe flag: the page starts in a "coming soon" state (Subscribe disabled, friendly note).
   Once Stripe is live, call  window.PayAviatorSubscribe.setStripeConfigured(true)
   e.g. after  fetch('/api/billing/status').then(r => r.json()).then(s => PayAviatorSubscribe.setStripeConfigured(!!s.stripeConfigured))
   Checkout itself (sign-in required first): POST /api/billing/stripe/checkout {plan} -> {url}; wire it in onSubscribe.
   This page does not fetch the status or build sign-in on its own. */

(function () {
  'use strict';
  const PER = { monthly: 'month', yearly: 'year' };
  const $ = (s) => document.querySelector(s);
  const form = $('#subForm'), agree = $('#agree'), btn = $('#subBtn'), hint = $('#subHint'), renew = $('#renewNotice'), soon = $('#soonNote');
  let stripeConfigured = false, busy = false;

  window.PayAviatorSubscribe = window.PayAviatorSubscribe || {};
  if (typeof window.PayAviatorSubscribe.onSubscribe !== 'function') {
    /* Stub: replace with Stripe Checkout. Receives { plan: 'monthly'|'yearly', price: string }. May return a Promise. */
    window.PayAviatorSubscribe.onSubscribe = function ({ plan, price }) {
      console.info('[PayAviatorSubscribe stub] onSubscribe', { plan, price });
      return Promise.resolve({ ok: true, stub: true });
    };
  }
  window.PayAviatorSubscribe.prices = PRICES;
  window.PayAviatorSubscribe.getPlan = () => form.plan.value;
  window.PayAviatorSubscribe.isStripeConfigured = () => stripeConfigured;
  window.PayAviatorSubscribe.setStripeConfigured = function (on) { stripeConfigured = !!on; sync(); };

  const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
  function render() {
    const plan = form.plan.value, price = PRICES[plan];
    document.querySelectorAll('[data-amt]').forEach((e) => (e.textContent = PRICES[e.dataset.amt]));
    const m = num(PRICES.monthly), y = num(PRICES.yearly), tag = $('[data-save]');
    const pct = m > 0 && y > 0 && y < m * 12 ? Math.round((1 - y / (m * 12)) * 100) : 0;
    tag.textContent = pct > 0 ? `Save ${pct}%` : 'All year';
    renew.textContent = `${price} today. Renews automatically at ${price}/${PER[plan]} until you cancel.`;
    btn.textContent = stripeConfigured ? `Subscribe · ${price}/${PER[plan]}` : 'Coming soon';
  }
  function sync() {
    soon.hidden = stripeConfigured;
    btn.disabled = busy || !stripeConfigured || !agree.checked;
    hint.classList.remove('ok');
    hint.textContent = !stripeConfigured ? '' : agree.checked ? '' : 'Check the box above to continue.';
    render();
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'plan') render(); if (e.target === agree) sync(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!agree.checked || !stripeConfigured || busy) return;
    const plan = form.plan.value;
    busy = true; sync();
    try {
      await window.PayAviatorSubscribe.onSubscribe({ plan, price: PRICES[plan] });
      hint.textContent = 'Continuing to secure checkout (preview).'; hint.classList.add('ok');
    } catch (err) {
      console.warn(err); hint.textContent = 'Something went wrong. Please try again.';
    } finally { busy = false; btn.disabled = !stripeConfigured || !agree.checked; }
  });
  sync();
})();
