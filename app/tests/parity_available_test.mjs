// Same data as the Android app's tools/test-available-now.py: checking 1240.50 + cash-free => bank total must match the app's rule.
// App (with cash on hand 150) = 1390.50; web has no cash wallet, so checking alone = 1240.50. Savings/credit/loan/investment excluded.
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { safeToSpend, acctIncluded, setAcctChoice } = await import('../js/calc.js');
const A = [
  { id: 'acc-chk', name: 'Checking', institution_name: 'Chase', mask: '1111', type: 'depository', subtype: 'checking', available: 1240.5, current: 1302.75 },
  { id: 'acc-sav', name: 'Savings', institution_name: 'Chase', mask: '2222', type: 'depository', subtype: 'savings', available: null, current: 3000 },
  { id: 'acc-cc', name: 'Card', institution_name: 'Cap One', mask: '3333', type: 'credit', subtype: 'credit card', available: 1187.67, current: 812.33 },
  { id: 'acc-loan', name: 'Auto', institution_name: 'Ally', mask: '4444', type: 'loan', subtype: 'auto', current: 9400 },
  { id: 'acc-inv', name: 'Brokerage', institution_name: 'Fidelity', mask: '5555', type: 'investment', subtype: 'brokerage', current: 5000 }];
let fails = 0; const ck = (n, c, d = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + ' ' + d); if (!c) fails++; };
const d = { bills: [], income: [], spending: [], goals: [], cushion: { mode: 'dollar', dollar: 0 } };
let s = safeToSpend(d, A); ck('default: checking only = 1240.50', s.bankAvailable === 1240.5, s.bankAvailable);
setAcctChoice(A[0], false); setAcctChoice(A[1], true); s = safeToSpend(d, A); ck('toggle: checking off, savings on = 3000', s.bankAvailable === 3000, s.bankAvailable);
setAcctChoice(A[2], true); setAcctChoice(A[3], true); s = safeToSpend(d, A); ck('credit/loan never counted', s.bankAvailable === 3000 && !acctIncluded(A[2]) && !acctIncluded(A[4]));
delete store.payaviator_account_choices_v920; s = safeToSpend(d, A); ck('choices cleared = 1240.50', s.bankAvailable === 1240.5);
store.payaviator_cash_wallet_v950 = JSON.stringify({ spendable: 150, saved: 0 }); s = safeToSpend(d, A); ck('cash on hand 150 + checking = 1390.50 (same as the app)', s.bankAvailable === 1390.5, s.bankAvailable);
store.payaviator_cash_wallet_v950 = JSON.stringify({ spendable: 150, saved: 0, inBankAccount: true }); s = safeToSpend(d, A); ck('cash already in a bank account not double counted', s.bankAvailable === 1240.5);
process.exit(fails ? 1 : 0);
