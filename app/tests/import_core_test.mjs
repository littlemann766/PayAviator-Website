// Spreadsheet import: parsing, column detection, dates/amounts, duplicates, bad/huge files. Pure Node (no browser): node app/tests/import_core_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
const here = path.dirname(fileURLToPath(import.meta.url));
const corePath = process.env.PA_IMPORT_CORE || path.join(here, '..', 'js', 'import-core.js');
await import(pathToFileURL(corePath).href);
const P = globalThis.PAImport;
const FX = path.join(here, 'import_fixtures');
let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fails.push(name); console.log('  FAIL', name, extra); } };
const buf = (f) => { const b = fs.readFileSync(path.join(FX, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const NOW = new Date(2026, 9, 16);
const EXIST = { bills: [{ name: 'Electric', amount: 118, due: '2026-10-03' }, { name: 'Rent', amount: 1450, due: '2026-10-01' }], income: [{ name: 'Paycheck', amount: 1850, date: '2026-10-09' }] };
function load(f, sheet = 0) {
  const r = P.readFile(buf(f), f), rows = r.sheets[sheet].rows, an = P.analyze(rows, NOW);
  return { r, rows, an, items: P.buildItems(rows, an, { now: NOW, ...EXIST }).items };
}
const err = (f) => { try { P.readFile(buf(f), f); return null; } catch (e) { return e; } };
const by = (items, n) => items.find((i) => i.name === n);

console.log('[inflate vs zlib]');
for (const [label, data] of [['empty', Buffer.alloc(0)], ['text', Buffer.from('hello hello hello world '.repeat(5000))], ['random', Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 2654435761) >>> 24))], ['zeros', Buffer.alloc(300000)]]) {
  for (const lvl of [0, 1, 9]) { const z = zlib.deflateRawSync(data, { level: lvl }); const o = P._inflate(new Uint8Array(z), 0, z.length, 1 << 26); ok(`inflate ${label} level ${lvl}`, Buffer.compare(Buffer.from(o), data) === 0); }
}
{ const z = zlib.deflateRawSync(Buffer.from('abc'.repeat(100)), { strategy: zlib.constants.Z_FIXED }); ok('inflate fixed-huffman block', Buffer.from(P._inflate(new Uint8Array(z), 0, z.length, 1 << 20)).toString() === 'abc'.repeat(100)); }

console.log('[typical xlsx]');
{
  const { an, items } = load('bills_typical.xlsx');
  ok('header row found below a title row', an.headerRow === 2 || an.headerRow === 1, JSON.stringify(an));
  ok('all seven columns detected, detection is sure', an.sure && ['name', 'amount', 'due', 'freq', 'category', 'paid', 'notes'].every((k) => an.mapping[k] != null), JSON.stringify(an.mapping));
  ok('rows read', items.length === 8, items.length);
  const e = by(items, 'Electric'); ok('real Excel date cell becomes ISO', e && e.due === '2026-11-03' && e.amount === 112.45);
  ok('existing "Electric" is flagged duplicate and unchecked', e.dup && !e.checked && /already in Bills/.test(e.dupWhy));
  ok('existing "Rent" is flagged duplicate', by(items, 'Rent').dup && !by(items, 'Rent').checked);
  ok('Rent paid=Yes read', by(items, 'Rent').paid === true && by(items, 'Netflix').paid === false && by(items, 'Car insurance').paid === true && by(items, 'Gym').paid === false);
  ok('frequency words mapped (Every 2 weeks -> biweekly)', by(items, 'Car insurance').fq === 'biweekly' && by(items, 'Netflix').fq === 'monthly');
  ok('Yearly is not supported: one-time + explanation', by(items, 'Gym').fq === 'never' && /one-time/.test(by(items, 'Gym').note));
  ok('Paycheck defaults to Income, checked', by(items, 'Paycheck').dest === 'income' && by(items, 'Paycheck').fq === 'biweekly');
  ok('heading row and total row default to Skip, unchecked', by(items, 'Utilities').dest === 'skip' && by(items, 'Total').dest === 'skip' && !by(items, 'Total').checked);
  ok('category column used as written', by(items, 'Electric').category === 'Utilities' && by(items, 'Netflix').category === 'Subscriptions');
  ok('Paycheck matches existing income, so it is flagged and unchecked', by(items, 'Paycheck').dup && !by(items, 'Paycheck').checked);
}
console.log('[headerless / day-only / ambiguous]');
{
  const { an, items } = load('no_header.xlsx');
  ok('no header: name/amount/due guessed from the data but flagged unsure (mapping step)', an.headerRow === -1 && an.mapping.name === 0 && an.mapping.amount === 1 && an.mapping.due === 2 && !an.sure, JSON.stringify(an));
  ok('text dates m/d/yyyy, m/d/yy, "Nov 9, 2026", ISO and "3 Dec 2026"', ['2026-11-05', '2026-11-18', '2026-11-09', '2026-11-25', '2026-12-03'].every((d, i) => items[i].due === d), items.map((i) => i.due).join());
  ok('"$45.10", "(210.00)", "1,059.50" amounts', items[0].amount === 45.1 && items[3].amount === 210 && items[4].amount === 1059.5);
  const d = load('day_only.xlsx').items;
  ok('day-of-month column -> next upcoming date, monthly', d[0].due === '2026-11-01' && d[1].due === '2026-11-15' && d[2].due === '2026-10-28' && d[3].due === '2026-10-31' && d.every((i) => i.fq === 'monthly'), d.map((i) => i.due).join());
  const a = load('ambiguous.xlsx'); ok('ambiguous headers -> not sure (asks for column mapping)', !a.an.sure);
  ok('rows without a date are invalid and unchecked until fixed', a.items.every((i) => !i.checked && i.errors.includes('due')));
}
console.log('[weird values]');
{
  const { items } = load('weird.xlsx'), g = (n) => by(items, n);
  ok('good row ok', g('Good').checked && !g('Good').errors.length);
  ok('impossible date 13/45/2026 -> invalid, unchecked, explained', g('Bad date').errors.includes('due') && !g('Bad date').checked && /13\/45\/2026/.test(g('Bad date').note));
  ok('0 / blank / text amounts invalid', ['Zero amount', 'No amount', 'Text amount'].every((n) => g(n).errors.includes('amount') && !g(n).checked));
  ok('huge amount rejected', g('Huge').errors.includes('amount'));
  ok('negative amount becomes positive', g('Negative').amount === 45.5);
  ok('blank name invalid', items.some((i) => i.name === '' && i.errors.includes('name') && !i.checked));
  ok('name capped at 80 chars', g('x'.repeat(80)) && g('x'.repeat(80)).name.length === 80);
  ok('emoji / html-ish names kept as plain text', g('Emoji \u{1F3E0} rent') && g('<b>html</b> & "quotes"'));
  ok('12,50 read as 12.50; leap day ok; Feb 29 2027 invalid', g('Euro style').amount === 12.5 && g('Leap').due === '2028-02-29' && g('Not leap').errors.includes('due'));
}
console.log('[csv variants]');
{
  let { items } = load('plain.csv');
  ok('plain csv with quoted comma + $1,200.00', items.length === 3 && items[1].name === 'Smith, John (rent)' && items[1].amount === 1200 && items[1].due === '2026-11-01' && items[2].due === '2026-11-15');
  items = load('semicolon_decimal_comma.csv').items; ok('semicolon delimiter + decimal comma + dd.mm.yyyy', items[0].amount === 112.45 && items[0].due === '2026-11-03' && items[1].amount === 1200, JSON.stringify(items[0]));
  const b = P.readFile(buf('bom_crlf_multiline.csv'), 'x.csv'); ok('BOM + CRLF + multiline quoted cell', b.sheets[0].rows.length === 3 && b.sheets[0].rows[1][3] === 'line one\r\nline two' && b.sheets[0].rows[0][0] === 'Name');
  ok('windows-1252 csv decoded', P.readFile(buf('latin1.csv'), 'x.csv').sheets[0].rows[1][0] === 'Caf\u00e9 loan');
  ok('tab separated', load('tab_separated.csv').items[0].amount === 80);
}
console.log('[xlsx variants]');
{
  const m = P.readFile(buf('multi_sheet.xlsx'), 'm.xlsx'); ok('hidden sheet skipped, two visible sheets returned', m.sheets.length === 2 && m.sheets[0].name === 'November');
  const l = P.readFile(buf('libreoffice_saved.xlsx'), 'l.xlsx'); ok('LibreOffice-written xlsx reads the same', l.sheets.length === 2 && l.sheets[0].rows[1][0] === 'Cable');
  const mac = load('mac1904.xlsx').items; ok('1904 date system', mac[0].due === '2026-12-05', mac[0].due);
  const i = load('inline_stored.xlsx').items; ok('inline strings + stored zip + XML entities', i[0].name === 'Tom & Jerry \u{1F600} insurance' && i[0].amount === 77.5 && i[0].due === '2026-11-14', JSON.stringify(i[0]));
}
console.log('[duplicates]');
{
  const { items } = load('duplicates.xlsx');
  ok('"Electric Bill" matches existing "Electric"', items[0].dup && !items[0].checked);
  ok('first "Brand New Thing" is new, second is flagged as repeated in file', !items[1].dup && items[2].dup && items[2].dup.inFile && /more than once/.test(items[2].dupWhy));
  ok('Rent at a different amount still flagged', items[3].dup && !items[3].checked);
  ok('normName ignores case/punctuation/filler', P.normName('The Netflix, Inc. bill') === 'netflix');
  ok('unrelated names are not flagged', !P.findDuplicate({ name: 'Water', amount: 40, due: '2026-11-05' }, EXIST.bills));
  ok('near-typo with a similar amount flagged', !!P.findDuplicate({ name: 'Electrc', amount: 120, due: '2026-11-03' }, EXIST.bills));
  ok('short names are not fuzzy-matched', !P.findDuplicate({ name: 'Gas', amount: 118, due: '2026-11-03' }, EXIST.bills));
  const d2 = P.buildItems(load('bills_typical.xlsx').rows, load('bills_typical.xlsx').an, { now: NOW, bills: [], income: EXIST.income }).items;
  ok('income compared against existing Income, not Bills', by(d2, 'Paycheck').dup && !by(d2, 'Rent').dup);
}
console.log('[bad and huge files]');
{
  ok('old .xls explained, not parsed', err('old_format.xls') && err('old_format.xls').code === 'xls' && /xlsx/.test(err('old_format.xls').message));
  ok('.ods explained', err('opendoc.ods') && err('opendoc.ods').code === 'type');
  ok('empty file', err('empty.csv').code === 'empty');
  ok('header only -> no usable rows', (() => { const r = P.readFile(buf('only_header.csv'), 'a.csv'); return P.buildItems(r.sheets[0].rows, P.analyze(r.sheets[0].rows, NOW), { now: NOW }).items.length === 0; })());
  ok('random bytes rejected', err('garbage.csv') && err('garbage.csv').code === 'type');
  ok('text renamed .xlsx rejected', !!err('notaspreadsheet.xlsx'));
  ok('truncated xlsx -> friendly error', err('truncated.xlsx') && /valid|damaged|cut off/.test(err('truncated.xlsx').message));
  ok('corrupted xlsx caught (CRC)', err('corrupt.xlsx') && /damaged|Bad|valid|cut/.test(err('corrupt.xlsx').message), String(err('corrupt.xlsx')));
  const bomb = err('bomb.xlsx'); ok('zip bomb refused (too large to read), no crash', bomb && bomb.code === 'toolarge');
  ok('file over 10 MB refused', (() => { try { P.readFile(new ArrayBuffer(11 * 1024 * 1024), 'a.csv'); } catch (e) { return e.code === 'toolarge'; } })());
  const t0 = Date.now(), h = load('huge_6000_rows.xlsx'); const dt = Date.now() - t0;
  ok('6000-row file: only first 5000 rows kept and flagged', h.items.length === 5000 && P.buildItems(h.rows, h.an, { now: NOW }).overflow === true);
  ok(`6000-row file parses fast (${dt} ms)`, dt < 4000);
  for (const [n, s] of [['null input', null], ['one cell', 'a'], ['all blank rows', ',,\n,,\n'], ['emoji only', '\u{1F600}\u{1F600}\n\u{1F600}']]) {
    let crashed = false; try { const r = P.readFile(new TextEncoder().encode(s || '').buffer, 'x.csv'); P.buildItems(r.sheets[0].rows, P.analyze(r.sheets[0].rows, NOW), { now: NOW }); } catch (e) { crashed = !e.code; }
    ok(`no crash: ${n}`, !crashed);
  }
}
console.log('[overwrite / keep mine]');
{
  const EX = { bills: [{ id: 'b-elec', name: 'Electric', amount: 118, due: '2026-10-03', recurring: true, recurrence: 'monthly', category: 'Utilities', notes: 'keep me', autopay: false }, { id: 'b-rent', name: 'Rent', amount: 1450, due: '2026-10-01', recurring: true, recurrence: 'monthly', category: 'Housing', notes: '', autopay: true }], income: EXIST.income };
  const r = P.readFile(buf('duplicates.xlsx'), 'duplicates.xlsx'), rows = r.sheets[0].rows, an = P.analyze(rows, NOW);
  const items = P.buildItems(rows, an, { now: NOW, ...EX }).items;
  const e = items[0];
  ok('matched bill carries the existing bill id', e.dup && e.dup.id === 'b-elec', JSON.stringify(e.dup));
  ok('matched bill can be overwritten and defaults to Keep mine, unticked', e.canOverwrite === true && e.dupAction === 'keep' && e.checked === false);
  ok('new row and in-file repeat cannot be overwritten', items[1].canOverwrite === false && items[2].canOverwrite === false && items[2].dup.inFile);
  const inc = by(P.buildItems(rows, an, { now: NOW, ...EX }).items, 'Paycheck');
  ok('income matches are not overwritable (bills only)', !inc || inc.canOverwrite === false);
  const o = P.overwriteChanges(e, EX.bills[0]);
  ok('changes list existing vs new (Amount 118 -> spreadsheet value)', o.changes.some((c) => c.key === 'amount' && c.from === '$118.00') && o.patch.amount === e.amount, JSON.stringify(o));
  ok('patch only has fields the file provides (no id/colour/notes/occ)', !('id' in o.patch) && !('color' in o.patch) && !('notes' in o.patch) && !('occ' in o.patch), JSON.stringify(o.patch));
  const same = P.overwriteChanges({ name: 'Electric', amount: 118, due: '2026-10-03', has: {} }, EX.bills[0]);
  ok('identical values give no changes', same.changes.length === 0 && Object.keys(same.patch).length === 0);
  const full = P.overwriteChanges({ name: 'Electric', amount: 120, due: '2026-10-05', fq: 'weekly', category: 'Housing', notes: 'new note', autopay: true, paid: true, has: { freq: true, category: true, notes: true, autopay: true, paid: true } }, EX.bills[0]);
  ok('freq/category/notes/autopay/paid applied when the file has those columns', full.patch.recurrence === 'weekly' && full.patch.recurring === true && full.patch.category === 'Housing' && full.patch.notes === 'new note' && full.patch.autopay === true && full.markPaid === true, JSON.stringify(full));
  const blank = P.overwriteChanges({ name: 'Electric', amount: 120, due: '2026-10-03', notes: '', category: '', has: { notes: true, category: true } }, EX.bills[0]);
  ok('blank notes/category cells never erase what the user has', !('notes' in blank.patch) && !('category' in blank.patch));
  const never = P.overwriteChanges({ name: 'Rent', amount: 1450, due: '2026-10-01', fq: 'never', has: { freq: true } }, EX.bills[1]);
  ok('"Never" turns recurring off', never.patch.recurring === false);
  e.dupAction = 'overwrite'; P.refreshItems(items, EX);
  ok('Overwrite choice survives a refresh while it still matches', e.dupAction === 'overwrite');
  e.name = 'Totally Unrelated Zebra'; P.refreshItems(items, EX);
  ok('no longer matching resets to Keep mine / not overwritable', e.canOverwrite === false && e.dupAction === 'keep');
}
console.log('[helpers]');
{
  const a = P.parseAmount;
  ok('amounts', a('$1,234.56') === 1234.56 && a('1.234,56') === 1234.56 && a('12,50') === 12.5 && a('1,234') === 1234 && a(' 45 ') === 45 && a('USD 5.5') === 5.5 && isNaN(a('abc')) && isNaN(a('')) && isNaN(a('1.2.3')) && a(0.1 + 0.2) === 0.3);
  const d = (v) => P.parseDate(v, NOW);
  ok('dates', d('2026-1-5').iso === '2026-01-05' && d('15th').day === 15 && d('Nov 3').iso === '2026-11-03' && d('31/12/2026').iso === '2026-12-31' && d('44500').iso === '2021-10-31' && d('').iso === undefined && d('soon').bad && d('2/30/2026').bad && d(0).bad === true);
  ok('day to date rolls into next month when already past, clamps to month end', P.dayToISO(5, NOW) === '2026-11-05' && P.dayToISO(31, new Date(2026, 1, 1)) === '2026-02-28');
  ok('frequency words', P.parseFreq('Bi-Weekly').v === 'biweekly' && P.parseFreq('every month').v === 'monthly' && P.parseFreq('Once').v === 'never' && P.parseFreq('twice a month').v === 'semimonthly' && P.parseFreq('Quarterly').v === 'never' && P.parseFreq('???') === null);
  ok('paid words', ['Yes', 'x', 'Paid', 'TRUE', '\u2713', 'Done'].every((w) => P.parsePaid(w)) && ['No', 'Unpaid', '', 'pending', 'false', 'not paid'].every((w) => !P.parsePaid(w)));
}
console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
