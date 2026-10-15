// Regression: a paid first due date must not make later occurrences of a recurring bill look Paid (app uses the raw bill.paid flag).
const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
const { decodeBill } = await import('../js/codec.js'); const { billOccurrences } = await import('../js/calc.js');
let fails = 0; const ck = (n, c, d = '') => { console.log((c ? 'ok   ' : 'FAIL ') + n + ' ' + d); if (!c) fails++; };
const w = { id: 'x', name: 'Child Support', amount: 605, due: '2026-08-01', recurring: true, recurrence: 'monthly', paid: false, _pa: { '2026-08-01': 605 } };
const b = decodeBill('x', w);
const o = billOccurrences([b], 2026, 9); ck('Oct 1 unpaid (only Aug 1 was paid)', o.length === 1 && o[0].status === 'unpaid', JSON.stringify(o.map((x) => x.status)));
const b2 = decodeBill('x', { ...w, _pa: { '2026-08-01': 605, '2026-10-01': 605 } }); ck('Oct 1 paid when it has its own paid entry', billOccurrences([b2], 2026, 9)[0].status === 'paid');
const b3 = decodeBill('x', { ...w, paid: true }); ck('raw paid:true still applies to every occurrence (same as the app)', billOccurrences([b3], 2026, 9)[0].status === 'paid');
const one = decodeBill('y', { id: 'y', name: 'One', amount: 50, due: '2026-10-05', recurring: false, paid: false, _pa: { '2026-10-05': 50 } }); ck('one-time bill paid via _pa[due]', billOccurrences([one], 2026, 9)[0].status === 'paid');
process.exit(fails ? 1 : 0);
