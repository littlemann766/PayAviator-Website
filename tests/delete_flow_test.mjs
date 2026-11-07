import assert from 'node:assert/strict';
import { beforeServerDelete, interpretPlaidDelete, deletionMessage } from '../app/js/delete-flow.js';

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log('  ok  ', name);
  else { failed += 1; console.log('  FAIL', name); }
};

check('stale sign-in does not start deletion', beforeServerDelete({ recent: false, startUid: 'u1', currentUid: 'u1' }).code === 'REQUIRES_RECENT_LOGIN');
check('a different signed-in user stops deletion', beforeServerDelete({ recent: true, startUid: 'u1', currentUid: 'u2' }).go === false);
check('same recent user may continue', beforeServerDelete({ recent: true, startUid: 'u1', currentUid: 'u1' }).go === true);

const partial = interpretPlaidDelete(null, { status: 502, failed_item_ids: ['item-b'] });
check('partial bank removal is not success', partial.ok === false && partial.code === 'DELETE_INCOMPLETE');
check('incomplete message keeps the sign-in', /sign-in was kept/i.test(deletionMessage('DELETE_INCOMPLETE')) && !/was deleted/i.test(deletionMessage('DELETE_INCOMPLETE').replace('not deleted', '')));
check('a 200 body that still lists failures is not success', interpretPlaidDelete({ removed: 1, failed_item_ids: ['item-b'] }, null).ok === false);
check('clean removal may continue to sign-in deletion', interpretPlaidDelete({ removed: 2, failed_item_ids: [] }, null).ok === true);
check('auth failure is not success', interpretPlaidDelete(null, { status: 401, code: 'SIGNIN' }).code === 'SIGNIN');
check('missing endpoint does not count as deleted', interpretPlaidDelete(null, { status: 404, code: 'HTTP_404' }).code === 'DELETE_FAILED');
check('stale message says nothing was deleted yet', /nothing was deleted yet/i.test(deletionMessage('REQUIRES_RECENT_LOGIN')));

assert.equal(failed, 0);
console.log('\ndelete flow checks passed');
