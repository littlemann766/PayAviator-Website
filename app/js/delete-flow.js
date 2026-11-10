/** Ordinary account deletion decisions. No estate process. No network. */

export function deletionMessage(code) {
  if (code === 'REQUIRES_RECENT_LOGIN') return 'For your security, sign in again, then delete the account right away. Nothing was deleted yet.';
  if (code === 'USER_CHANGED') return 'The signed-in account changed. Deletion stopped. Your sign-in was kept.';
  if (code === 'DELETE_INCOMPLETE') return 'A bank connection could not be removed, so your sign-in was kept. This account was not deleted.';
  if (code === 'SIGNIN') return 'Sign in again before deleting. Nothing was deleted yet.';
  return 'PayAviator could not delete the account. Your sign-in was kept.';
}

/** Whether the Plaid account-deletion response is safe to follow with sign-in deletion. */
export function interpretPlaidDelete(result, err) {
  if (err) {
    const failed = err.failed_item_ids;
    if (err.status === 502 || (Array.isArray(failed) && failed.length)) return { ok: false, code: 'DELETE_INCOMPLETE' };
    if (err.status === 401 || err.code === 'SIGNIN' || err.code === 'HTTP_401') return { ok: false, code: 'SIGNIN' };
    return { ok: false, code: 'DELETE_FAILED' };
  }
  if (result && Array.isArray(result.failed_item_ids) && result.failed_item_ids.length) return { ok: false, code: 'DELETE_INCOMPLETE' };
  return { ok: true };
}

/**
 * @param {{ recent: boolean, startUid: string, currentUid: string }} state
 * Stops before any server call when the sign-in is stale or the user changed.
 */
export function beforeServerDelete(state) {
  if (!state || !state.recent) return { go: false, code: 'REQUIRES_RECENT_LOGIN' };
  if (!state.startUid || state.startUid !== state.currentUid) return { go: false, code: 'USER_CHANGED' };
  return { go: true };
}
