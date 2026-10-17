/* Import from spreadsheet (.xlsx / .csv). The file is read on this device only: nothing is uploaded.
   Rows go through the same api.bills.save / api.income.save the Add forms use, so sync works both ways. */
import './import-core.js';
import { h, icon, money, uuid, isISO } from './util.js';
import { openLayer, toast } from './ui.js';
import { api } from './api.js';
import { REPEATS, INCOME_FREQ } from './calc.js';
import { categoryOptions } from './forms.js';

const PAI = () => globalThis.PAImport;
const BILL_COLOR = '#3ddc97';
const ROLE_LABEL = { name: 'Name', amount: 'Amount', due: 'Due date or day', freq: 'How often it repeats', category: 'Category', paid: 'Paid?', notes: 'Notes', autopay: 'Autopay' };
const ROLE_ORDER = ['name', 'amount', 'due', 'freq', 'category', 'paid', 'notes', 'autopay'];
const colName = (i) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHUNK = 200;

export function openImport() {
  const P = PAI();
  const S = { file: null, sheets: [], sheetIdx: 0, an: null, items: [], rows: [], overflow: false, truncated: false, shown: CHUNK, step: 'pick', busy: false };
  const body = h('div', { class: 'sheet-b imp-b' }), foot = h('footer', { class: 'sheet-f' });
  const title = h('h2', { id: 'imp-t', text: 'Import from spreadsheet' }), sub = h('p', { text: 'Bring in bills you tracked in Excel or a CSV file.' });
  const sheet = h('section', { class: 'sheet wide imp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'imp-t', 'data-import': '' },
    h('header', { class: 'sheet-h' }, h('div', null, title, sub), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => entry.close() }, icon('x'))), body, foot);
  const entry = openLayer('sheet', sheet, { initialFocus: () => sheet.querySelector('input[type=file]') || sheet.querySelector('.btn') });
  const existing = () => ({ bills: api.bills.list(), income: api.income.list() });
  const setFoot = (...kids) => foot.replaceChildren(...kids.flat().filter(Boolean));
  const setBody = (...kids) => body.replaceChildren(...kids.flat().filter(Boolean));
  const btn = (label, cls, fn, extra) => h('button', Object.assign({ class: 'btn ' + cls, type: 'button', onclick: fn }, extra || {}), h('span', { text: label }));

  /* ---------------------------------------------------------------- step 1: pick */
  function stepPick(errMsg) {
    S.step = 'pick'; title.textContent = 'Import from spreadsheet'; sub.textContent = 'Bring in bills you tracked in Excel or a CSV file.';
    const input = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data-import-file': '', class: 'imp-file', 'aria-label': 'Choose a spreadsheet file' });
    input.addEventListener('change', () => { if (input.files && input.files[0]) loadFile(input.files[0]); });
    const drop = h('label', { class: 'imp-drop' }, input, icon('doc', 'ic big'), h('b', { text: 'Choose an Excel or CSV file' }), h('span', { text: 'or drop it here' }), h('small', { text: '.xlsx and .csv files work' }));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f); });
    const err = h('p', { class: 'err form-err', role: 'alert', 'data-import-error': '', hidden: !errMsg }, icon('alert', 'ic sm'), h('span', { text: errMsg || '' }));
    setBody(drop, err,
      h('div', { class: 'imp-priv' }, icon('lock', 'ic sm'), h('span', { text: 'Your file is read on this device only. Nothing is uploaded.' })),
      h('div', { class: 'imp-how' }, h('b', { text: 'What happens next' }), h('ol', null, h('li', { text: 'We read every row and guess which column is which.' }), h('li', { text: 'You see a list. Tick the rows you want, pick Bills, Income or Skip, and fix anything.' }), h('li', { text: 'Only the rows you tick are added. Ones that look like bills you already have are left unticked.' }))),
      h('details', { class: 'imp-tips' }, h('summary', { text: 'What should my spreadsheet look like?' }), h('p', { text: 'One row per bill, with column titles like Name, Amount, Due date, Frequency, Category and Paid. Only a name and an amount are needed. Older .xls files: open them in Excel and Save As .xlsx or CSV first.' })));
    setFoot(h('span', { class: 'sp' }), btn('Cancel', 'ghost', () => entry.close()));
  }

  async function loadFile(file) {
    const errEl = () => body.querySelector('[data-import-error]');
    const fail = (m) => { const e = errEl(); if (e) { e.hidden = false; e.querySelector('span').textContent = m; } else stepPick(m); };
    if (file.size > P.LIMITS.maxFileBytes) return fail('That file is bigger than 10 MB. Save only your bills into a smaller file and try again.');
    body.setAttribute('aria-busy', 'true');
    try {
      const buf = await file.arrayBuffer(); await sleep(0);
      const r = P.readFile(buf, file.name);
      S.file = file.name; S.sheets = r.sheets; S.truncated = r.truncated; S.sheetIdx = 0;
      pickSheet(0); body.removeAttribute('aria-busy');
      if (S.an.sure) stepPreview(); else stepMap();
    } catch (e) { body.removeAttribute('aria-busy'); fail(e && e.code ? e.message : 'We could not read that file. Please choose an .xlsx or .csv file.'); if (!(e && e.code)) console.error(e); }
  }
  function pickSheet(i) {
    S.sheetIdx = i; S.rows = S.sheets[i].rows; S.an = P.analyze(S.rows);
    S.headerOn = S.an.headerRow >= 0; S.detHdr = S.an.headerRow;
    rebuild();
  }
  function rebuild() { const r = P.buildItems(S.rows, S.an, { bills: existing().bills, income: existing().income, categories: categoryOptions() }); S.items = r.items; S.overflow = r.overflow; S.shown = CHUNK; }

  /* ---------------------------------------------------------------- step 2: map columns */
  function stepMap() {
    S.step = 'map'; title.textContent = 'Match your columns'; sub.textContent = 'We were not sure which column is which. Check these, then continue.';
    const an = S.an, from = an.headerRow + 1, width = an.width;
    const sample = (c) => { const out = []; for (let i = from; i < S.rows.length && out.length < 2; i++) { const v = S.rows[i][c]; const t = v && v.d ? v.d : String(v == null ? '' : v); if (t) out.push(t.slice(0, 18)); } return out.join(', '); };
    const opts = (role) => [h('option', { value: '', text: role === 'name' || role === 'amount' ? 'Choose a column' : 'Not in my file' })].concat(Array.from({ length: width }, (_, c) => {
      const head = an.headerRow >= 0 ? String(an.heads[c] || '').slice(0, 24) : '';
      return h('option', { value: String(c), selected: an.mapping[role] === c, text: `${colName(c)}${head ? ' \u00b7 ' + head : ''}${sample(c) ? ' (' + sample(c) + ')' : ''}` });
    }));
    const selects = {};
    const rowsEl = ROLE_ORDER.map((role) => {
      const sel = h('select', { 'data-map': role, id: 'map-' + role, 'aria-label': ROLE_LABEL[role] }, opts(role)); selects[role] = sel;
      sel.addEventListener('change', () => { const v = sel.value === '' ? null : Number(sel.value); if (v == null) delete S.an.mapping[role]; else { for (const r2 of ROLE_ORDER) if (r2 !== role && S.an.mapping[r2] === v) { delete S.an.mapping[r2]; selects[r2].value = ''; } S.an.mapping[role] = v; } check(); });
      return h('div', { class: 'fld imp-map' }, h('label', { for: 'map-' + role }, ROLE_LABEL[role], (role === 'name' || role === 'amount') ? h('em', { text: ' (needed)' }) : null), h('div', { class: 'inp' }, sel, icon('chevd', 'ic sm')));
    });
    const hdrChk = h('input', { type: 'checkbox', checked: S.headerOn, 'data-map-header': '' });
    hdrChk.addEventListener('change', () => { S.headerOn = hdrChk.checked; const hr = S.headerOn ? Math.max(S.detHdr, 0) : -1; S.an.headerRow = hr; S.an.heads = Array.from({ length: S.an.width }, (_, c) => { const v = hr >= 0 ? (S.rows[hr] || [])[c] : ''; return v && v.d ? v.d : String(v == null ? '' : v); }); stepMap(); });
    const sheetPick = S.sheets.length > 1 ? sheetSelect(() => stepMap()) : null;
    const next = btn('Continue', 'primary', () => { rebuild(); stepPreview(); }, { 'data-map-continue': '' });
    const check = () => { next.disabled = S.an.mapping.name == null || S.an.mapping.amount == null; };
    setBody(sheetPick, h('label', { class: 'imp-hdr' }, hdrChk, h('span', { text: 'The first row of my file has column titles' })), rowsEl);
    check();
    setFoot(btn('Back', 'ghost', () => stepPick()), h('span', { class: 'sp' }), next);
  }
  function sheetSelect(onChange) {
    const sel = h('select', { 'data-import-sheet': '', 'aria-label': 'Sheet' }, S.sheets.map((s, i) => h('option', { value: String(i), selected: i === S.sheetIdx, text: `${s.name} (${s.rows.length} rows)` })));
    sel.addEventListener('change', () => { pickSheet(Number(sel.value)); if (S.an.sure || S.step === 'preview') stepPreview(); else onChange(); });
    return h('div', { class: 'fld imp-sheet' }, h('label', { text: 'Sheet to import' }), h('div', { class: 'inp' }, sel, icon('chevd', 'ic sm')));
  }

  /* ---------------------------------------------------------------- step 3: preview */
  const DESTS = [['bills', 'Bills'], ['income', 'Income'], ['skip', 'Skip']];
  const repeatOpts = (dest) => (dest === 'income' ? INCOME_FREQ : REPEATS);
  const fixFreq = (it) => { const ok = repeatOpts(it.dest).some((r) => r.v === it.fq); if (!ok) it.fq = it.dest === 'income' ? (it.fq === 'never' ? 'one-time' : 'monthly') : (it.fq === 'one-time' ? 'never' : 'monthly'); };
  const isUpd = (it) => !!it.canOverwrite && it.dup && !it.dup.inFile && it.dest === 'bills';
  const syncDups = () => S.items.forEach((i) => { if (isUpd(i)) { i.checked = i.dupAction === 'overwrite'; i._upd = true; } else { if (i._upd) { i.checked = false; i._upd = false; } if (i.dupAction === 'overwrite') i.dupAction = 'keep'; } });
  const existingRec = (it) => it.dup && api.bills.list().find((b) => b.id === it.dup.id);
  function counts() { const c = { bills: 0, income: 0, upd: 0, sel: 0 }; S.items.forEach((it) => { if (it.checked && it.dest !== 'skip') { c.sel++; if (isUpd(it)) c.upd++; else c[it.dest]++; } }); return c; }
  function stepPreview() {
    S.step = 'preview'; title.textContent = 'Choose what to bring in'; sub.textContent = S.file + (S.sheets.length > 1 ? ' \u00b7 ' + S.sheets[S.sheetIdx].name : '');
    const cats = categoryOptions();
    const summary = h('p', { class: 'imp-sum', 'data-import-summary': '', role: 'status' });
    const addBtn = btn('Add', 'primary', doAdd, { 'data-import-add': '' });
    const msg = h('p', { class: 'err form-err', role: 'alert', 'data-import-msg': '', hidden: true }, icon('alert', 'ic sm'), h('span'));
    const list = h('div', { class: 'imp-list', 'data-import-list': '' });
    const more = btn('', 'ghost wide', () => { S.shown += CHUNK; paintRows(); }, { 'data-import-more': '' });
    const paintSummary = () => {
      const c = counts(), dups = S.items.filter((i) => i.dup).length, bad = S.items.filter((i) => i.checked && i.dest !== 'skip' && i.errors.length).length;
      summary.textContent = `${S.items.length} row${S.items.length === 1 ? '' : 's'} read \u00b7 ${c.sel} selected` + (dups ? ` \u00b7 ${dups} look like ones you already have` : '') + (c.upd ? ` \u00b7 ${c.upd} will overwrite` : '') + (bad ? ` \u00b7 ${bad} need fixing` : '');
      const parts = []; if (c.bills) parts.push(`${c.bills} bill${c.bills === 1 ? '' : 's'}`); if (c.income) parts.push(`${c.income} income`);
      addBtn.firstChild.textContent = c.sel ? (parts.length ? `Add ${parts.join(' and ')}` : '') + (c.upd ? `${parts.length ? ', ' : ''}Overwrite ${c.upd}` : '') : 'Nothing selected'; addBtn.disabled = !c.sel;
    };
    const refresh = () => { P.refreshItems(S.items, existing()); syncDups(); };
    function paintRow(it, node) {
      const errs = it.dest === 'skip' ? [] : it.errors;
      node.classList.toggle('is-skip', it.dest === 'skip'); node.classList.toggle('is-dup', !!it.dup); node.classList.remove('is-upd'); node.classList.toggle('is-bad', !!errs.length && it.checked);
      node.querySelector('[data-r=chk]').checked = it.checked;
      const flag = node.querySelector('[data-r=flag]'); flag.replaceChildren();
      if (isUpd(it)) {
        it.checked = it.dupAction === 'overwrite'; it._upd = true; node.querySelector('[data-r=chk]').checked = it.checked; node.classList.add('is-upd');
        flag.append(h('span', { class: 'tag warn', 'data-dup': '', text: 'Already in Bills' }), h('small', { text: it.dupWhy }));
        const act = h('div', { class: 'imp-act', role: 'group', 'aria-label': 'If this bill already exists' },
          [['keep', 'Keep mine'], ['overwrite', 'Overwrite']].map(([v, l]) => h('button', { type: 'button', class: 'imp-seg' + (it.dupAction === v ? ' on' : ''), 'data-r': 'act-' + v, 'aria-pressed': String(it.dupAction === v), text: l,
            onclick: () => { it.dupAction = v; it.checked = v === 'overwrite'; paintRow(it, node); paintSummary(); } })));
        const rec = existingRec(it), ch = rec ? P.overwriteChanges(it, rec).changes : [];
        const diff = h('div', { class: 'imp-diff', 'data-r': 'diff' }, h('b', { text: it.dupAction === 'overwrite' ? 'Overwrite will change:' : 'Your bill stays as is. Overwrite would change:' }),
          ch.length ? ch.map((c) => h('div', { class: 'imp-drow' }, h('span', { text: c.label }), c.key === 'paid' ? h('span', { class: 'to', text: c.to }) : h('span', { class: 'from', text: c.from }), c.key === 'paid' ? null : h('span', { class: 'arr', text: '\u2192' }), c.key === 'paid' ? null : h('span', { class: 'to', text: c.to })))
            : h('div', { class: 'imp-drow', text: 'Same values as yours. Nothing would change.' }));
        flag.append(act, diff);
      } else if (it.dup) flag.append(h('span', { class: 'tag warn', 'data-dup': '', text: it.dup.inFile ? 'Repeated in file' : 'Possible duplicate' }), h('small', { text: it.dupWhy }));
      if (errs.length) flag.append(h('span', { class: 'tag bad', 'data-needs': '', text: 'Needs: ' + errs.map((e) => ({ name: 'a name', amount: 'an amount', due: 'a due date' }[e])).join(', ') }));
      if (it.note) flag.append(h('small', { text: it.note }));
      ['name', 'amount', 'due'].forEach((k) => { const el = node.querySelector(`[data-r=${k}]`); const bad = errs.includes(k) && it.checked; el.classList.toggle('invalid', bad); if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); });
      node.querySelector('[data-r=cat]').hidden = it.dest !== 'bills';
    }
    function buildRow(it) {
      const node = h('div', { class: 'imp-row', 'data-row': String(it.row) });
      const chk = h('input', { type: 'checkbox', 'data-r': 'chk', 'aria-label': 'Import ' + (it.name || 'row ' + it.row), checked: it.checked });
      chk.addEventListener('change', () => { it.checked = chk.checked; if (isUpd(it)) it.dupAction = it.checked ? 'overwrite' : 'keep'; paintRow(it, node); paintSummary(); });
      const name = h('input', { type: 'text', 'data-r': 'name', maxlength: 80, value: it.name, placeholder: 'Name', 'aria-label': 'Name' });
      const amount = h('input', { type: 'text', inputmode: 'decimal', 'data-r': 'amount', value: it.amount === '' ? '' : String(it.amount), placeholder: '0.00', 'aria-label': 'Amount' });
      const due = h('input', { type: 'date', 'data-r': 'due', value: isISO(it.due) ? it.due : '', 'aria-label': 'Due date' });
      const dest = h('select', { 'data-r': 'dest', 'aria-label': 'Add to' }, DESTS.map(([v, l]) => h('option', { value: v, selected: it.dest === v, text: l })));
      const rep = h('select', { 'data-r': 'rep', 'aria-label': 'Repeats' });
      const fillRep = () => { fixFreq(it); rep.replaceChildren(...repeatOpts(it.dest).map((r) => h('option', { value: r.v, selected: it.fq === r.v, text: r.label }))); rep.hidden = it.dest === 'skip'; };
      const cat = h('select', { 'data-r': 'cat', 'aria-label': 'Category' }, (cats.includes(it.category) || !it.category ? cats : cats.concat([it.category])).map((c) => h('option', { value: c, selected: it.category === c, text: c })));
      const reflag = () => { refresh(); S.items.forEach((x) => { const n = list.querySelector(`[data-row="${x.row}"]`); if (n) paintRow(x, n); }); paintSummary(); };
      name.addEventListener('input', () => { it.name = name.value.trim().slice(0, 80); chk.setAttribute('aria-label', 'Import ' + (it.name || 'row ' + it.row)); reflag(); });
      amount.addEventListener('input', () => { const a = P.parseAmount(amount.value); it.amount = isFinite(a) ? a : ''; reflag(); });
      due.addEventListener('input', () => { it.due = due.value; reflag(); });
      rep.addEventListener('change', () => { it.fq = rep.value; });
      cat.addEventListener('change', () => { it.category = cat.value; });
      dest.addEventListener('change', () => { const was = it.dest; it.dest = dest.value; fillRep(); if (it.dest === 'skip') it.checked = false; else if (was === 'skip') { refresh(); it.checked = !it.dup && !it.errors.length; } reflag(); chk.checked = it.checked; });
      fillRep();
      node.append(h('label', { class: 'imp-chk' }, chk), h('div', { class: 'imp-fields' }, name, amount, due, dest, rep, cat), h('div', { class: 'imp-flag', 'data-r': 'flag' }));
      paintRow(it, node); return node;
    }
    function paintRows() {
      list.replaceChildren(...S.items.slice(0, S.shown).map(buildRow));
      const left = S.items.length - S.shown; more.hidden = left <= 0; more.firstChild.textContent = `Show ${Math.min(CHUNK, left)} more of ${left} remaining rows`; paintSummary();
    }
    const tools = h('div', { class: 'imp-tools' },
      btn('Select all', 'ghost sm', () => { S.items.forEach((i) => { if (i.dest !== 'skip' && !isUpd(i)) i.checked = true; }); paintRows(); }, { 'data-import-all': '' }),
      btn('Select none', 'ghost sm', () => { S.items.forEach((i) => { i.checked = false; i.dupAction = 'keep'; }); paintRows(); }, { 'data-import-none': '' }),
      btn('Change columns', 'ghost sm', () => stepMap(), { 'data-import-cols': '' }));
    const nUpd = S.items.filter(isUpd).length;
    if (nUpd) tools.append(btn(`Overwrite all duplicates (${nUpd})`, 'ghost sm', () => { S.items.forEach((i) => { if (isUpd(i)) { i.dupAction = 'overwrite'; i.checked = true; } }); paintRows(); }, { 'data-import-overwrite-all': '' }),
      btn('Keep all mine', 'ghost sm', () => { S.items.forEach((i) => { if (isUpd(i)) { i.dupAction = 'keep'; i.checked = false; } }); paintRows(); }, { 'data-import-keep-all': '' }));
    const notes = [];
    if (S.overflow) notes.push(`Only the first ${P.LIMITS.maxRows.toLocaleString()} rows are shown. Split a bigger file to bring in the rest.`);
    if (S.truncated) notes.push('This file is very long, so we stopped reading it partway.');
    const info = h('p', { class: 'imp-hint' }, nUpd ? 'Bills you already have are kept as you entered them. Choose Overwrite on a row to update that bill with the spreadsheet values (nothing new is added, and its paid history stays).' : 'Rows that look like bills you already have are not ticked. Tick them if you want them anyway.');
    if (!S.items.length) { setBody(h('div', { class: 'empty-s' }, icon('search'), h('b', { text: 'No bill rows found' }), h('p', { text: 'We could not find any rows under the column titles. Check the file, or change which columns we read.' }))); setFoot(btn('Choose another file', 'ghost', () => stepPick()), btn('Change columns', 'ghost', () => stepMap()), h('span', { class: 'sp' })); return; }
    setBody(S.sheets.length > 1 ? sheetSelect(() => stepPreview()) : null, summary, notes.map((n) => h('p', { class: 'imp-hint warn', text: n })), tools, info, list, more, msg);
    paintRows();
    setFoot(btn('Back', 'ghost', () => stepPick()), h('span', { class: 'sp' }), addBtn);

    async function doAdd() {
      const chosen = S.items.filter((i) => i.checked && i.dest !== 'skip'), bad = chosen.filter((i) => i.errors.length);
      if (bad.length) {
        msg.hidden = false; msg.querySelector('span').textContent = `${bad.length} selected row${bad.length === 1 ? ' needs' : 's need'} a fix first. Fill in what is highlighted, or untick the row.`;
        const idx = S.items.indexOf(bad[0]); if (idx >= S.shown) { S.shown = idx + 1; paintRows(); }
        const n = list.querySelector(`[data-row="${bad[0].row}"]`); if (n) { n.scrollIntoView({ block: 'center' }); const f = n.querySelector('.invalid'); f && f.focus(); } return;
      }
      msg.hidden = true; addBtn.disabled = true; addBtn.firstChild.textContent = 'Adding\u2026';
      let rejected = 0; const off = api.subscribe((ev) => { if (ev.type === 'rejected') rejected++; });
      let nb = 0, ni = 0, nu = 0, failed = 0, same = 0; const kept = S.items.filter((i) => isUpd(i) && i.dupAction !== 'overwrite').length;
      try {
        for (const it of chosen) {
          try {
            if (isUpd(it)) {
              const rec = existingRec(it);
              if (!rec) { api.bills.save(billFrom(it)); nb++; } else { const r = updateFrom(it, rec); if (r) { api.bills.save(r); nu++; } else same++; }
            } else if (it.dest === 'bills') { api.bills.save(billFrom(it)); nb++; } else { api.income.save(incomeFrom(it)); ni++; }
          } catch (e) { failed++; console.error(e); }
          if ((nb + ni + nu) % 50 === 0) await sleep(0);
        }
        for (let t = 0; t < 120; t++) { const st = api.status; if (!st.pending && st.status !== 'busy') break; await sleep(150); }
      } finally { off(); }
      const st = api.status, synced = !st.pending && st.status === 'ok';
      stepResult({ nb, ni, nu, same, kept, failed: failed + rejected, skipped: S.items.length - chosen.length - kept, synced, queued: st.pending > 0 });
      toast(synced ? 'Imported. Synced to your phone.' : 'Imported. Will sync when you are back online.', 'ok');
    }
  }
  function billFrom(it) {
    const recur = it.fq !== 'never' && it.fq !== 'one-time', occ = {};
    if (it.paid) occ[it.due] = { paid: it.amount };
    return { id: api.bills.newId(), name: it.name.slice(0, 80), amount: it.amount, due: it.due, recurring: recur, recurrence: recur ? it.fq : 'weekly', color: BILL_COLOR, category: it.category || 'Other', notes: it.notes || '', autopay: !!it.autopay, catFromMap: false, occ, paid: !recur && !!it.paid };
  }
  /* overwrite = the normal edit path (api.bills.save with the SAME id): keeps id, paid history, colour and anything the file does not provide */
  function updateFrom(it, rec) {
    const o = P.overwriteChanges(it, rec); if (!o.changes.length) return null;
    const bill = Object.assign({}, rec, o.patch), due = bill.due;
    if (o.markPaid) { bill.occ = Object.assign({}, rec.occ || {}); bill.occ[due] = Object.assign({}, bill.occ[due] || {}, { paid: bill.amount }); if (!bill.recurring) bill.paid = true; }
    return bill;
  }
  function incomeFrom(it) { return { id: uuid(), name: it.name.slice(0, 80), amount: it.amount, date: it.due, frequency: it.fq === 'never' ? 'one-time' : it.fq }; }

  /* ---------------------------------------------------------------- step 4: result */
  function stepResult(r) {
    S.step = 'result'; title.textContent = 'Import finished'; sub.textContent = S.file;
    const parts = []; if (r.nb) parts.push(`${r.nb} bill${r.nb === 1 ? '' : 's'}`); if (r.ni) parts.push(`${r.ni} income item${r.ni === 1 ? '' : 's'}`);
    setBody(h('div', { class: 'imp-done', 'data-import-result': '' }, h('span', { class: 'dlg-i' }, icon('check')), h('h3', { text: (parts.length || r.nu) ? [parts.length ? 'Added ' + parts.join(' and ') : '', r.nu ? (parts.length ? 'updated ' : 'Updated ') + `${r.nu} existing bill${r.nu === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') : 'Nothing was added' }),
      h('p', { text: r.queued ? 'Saved on this device. They will sync to your phone when you are back online.' : 'They are saved and synced, so they also show in the phone app.' }),
      h('ul', { class: 'imp-stats' }, h('li', { text: `${r.skipped} row${r.skipped === 1 ? '' : 's'} left out` }), r.kept ? h('li', { text: `${r.kept} of your bills kept as you entered them` }) : null, r.same ? h('li', { text: `${r.same} already matched, so nothing changed` }) : null, r.failed ? h('li', { class: 'neg', text: `${r.failed} could not be saved` }) : null)));
    setFoot(btn('Import another file', 'ghost', () => stepPick()), h('span', { class: 'sp' }), btn('View bills', 'primary', () => { entry.close(); if (!/bills\.html$/.test(location.pathname)) location.href = 'bills.html'; }, { 'data-import-done': '' }));
  }

  stepPick();
  return entry;
}
