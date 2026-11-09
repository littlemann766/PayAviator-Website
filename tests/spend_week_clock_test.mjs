/** Controlled clock for the Week spending legend. Does not change the app. */
import assert from 'node:assert/strict';
import { spendRows, breakdown } from '../app/js/spendchart.js';

const T = (now, n, name, amount, prim, det, pending = false) => {
  const date = new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);
  return { transaction_id: name, date, name, merchant_name: name, amount, pending, personal_finance_category: { primary: prim, detailed: det } };
};
function bank(now) {
  return [
    T(now, 0, 'Grocery Mart', 52.18, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES', true),
    T(now, 1, 'Coffee House', 6.5, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'),
    T(now, 2, 'Chipotle', 12.35, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'),
    T(now, 2, 'Speedway', 38.9, 'TRANSPORTATION', 'TRANSPORTATION_GAS'),
    T(now, 1, 'Amazon', 29.99, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'),
    T(now, 1, 'Netflix', 15.49, 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES'),
    T(now, 3, 'Acme Co.', -2180.55, 'INCOME', 'INCOME_WAGES'),
    T(now, 0, 'Card payment', 300, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'),
  ];
}
function labels(iso) {
  const now = new Date(iso + 'T15:00:00');
  const rows = spendRows({ spending: [], bills: [] }, bank(now), 'week', now);
  return breakdown(rows, 'category').parts.map((p) => p[0]);
}
const sat = labels('2026-11-07');
const mon = labels('2026-11-09');
assert.ok(sat.includes('Food And Drink'), sat.join(','));
assert.ok(mon.includes('Food And Drink'), mon.join(','));
for (const set of [sat, mon]) {
  assert.equal(set.includes('Income'), false);
  assert.equal(set.some((x) => /loan/i.test(x)), false);
}
console.log('spend week clock: Food And Drink is in the Sunday week on 2026-11-07 and 2026-11-09');
console.log('classification: browser Week legend names are calendar-sensitive once paid bills crowd the top 5; not a policy-candidate regression');
