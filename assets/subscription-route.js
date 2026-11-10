/**
 * Where "Manage or cancel" goes. Uses only fields from GET /api/billing/status.
 * Stripe: the page asks the server to create a portal session for the signed-in user.
 *   POST /api/billing/stripe/portal with an empty body. The server looks up the Stripe
 *   customer from the Firebase uid (stripeBilling.js). The browser never sends a customer id or email.
 * Play: Google's subscription page. Package com.payaviator.app is the app applicationId
 *   (app/build.gradle) and the public Play testing link on join.html. The product id is
 *   status.productId from that user's entitlement, not a value typed on the page.
 *   Deep link shape: https://developer.android.com/google/play/billing/subscriptions#deep-link
 * Opening either page does not mean the subscription is cancelled.
 */
export const PLAY_PACKAGE = 'com.payaviator.app';
const PLAY_LIST = 'https://play.google.com/store/account/subscriptions';

function playSku(productId) {
  if (typeof productId !== 'string') return '';
  const sku = productId.trim();
  if (!sku || sku.startsWith('price_') || sku.length > 80) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(sku)) return '';
  return sku;
}

export function playManageUrl(productId) {
  const sku = playSku(productId);
  if (!sku) return PLAY_LIST;
  return `${PLAY_LIST}?sku=${encodeURIComponent(sku)}&package=${encodeURIComponent(PLAY_PACKAGE)}`;
}

/** @returns {{action:'stripe-portal'|'play'|'none'|'unknown', url?:string, message:string}} */
export function routeSubscription(status) {
  if (!status || typeof status !== 'object') {
    return { action: 'unknown', message: 'PayAviator could not read the subscription. Nothing was cancelled.' };
  }
  const source = status.source == null ? '' : String(status.source).toLowerCase();
  if (source === 'stripe') {
    if (status.stripeConfigured === false) {
      return { action: 'none', message: 'This subscription is billed with Stripe, but the server says Stripe is not configured, so the billing portal cannot open. Nothing was cancelled.' };
    }
    return { action: 'stripe-portal', message: 'Opening Stripe so you can manage or cancel. Plus stays active until the account status says otherwise.' };
  }
  if (source === 'play') {
    return { action: 'play', url: playManageUrl(status.productId), message: 'Opening Google Play subscriptions. Plus stays active until Google Play says otherwise.' };
  }
  if (source === 'comp' || status.plan === 'comp' || status.plan === 'free' || source === '') {
    const complimentary = source === 'comp' || status.plan === 'comp';
    return {
      action: 'none',
      message: complimentary
        ? 'This account has no Stripe or Google Play subscription to cancel.'
        : 'No Stripe or Google Play subscription was found for this account. Nothing was cancelled.',
    };
  }
  return { action: 'unknown', message: 'PayAviator could not tell whether Stripe or Google Play bills this subscription. Nothing was cancelled.' };
}

export function manageFailure(err) {
  const code = String((err && err.code) || '');
  if (code === 'SIGNIN' || code === 'HTTP_401' || err?.status === 401) return 'Sign in again before managing a subscription. Nothing was cancelled.';
  if (code === 'STRIPE_NOT_CONFIGURED' || code === 'BILLING_NOT_CONFIGURED') return 'Stripe is not configured on the server, so the billing portal did not open. Nothing was cancelled.';
  if (code === 'NO_STRIPE_CUSTOMER') return 'No Stripe subscription was found for this sign-in. Nothing was cancelled.';
  if (code === 'PORTAL_FAILED') return 'Stripe did not open the billing portal. Nothing was cancelled.';
  if (code === 'NETWORK') return 'PayAviator could not be reached. Nothing was cancelled.';
  return 'Could not open subscription management. Nothing was cancelled.';
}

/** Accept only an https URL the server created. Never a page-supplied customer id. */
export function safePortalUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return '';
    return u.toString();
  } catch (e) {
    return '';
  }
}
