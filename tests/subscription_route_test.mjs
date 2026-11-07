import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeSubscription, playManageUrl, manageFailure, safePortalUrl, PLAY_PACKAGE } from '../assets/subscription-route.js';

const plain = 'PayAviator is independently operated. Support is not monitored continuously. We aim to respond to support requests within 72 hours. Some issues require additional investigation and may take longer to resolve. For urgent banking issues or suspected fraud, contact your bank directly.';
let failed = 0;
const check = (name, cond) => {
  if (cond) console.log('  ok  ', name);
  else { failed += 1; console.log('  FAIL', name); }
};

const stripe = routeSubscription({ plan: 'premium', source: 'stripe', productId: 'price_123', periodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false, customerId: 'cus_evil', email: 'a@b.c' });
check('stripe routes to server portal, no client customer id', stripe.action === 'stripe-portal' && !stripe.url && !JSON.stringify(stripe).includes('cus_evil'));

const stripeOff = routeSubscription({ plan: 'premium', source: 'stripe', stripeConfigured: false });
check('stripe unconfigured does not pretend the portal opened', stripeOff.action === 'none' && /not configured/i.test(stripeOff.message) && /nothing was cancelled/i.test(stripeOff.message));

const play = routeSubscription({ plan: 'premium', source: 'play', productId: 'payaviator_premium', expiresAt: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false, email: 'a@b.c' });
check('play uses status product id and verified package', play.action === 'play' && play.url === 'https://play.google.com/store/account/subscriptions?sku=payaviator_premium&package=com.payaviator.app');
check('play url ignores email', !play.url.includes('a%40') && !play.url.includes('email'));

const playPrice = routeSubscription({ source: 'play', productId: 'price_abc' });
check('stripe price id is not sent to Play as a sku', playPrice.url === 'https://play.google.com/store/account/subscriptions');

const playMissing = routeSubscription({ source: 'play', productId: null });
check('play without a product id opens the subscription list', playMissing.url === playManageUrl(''));

check('package matches the public Play testing link', readFileSync(new URL('../join.html', import.meta.url), 'utf8').includes(`play.google.com/apps/testing/${PLAY_PACKAGE}`));

check('free account has nothing to cancel', routeSubscription({ plan: 'free', source: null }).action === 'none');
check('comp account has nothing to cancel', /no Stripe or Google Play/i.test(routeSubscription({ plan: 'comp', source: 'comp' }).message));
check('unknown provider does not invent a portal', routeSubscription({ plan: 'premium', source: 'other' }).action === 'unknown');
check('missing status is unknown', routeSubscription(null).action === 'unknown');

check('auth failure does not claim a cancel', /sign in again/i.test(manageFailure({ code: 'SIGNIN', status: 401 })) && /nothing was cancelled/i.test(manageFailure({ code: 'HTTP_401', status: 401 })));
check('portal failure is not success', /did not open/i.test(manageFailure({ code: 'PORTAL_FAILED' })) && /not configured/i.test(manageFailure({ code: 'STRIPE_NOT_CONFIGURED' })));
check('no stripe customer is not success', /no stripe subscription/i.test(manageFailure({ code: 'NO_STRIPE_CUSTOMER' })));

check('rejects a non-https portal url', safePortalUrl('javascript:alert(1)') === '' && safePortalUrl('http://billing.stripe.com/p/session') === '');
check('keeps an https portal url', safePortalUrl('https://billing.stripe.com/p/session/test') === 'https://billing.stripe.com/p/session/test');

const settings = readFileSync(new URL('../app/js/pages/settings.js', import.meta.url), 'utf8');
const portalCall = settings.slice(settings.indexOf('async function openManage'), settings.indexOf('function openDeleteAccount'));
check('manage reads status then posts portal with no customer id', portalCall.includes('api.billingPortal()') && !portalCall.includes('customerId') && !portalCall.includes('customer_email'));
check('delete warning is not a cancel gate', settings.includes('does not cancel a Stripe or Google Play subscription') && settings.includes("data-act': 'delete-account'") && settings.indexOf('hasRecentLogin') < settings.indexOf('deletePlaidUser'));
check('delete sheet offers manage without removing delete', settings.includes("data-act': 'manage-from-delete'") && settings.includes('Delete my account forever'));

for (const rel of ['support.html', 'faq.html', 'terms.html']) {
  const text = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  check(rel + ' keeps the concise support sentences', text.includes('We aim to respond to support requests within 72 hours.') && !/automatic reply|elapsed hour/i.test(text));
}

assert.equal(failed, 0, failed + ' subscription checks failed');
console.log('\nsubscription route checks passed');
