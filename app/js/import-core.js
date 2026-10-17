/* PayAviator spreadsheet import: pure parsing + matching logic, no DOM, no network.
   Reads .xlsx / .csv entirely on this device (own tiny zip + inflate reader, nothing is uploaded).
   Shared byte-for-byte by the web app and the Android app (exposes globalThis.PAImport). */
(function (root) {
  'use strict';
  var LIMITS = { maxFileBytes: 10 * 1024 * 1024, maxEntryBytes: 80 * 1024 * 1024, maxRows: 5000, maxCols: 60, maxScanRows: 20000 };
  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }

  /* ------------------------------------------------------------ inflate (RFC 1951) */
  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258], LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577], DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  function huff(lengths, n) {
    var count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n), i;
    for (i = 0; i < n; i++) count[lengths[i]]++;
    count[0] = 0; offs[1] = 0;
    for (i = 1; i < 15; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
    return { count: count, symbol: symbol };
  }
  var FIXED_L, FIXED_D;
  function inflate(src, start, end, maxOut) {
    var pos = start, bitbuf = 0, bitcnt = 0, out = new Uint8Array(Math.min(Math.max(4096, (end - start) * 4), maxOut)), op = 0;
    function bits(n) {
      var v = bitbuf;
      while (bitcnt < n) { if (pos >= end) throw fail('bad', 'Unexpected end of compressed data'); v |= src[pos++] << bitcnt; bitcnt += 8; }
      bitbuf = v >>> n; bitcnt -= n; return v & ((1 << n) - 1);
    }
    function decode(h) {
      var code = 0, first = 0, index = 0, len, c;
      for (len = 1; len <= 15; len++) {
        code |= bits(1); c = h.count[len];
        if (code - c < first) return h.symbol[index + (code - first)];
        index += c; first += c; first <<= 1; code <<= 1;
      }
      throw fail('bad', 'Bad compressed data');
    }
    function put(b) {
      if (op >= out.length) { if (out.length >= maxOut) throw fail('toolarge', 'This file expands to more data than we can safely read.'); var n = new Uint8Array(Math.min(out.length * 2, maxOut)); n.set(out); out = n; }
      out[op++] = b;
    }
    var last, type, i;
    do {
      last = bits(1); type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > end) throw fail('bad', 'Bad compressed data');
        var len = src[pos] | (src[pos + 1] << 8); pos += 4;
        if (pos + len > end) throw fail('bad', 'Bad compressed data');
        for (i = 0; i < len; i++) put(src[pos++]);
      } else if (type === 1 || type === 2) {
        var lh, dh;
        if (type === 1) {
          if (!FIXED_L) { var l = new Uint8Array(288); for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8; FIXED_L = huff(l, 288); var d = new Uint8Array(30); d.fill(5); FIXED_D = huff(d, 30); }
          lh = FIXED_L; dh = FIXED_D;
        } else {
          var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15], lengths = new Uint8Array(320);
          for (i = 0; i < ncode; i++) lengths[order[i]] = bits(3);
          var ch = huff(lengths, 19); lengths = new Uint8Array(320); i = 0;
          while (i < nlen + ndist) {
            var sym = decode(ch);
            if (sym < 16) lengths[i++] = sym;
            else {
              var prev = 0, rep;
              if (sym === 16) { if (!i) throw fail('bad', 'Bad compressed data'); prev = lengths[i - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
              if (i + rep > nlen + ndist) throw fail('bad', 'Bad compressed data');
              while (rep--) lengths[i++] = prev;
            }
          }
          lh = huff(lengths.subarray(0, nlen), nlen); dh = huff(lengths.subarray(nlen, nlen + ndist), ndist);
        }
        for (;;) {
          var s = decode(lh);
          if (s < 256) put(s);
          else if (s === 256) break;
          else {
            s -= 257; if (s >= 29) throw fail('bad', 'Bad compressed data');
            var ln = LBASE[s] + bits(LEXT[s]), ds = decode(dh); if (ds >= 30) throw fail('bad', 'Bad compressed data');
            var dist = DBASE[ds] + bits(DEXT[ds]);
            if (dist > op) throw fail('bad', 'Bad compressed data');
            while (ln--) put(out[op - dist]);
          }
        }
      } else throw fail('bad', 'Bad compressed data');
    } while (!last);
    return out.subarray(0, op);
  }

  /* ------------------------------------------------------------ zip */
  function zipEntries(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), i, eocd = -1;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw fail('bad', 'This does not look like a valid .xlsx file.');
    var total = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true), p = cdOff, map = {}, n;
    if (total === 0xffff || cdOff === 0xffffffff) throw fail('bad', 'This .xlsx file is in an unsupported format.');
    for (n = 0; n < total; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw fail('bad', 'This does not look like a valid .xlsx file.');
      var flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      var name = ''; for (i = 0; i < nl; i++) name += String.fromCharCode(u8[p + 46 + i]);
      map[name.replace(/^\/+/, '')] = { flags: flags, crc: dv.getUint32(p + 16, true), method: method, csize: csize, usize: usize, lho: lho };
      p += 46 + nl + el + cl;
    }
    return map;
  }
  var CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var crc = 0xffffffff; for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function utf8(u8) { return new TextDecoder('utf-8').decode(u8); }
  function zipRead(u8, ent) {
    if (!ent) return null;
    if (ent.flags & 1) throw fail('encrypted', 'This file is password protected. Remove the password in Excel, save it, and try again.');
    if (ent.usize > LIMITS.maxEntryBytes) throw fail('toolarge', 'This spreadsheet is too large to read here. Try saving just the bills as a smaller file.');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), p = ent.lho;
    if (p + 30 > u8.length || dv.getUint32(p, true) !== 0x04034b50) throw fail('bad', 'This does not look like a valid .xlsx file.');
    var start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true), end = start + ent.csize;
    if (end > u8.length) throw fail('bad', 'This file looks cut off or damaged.');
    var data;
    if (ent.method === 0) data = u8.subarray(start, end);
    else if (ent.method === 8) data = inflate(u8, start, end, LIMITS.maxEntryBytes);
    else throw fail('bad', 'This .xlsx file uses an unsupported compression.');
    if ((ent.flags & 8) === 0 && crc32(data) !== ent.crc) throw fail('bad', 'This file looks damaged. Try re-saving it from Excel.');
    return data;
    throw fail('bad', 'This .xlsx file uses an unsupported compression.');
  }

  /* ------------------------------------------------------------ xml helpers (regex based, no DOM, entities decoded by us) */
  function unXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'";
      var cp = g.charAt(1) === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      try { return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; } catch (_) { return ''; }
    });
  }
  function attr(s, name) { var m = new RegExp('(?:^|[\\s])' + name + '="([^"]*)"').exec(s); return m ? unXml(m[1]) : null; }
  function textRuns(x) {
    x = x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
    var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m;
    while ((m = re.exec(x))) out += m[1];
    return unXml(out);
  }
  function sharedStrings(xml) {
    var list = [], re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, m;
    if (!xml) return list;
    while ((m = re.exec(xml))) list.push(m[1] ? textRuns(m[1]) : '');
    return list;
  }
  var BUILTIN_DATE = {}; [14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58].forEach(function (i) { BUILTIN_DATE[i] = 1; });
  function isDateFormat(code) {
    var c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '').replace(/\*./g, '');
    return /[dmyhs]/i.test(c) && !/^general$/i.test(c);
  }
  function dateStyles(xml) {
    var res = [], custom = {}, m;
    if (!xml) return res;
    var re = /<numFmt\b([^>]*)\/?>/g;
    while ((m = re.exec(xml))) custom[attr(m[1], 'numFmtId')] = attr(m[1], 'formatCode');
    var cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!cx) return res;
    var xr = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
    while ((m = xr.exec(cx[1]))) {
      var id = attr(m[1], 'numFmtId');
      res.push(!!(BUILTIN_DATE[id] || (custom[id] != null && isDateFormat(custom[id]))));
    }
    return res;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function serialToISO(n, is1904) {
    if (!(n >= 1 && n < 2958466)) return '';
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000 + (is1904 ? 1462 * 86400000 : 0));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function colIndex(ref) { var m = /^([A-Z]+)/.exec(ref), n = 0, i; if (!m) return -1; for (i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n - 1; }
  function parseSheet(xml, shared, dstyle, is1904) {
    var rows = [], re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m, seq = 0, rowCount = 0, lastRow = -1, truncated = false;
    while ((m = re.exec(xml))) {
      var a = m[1], ref = attr(a, 'r'), ci, ri;
      if (ref) { ci = colIndex(ref); var rn = /(\d+)$/.exec(ref); ri = rn ? parseInt(rn[1], 10) - 1 : lastRow; } else { ci = seq; ri = lastRow < 0 ? 0 : lastRow; }
      seq = ci + 1; lastRow = ri;
      if (ri >= LIMITS.maxScanRows) { truncated = true; break; }
      if (ci < 0 || ci >= LIMITS.maxCols || !m[2]) continue;
      var t = attr(a, 't'), s = attr(a, 's'), body = m[2], vm = /<v>([\s\S]*?)<\/v>/.exec(body), v = vm ? unXml(vm[1]) : '', val = '';
      if (t === 's') val = shared[parseInt(v, 10)] || '';
      else if (t === 'inlineStr') val = textRuns(body);
      else if (t === 'str') val = v;
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'e') val = '';
      else if (t === 'd') val = /^\d{4}-\d{2}-\d{2}/.test(v) ? { d: v.slice(0, 10) } : v;
      else if (v !== '') {
        var num = Number(v);
        if (!isFinite(num)) val = v;
        else if (s != null && dstyle[parseInt(s, 10)]) { var iso = serialToISO(num, is1904); val = iso ? { d: iso } : ''; }
        else val = num;
      }
      if (val === '' || val == null) continue;
      (rows[ri] || (rows[ri] = []))[ci] = val;
    }
    var out = [];
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r) { for (var j = 0; j < r.length; j++) if (r[j] === undefined) r[j] = ''; out.push(r); rowCount++; } }
    return { rows: out, truncated: truncated };
  }
  function parseXlsx(buf) {
    var u8 = new Uint8Array(buf), ents = zipEntries(u8);
    if (!ents['xl/workbook.xml']) throw fail('bad', 'This does not look like an Excel workbook.');
    var wb = utf8(zipRead(u8, ents['xl/workbook.xml'])), rels = ents['xl/_rels/workbook.xml.rels'] ? utf8(zipRead(u8, ents['xl/_rels/workbook.xml.rels'])) : '';
    var relMap = {}, m, rr = /<Relationship\b([^>]*)\/?>/g;
    while ((m = rr.exec(rels))) relMap[attr(m[1], 'Id')] = attr(m[1], 'Target');
    var is1904 = /<workbookPr\b[^>]*date1904="(1|true)"/i.test(wb);
    var shared = sharedStrings(ents['xl/sharedStrings.xml'] ? utf8(zipRead(u8, ents['xl/sharedStrings.xml'])) : '');
    var dstyle = dateStyles(ents['xl/styles.xml'] ? utf8(zipRead(u8, ents['xl/styles.xml'])) : '');
    var sheets = [], sr = /<sheet\b([^>]*?)\/?>/g, truncated = false;
    while ((m = sr.exec(wb))) {
      var state = attr(m[1], 'state'); if (state === 'hidden' || state === 'veryHidden') continue;
      var rid = attr(m[1], 'r:id'), target = relMap[rid] || '', path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      var ent = ents[path]; if (!ent) continue;
      var ps = parseSheet(utf8(zipRead(u8, ent)), shared, dstyle, is1904);
      if (ps.truncated) truncated = true;
      if (ps.rows.length) sheets.push({ name: attr(m[1], 'name') || 'Sheet', rows: ps.rows });
    }
    return { sheets: sheets, truncated: truncated };
  }

  /* ------------------------------------------------------------ csv */
  function decodeText(u8) {
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    var s = new TextDecoder('utf-8').decode(u8);
    if (s.indexOf('\ufffd') >= 0) { try { s = new TextDecoder('windows-1252').decode(u8); } catch (_) { /* keep utf-8 */ } }
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }
  function parseCsv(text) {
    var sample = text.slice(0, 20000), best = ',', bestN = -1, cands = [',', ';', '\t', '|'], k, inq, n, i, ch;
    for (k = 0; k < cands.length; k++) { n = 0; inq = false; for (i = 0; i < sample.length; i++) { ch = sample[i]; if (ch === '"') inq = !inq; else if (!inq && ch === cands[k]) n++; else if (!inq && ch === '\n' && n && i > 200) break; } if (n > bestN) { bestN = n; best = cands[k]; } }
    var rows = [], row = [], cur = '', q = false, len = text.length, truncated = false;
    function endCell() { row.push(cur); cur = ''; }
    function endRow() { endCell(); var any = false; for (var j = 0; j < row.length; j++) { row[j] = row[j].trim(); if (row[j] !== '') any = true; } if (any) rows.push(row.slice(0, LIMITS.maxCols)); row = []; }
    for (i = 0; i < len; i++) {
      ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur === '') q = true;
      else if (ch === best) endCell();
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); if (rows.length >= LIMITS.maxScanRows) { truncated = true; break; } }
      else cur += ch;
    }
    if (!truncated && (cur !== '' || row.length)) endRow();
    return { rows: rows, truncated: truncated };
  }

  /* ------------------------------------------------------------ file entry */
  function readFile(buf, filename) {
    var u8 = new Uint8Array(buf), name = String(filename || '').toLowerCase();
    if (!u8.length) throw fail('empty', 'That file is empty.');
    if (u8.length > LIMITS.maxFileBytes) throw fail('toolarge', 'That file is bigger than 10 MB. Save only your bills into a smaller file and try again.');
    if (u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) throw fail('xls', 'This is an older Excel (.xls) file. In Excel choose File > Save As > Excel Workbook (.xlsx) or CSV, then pick that file.');
    var res, kind;
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      if (/\.(ods|numbers)$/.test(name)) throw fail('type', 'Please save the file as .xlsx or .csv first.');
      res = parseXlsx(buf); kind = 'xlsx';
    } else {
      if (/\.(xlsx|xlsm|xls|ods|numbers|pdf|docx?|png|jpe?g|zip)$/.test(name) || u8[0] === 0x25 && u8[1] === 0x50) throw fail('type', 'That file is not a readable spreadsheet. Please choose an .xlsx or .csv file.');
      var head = u8.subarray(0, 2000), bad = 0, i; for (i = 0; i < head.length; i++) if (head[i] < 9 || (head[i] > 13 && head[i] < 32)) bad++;
      if (bad > head.length * 0.02 && !(u8[0] === 0xff || u8[0] === 0xfe)) throw fail('type', 'That file is not a readable spreadsheet. Please choose an .xlsx or .csv file.');
      var c = parseCsv(decodeText(u8)); res = { sheets: c.rows.length ? [{ name: 'CSV', rows: c.rows }] : [], truncated: c.truncated }; kind = 'csv';
    }
    if (!res.sheets.length) throw fail('empty', 'We could not find any rows in that file.');
    res.kind = kind; return res;
  }

  /* ------------------------------------------------------------ cell helpers */
  var isDateCell = function (v) { return v && typeof v === 'object' && v.d; };
  function str(v) { return isDateCell(v) ? v.d : v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim(); }
  function normHead(v) { return str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(Math.abs(v) * 100) / 100 : NaN;
    if (isDateCell(v)) return NaN;
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /\bCR\b/i.test(s);
    s = s.replace(/usd|us\$|dollars?|\bcr\b|\bdr\b/ig, '').replace(/[$€£\s\u00a0()+\-]/g, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    var lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) { if (lc > ld) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
    else if (lc >= 0) { if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); else return NaN; }
    else if ((s.match(/\./g) || []).length > 1) { if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); else return NaN; }
    var n = Number(s); void neg;
    return isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : NaN;
  }
  var MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
  function mk(y, m, d) { if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m))) return ''; return y + '-' + pad2(m) + '-' + pad2(d); }
  function todayISO(now) { var d = now || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  /* -> {iso, day} ; iso for a real date, day (1..31) for a day-of-month only, {} when empty, {bad:true} when unreadable */
  function parseDate(v, now) {
    now = now || new Date();
    if (isDateCell(v)) return { iso: v.d };
    if (typeof v === 'number') {
      if (v >= 1 && v <= 31 && Math.floor(v) === v) return { day: v };
      if (v >= 20000 && v <= 80000) { var iso = serialToISO(v, false); return iso ? { iso: iso } : { bad: true }; }
      return { bad: true };
    }
    var s = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    if (!s) return {};
    var m, y, a, b, c;
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(s))) { a = +m[1]; return a >= 1 && a <= 31 ? { day: a } : { bad: true }; }
    if ((m = /^(?:day\s*)?(\d{1,2})(?:st|nd|rd|th)?(?: of (?:the )?(?:every )?month| of each month| each month)?$/i.exec(s)) && +m[1] >= 1 && +m[1] <= 31) return { day: +m[1] };
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ].*)?$/.exec(s))) { c = mk(+m[1], +m[2], +m[3]); return c ? { iso: c } : { bad: true }; }
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/.exec(s))) {
      a = +m[1]; b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
      if (s.indexOf('.') >= 0) return (c = mk(y, b, a)) ? { iso: c } : { bad: true }; // 03.11.2026 is day.month.year
      c = mk(y, a, b); if (!c && a > 12 && b <= 12) c = mk(y, b, a);
      return c ? { iso: c } : { bad: true };
    }
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})$/.exec(s))) { c = mk(now.getFullYear(), +m[1], +m[2]); return c ? { iso: c } : { bad: true }; }
    if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}|\d{2}))?$/.exec(s)) && MONTHS[m[1].toLowerCase()]) {
      y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000; c = mk(y, MONTHS[m[1].toLowerCase()], +m[2]); return c ? { iso: c } : { bad: true };
    }
    if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?(?:,? (\d{4}|\d{2}))?$/.exec(s)) && MONTHS[m[2].toLowerCase()]) {
      y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000; c = mk(y, MONTHS[m[2].toLowerCase()], +m[1]); return c ? { iso: c } : { bad: true };
    }
    if (/^\d{5}$/.test(s) && +s >= 20000 && +s <= 80000) { var i2 = serialToISO(+s, false); return i2 ? { iso: i2 } : { bad: true }; }
    return { bad: true };
  }
  function dayToISO(day, now) {
    now = now || new Date();
    var y = now.getFullYear(), m = now.getMonth() + 1, t = todayISO(now), c = mk(y, m, Math.min(day, daysIn(y, m)));
    if (c < t) { m++; if (m > 12) { m = 1; y++; } c = mk(y, m, Math.min(day, daysIn(y, m))); }
    return c;
  }
  /* -> {v: weekly|biweekly|semimonthly|monthly|never, note} or null when empty/unknown */
  function parseFreq(v) {
    var s = normHead(v);
    if (!s) return null;
    if (/(bi ?weekly|every (2|two) weeks|fortnight|every other week|2 weeks|every 14)/.test(s)) return { v: 'biweekly' };
    if (/(semi ?monthly|twice a month|2x month|1st (and|&) 15th|15th (and|&) 1st|twice monthly|bimonthly twice)/.test(s)) return { v: 'semimonthly' };
    if (/(weekly|every week|each week|per week|^week$)/.test(s)) return { v: 'weekly' };
    if (/(monthly|every month|each month|per month|^month$|^mo$|^m$)/.test(s)) return { v: 'monthly' };
    if (/(one ?time|once|never|single|no repeat|^none$|^n a$|^na$)/.test(s)) return { v: 'never' };
    if (/(annual|yearly|every year|per year|quarter|semi ?annual|every (3|three|6|six) months|bi ?monthly|every (2|two) months|biannual)/.test(s)) return { v: 'never', note: 'Repeats like \u201c' + str(v).slice(0, 20) + '\u201d are not available yet, so this is one-time.' };
    return null;
  }
  function parsePaid(v) {
    if (typeof v === 'number') return v === 1;
    if (/^[\u2713\u2714\u2705\u2611]/.test(str(v))) return true;
    var s = normHead(v);
    if (!s) return false;
    if (/^(unpaid|no|n|false|0|pending|due|open|late|overdue|not paid|outstanding)/.test(s)) return false;
    return /^(y|yes|true|1|x|paid|done|cleared|complete|completed|settled|checked|ok|\u2713|\u2714)/.test(s) || /^paid\b/.test(s) || s === 'check' || s === 'checkmark';
  }

  /* ------------------------------------------------------------ column detection */
  var ROLES = ['name', 'amount', 'due', 'freq', 'category', 'paid', 'notes', 'autopay', 'kind'];
  function headScore(role, h) {
    if (!h) return 0;
    var amtStrong = /\b(amount|amt|cost|price|how much|charge|payment amount|minimum payment|min payment|monthly payment|monthly cost)\b/.test(h);
    switch (role) {
      case 'amount': return amtStrong ? 3 : /\b(payment|pmt|total|monthly|sum|owed|balance|due amount|\$|usd)\b/.test(h) && !/\b(date|day|when)\b/.test(h) ? 1 : 0;
      case 'due': if (amtStrong || /\b(autopay|auto pay)\b/.test(h)) return 0; return /\b(due date|date due|due day|day due|due on|due by|pay by|pay date|payment date|bill date|deadline|day of month|due|date|day|when)\b/.test(h) ? (/\b(due|deadline|pay by)\b/.test(h) ? 3 : 2) : 0;
      case 'freq': return /\b(frequency|freq|repeat|repeats|recurrence|recurring|schedule|how often|cycle|interval|period|occurs)\b/.test(h) ? 3 : 0;
      case 'category': return /\b(category|categories|cat|group|class)\b/.test(h) ? 3 : 0;
      case 'paid': return /\b(paid|status|cleared|done|complete|completed|settled)\b/.test(h) ? 3 : 0;
      case 'notes': return /\b(notes?|memo|comments?|remarks?)\b/.test(h) ? 3 : 0;
      case 'autopay': return /\b(auto ?pay|automatic|auto)\b/.test(h) ? 3 : 0;
      case 'kind': return /^(type|kind|income expense|in out|direction|income or expense|bill or income)$/.test(h) ? 2 : 0;
      case 'name': return /\b(bill|bills|bill name|name|payee|vendor|creditor|company|merchant|description|desc|expense|item|biller|title|payable to|pay to|paid to|details?|account|lender|debt)\b/.test(h) ? (/\b(bill name|name|payee|bill|biller|vendor|creditor|merchant|company)\b/.test(h) ? 3 : 2) : 0;
    }
    return 0;
  }
  function colStats(rows, ci, from, now) {
    var n = 0, num = 0, dec = 0, date = 0, day = 0, text = 0, uniq = {}, nu = 0, i, v;
    for (i = from; i < rows.length && n < 200; i++) {
      v = rows[i][ci]; if (v === '' || v == null) continue; n++;
      var amt = parseAmount(v), dt = parseDate(v, now), s = str(v);
      if (isDateCell(v) || (dt.iso && !(typeof v === 'number'))) date++;
      else if (dt.day && (typeof v === 'number' || /^\d{1,2}(st|nd|rd|th)?$/i.test(s))) day++;
      if (!isDateCell(v) && isFinite(amt) && !(dt.iso && typeof v !== 'number')) { num++; if (/[.,]\d{2}\b/.test(s) || (typeof v === 'number' && Math.round(v * 100) !== Math.round(v) * 100)) dec++; }
      else if (!isDateCell(v)) { text++; if (!uniq[s.toLowerCase()]) { uniq[s.toLowerCase()] = 1; nu++; } }
    }
    return { n: n, num: num, dec: dec, date: date, day: day, text: text, uniq: nu };
  }
  function analyze(rows, now) {
    now = now || new Date();
    var width = 0, i, j; rows.forEach(function (r) { if (r.length > width) width = r.length; });
    // header row
    var hdr = -1, hdrScore = 0;
    for (i = 0; i < Math.min(rows.length, 15); i++) {
      var sc = 0, seen = {};
      for (j = 0; j < rows[i].length; j++) {
        var hn = normHead(rows[i][j]); if (!hn || typeof rows[i][j] === 'number') continue;
        for (var r = 0; r < ROLES.length; r++) if (!seen[ROLES[r]] && headScore(ROLES[r], hn)) { seen[ROLES[r]] = 1; sc++; break; }
      }
      if (sc > hdrScore) { hdrScore = sc; hdr = i; }
    }
    var headerFound = hdrScore >= 2;
    if (!headerFound) {
      hdr = -1;
      var r0 = rows[0] || [], nonEmpty = r0.filter(function (x) { return x !== ''; });
      if (nonEmpty.length >= 2 && nonEmpty.every(function (x) { return typeof x === 'string' && !isFinite(parseAmount(x)) && !parseDate(x, now).iso; }) && rows[1] && rows[1].some(function (x) { return typeof x === 'number' || isFinite(parseAmount(x)); })) hdr = 0;
    }
    var from = hdr + 1, heads = [], mapping = {}, used = {}, ties = false;
    for (j = 0; j < width; j++) heads.push(hdr >= 0 ? str(rows[hdr][j]) : '');
    var order = ['amount', 'due', 'freq', 'paid', 'category', 'notes', 'autopay', 'kind', 'name'];
    order.forEach(function (role) {
      var best = -1, bs = 0, tie = false;
      for (var c = 0; c < width; c++) {
        if (used[c] || hdr < 0) continue;
        var s = headScore(role, normHead(heads[c]));
        if (s > bs) { bs = s; best = c; tie = false; } else if (s && s === bs) tie = true;
      }
      if (best >= 0) { mapping[role] = best; used[best] = 1; if (tie && (role === 'amount' || role === 'name' || role === 'due')) ties = true; }
    });
    if (mapping.kind != null) { // "Type" is a kind column only when its values look like income / bill words; otherwise it is a category
      var kv = 0, kn = 0; for (i = from; i < Math.min(rows.length, from + 100); i++) { var kx = normHead(rows[i][mapping.kind]); if (!kx) continue; kn++; if (/income|deposit|paycheck|salary|wage|bill|expense|payment|debit|credit|refund/.test(kx)) kv++; }
      if (!kn || kv / kn < 0.6) { if (mapping.category == null) mapping.category = mapping.kind; delete mapping.kind; }
    }
    // content based fill-ins
    var stats = []; for (j = 0; j < width; j++) stats.push(colStats(rows, j, from, now));
    var byContent = false;
    if (mapping.amount == null) {
      var ba = -1, bscore = 0; for (j = 0; j < width; j++) { if (used[j]) continue; var st = stats[j]; if (st.n && st.num / st.n >= 0.7) { var sc2 = st.dec / st.n + 0.5 * (st.num / st.n); if (sc2 > bscore) { bscore = sc2; ba = j; } } }
      if (ba >= 0) { mapping.amount = ba; used[ba] = 1; byContent = true; }
    }
    if (mapping.due == null) {
      var bd = -1, bsc = 0; for (j = 0; j < width; j++) { if (used[j]) continue; st = stats[j]; if (st.n && (st.date + st.day) / st.n >= 0.7 && (st.date + st.day) / st.n > bsc) { bsc = (st.date + st.day) / st.n; bd = j; } }
      if (bd >= 0) { mapping.due = bd; used[bd] = 1; byContent = true; }
    }
    if (mapping.name == null) {
      var bn = -1, bu = -1; for (j = 0; j < width; j++) { if (used[j]) continue; st = stats[j]; if (st.n && st.text / st.n >= 0.7 && st.uniq > bu) { bu = st.uniq; bn = j; } }
      if (bn >= 0) { mapping.name = bn; used[bn] = 1; byContent = true; }
    }
    var reasons = [];
    if (mapping.name == null) reasons.push('name'); if (mapping.amount == null) reasons.push('amount');
    var sure = headerFound && mapping.name != null && mapping.amount != null && !ties && !byContent && stats.length > 0;
    if (!headerFound && mapping.name != null && mapping.amount != null && hdr >= 0 && !ties && !byContent) sure = false;
    return { headerRow: hdr, mapping: mapping, heads: heads, width: width, sure: sure, headerFound: headerFound, reasons: reasons };
  }

  /* ------------------------------------------------------------ rows -> items */
  var CATS = [[/electric|power|energy|water|sewer|trash|gas bill|natural gas|internet|wifi|cable|phone|cell|mobile|verizon|t-mobile|at&t|att\b|comcast|xfinity|spectrum|utilit/i, 'Utilities'], [/rent|mortgage|hoa|lease|property tax|landlord/i, 'Housing'], [/insur|geico|progressive|state farm|allstate/i, 'Insurance'], [/netflix|spotify|hulu|disney|prime|youtube|apple|icloud|subscription|membership|gym|patreon|adobe|hbo|max\b|paramount|peacock|audible/i, 'Subscriptions'], [/grocer|food|kroger|walmart|costco|aldi|market/i, 'Groceries'], [/restaurant|dining|doordash|uber eats|grubhub/i, 'Dining out'], [/car |auto|fuel|gas station|uber|lyft|transit|bus pass|toll|parking|vehicle|car payment|loan.*car|car loan/i, 'Transport']];
  function guessCategory(name) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0].test(name)) return CATS[i][1]; return 'Other'; }
  var TOTAL_RE = /^(sub ?totals?|totals?|grand totals?|sum|net|remaining|left ?over|balance|monthly total|total bills|total income)\b/i;
  var INCOME_RE = /(pay ?check|paycheque|payroll|salary|wages?|direct deposit|\bincome\b|dividend|bonus|tax refund|side gig|commission|\bpension\b|social security|\bssi\b|child support|alimony)/i;
  function cleanName(s) { return str(s).replace(/\s+/g, ' ').slice(0, 80); }
  function normName(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|bill|bills|payment|pmt|inc|llc|co|corp|monthly|autopay)\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    if (a === b) return 0; if (Math.abs(a.length - b.length) > 2) return 9;
    var prev = [], i, j; for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) { var cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[b.length];
  }
  function near(a, b) { return Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.1); }
  /* existing: [{name, amount, due|date}] ; returns {name, amount, why} of the first resembling record or null */
  function findDuplicate(item, existing) {
    var n = normName(item.name); if (!n) return null;
    for (var i = 0; i < existing.length; i++) {
      var e = existing[i], en = normName(e.name); if (!en) continue;
      var ea = Number(e.amount) || 0, edate = e.due || e.date || '';
      if (en === n) return { id: e.id, name: e.name, amount: ea, due: edate };
      var short = n.length < en.length ? n : en, long = n.length < en.length ? en : n;
      var sameDay = edate && item.due && edate.slice(8, 10) === item.due.slice(8, 10);
      if (near(ea, item.amount) || sameDay) {
        if (short.length >= 4 && long.indexOf(short) >= 0) return { id: e.id, name: e.name, amount: ea, due: edate };
        if (short.length >= 5 && lev(n, en) <= 1) return { id: e.id, name: e.name, amount: ea, due: edate };
      }
    }
    return null;
  }
  function destOf(item) { return item.dest; }
  function checkItem(item) {
    var errs = [];
    if (!item.name) errs.push('name');
    if (!(item.amount > 0) || item.amount > 1e9) errs.push('amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.due || '') || !mk(+item.due.slice(0, 4), +item.due.slice(5, 7), +item.due.slice(8, 10))) errs.push('due');
    return errs;
  }
  function buildItems(rows, an, ctx) {
    ctx = ctx || {}; var now = ctx.now || new Date(), mp = an.mapping, from = an.headerRow + 1, items = [], existingBills = ctx.bills || [], existingIncome = ctx.income || [], skippedEmpty = 0, i;
    var cats = ctx.categories || [], catByLower = {}; cats.forEach(function (c) { catByLower[String(c).toLowerCase()] = c; });
    function cell(r, role) { return mp[role] != null ? r[mp[role]] : ''; }
    for (i = from; i < rows.length && items.length < LIMITS.maxRows; i++) {
      var r = rows[i], any = r.some(function (x) { return x !== '' && x != null; });
      if (!any) { skippedEmpty++; continue; }
      var name = cleanName(cell(r, 'name')), amt = parseAmount(cell(r, 'amount')), dt = parseDate(cell(r, 'due'), now);
      var it = { row: i + 1, name: name, amount: isFinite(amt) ? amt : '', due: '', fq: null, category: '', paid: false, autopay: false, notes: '', dest: 'bills', checked: false, note: '', dup: null, errors: [], rawDue: str(cell(r, 'due')), rawAmount: str(cell(r, 'amount')), has: { freq: mp.freq != null, category: mp.category != null, notes: mp.notes != null, autopay: mp.autopay != null, paid: mp.paid != null }, dupAction: 'keep' };
      var fq = parseFreq(cell(r, 'freq')); it.fq = fq ? fq.v : null; if (fq && fq.note) it.note = fq.note;
      if (dt.iso) it.due = dt.iso; else if (dt.day) { it.due = dayToISO(dt.day, now); if (!fq) it.fq = 'monthly'; }
      if (mp.freq == null || !fq) { if (!it.fq) it.fq = 'monthly'; }
      var cc = str(cell(r, 'category')); if (cc) it.category = catByLower[cc.toLowerCase()] || cc.slice(0, 40); else it.category = guessCategory(name);
      it.paid = mp.paid != null ? parsePaid(cell(r, 'paid')) : false;
      it.autopay = mp.autopay != null ? parsePaid(cell(r, 'autopay')) : false;
      it.notes = str(cell(r, 'notes')).slice(0, 300);
      var kind = normHead(cell(r, 'kind'));
      if (kind && /income|deposit|paycheck|salary|wage|refund|inflow|credit|\bin\b/.test(kind)) it.dest = 'income';
      else if (!kind && INCOME_RE.test(name)) it.dest = 'income';
      var onlyName = name && !isFinite(amt) && !it.due && !str(cell(r, 'amount'));
      if (TOTAL_RE.test(name)) { it.dest = 'skip'; it.note = 'Looks like a total row.'; }
      else if (onlyName) { it.dest = 'skip'; it.note = 'Looks like a heading (no amount or date).'; }
      if (!it.due && dt.bad) it.note = (it.note ? it.note + ' ' : '') + 'We could not read the date \u201c' + str(cell(r, 'due')).slice(0, 20) + '\u201d.';
      if (it.dest === 'income' && it.fq === 'never') it.fq = 'one-time';
      if (it.dest === 'bills' && it.fq === 'semimonthly') { it.fq = 'monthly'; }
      if (it.dest === 'income' && it.category) it.category = it.category;
      items.push(it);
    }
    var overflow = i < rows.length && items.length >= LIMITS.maxRows;
    refreshItems(items, { bills: existingBills, income: existingIncome });
    items.forEach(function (it) { it.checked = it.dest !== 'skip' && !it.dup && !it.errors.length; });
    return { items: items, overflow: overflow };
  }
  /* recompute errors + duplicate flags (also within the file). Does not touch checked. */
  function refreshItems(items, ex) {
    var seen = {};
    items.forEach(function (it) {
      it.errors = it.dest === 'skip' ? [] : checkItem(it); it.dup = null; it.dupWhy = ''; it.canOverwrite = false; if (it.dupAction !== 'overwrite') it.dupAction = 'keep';
      if (it.dest === 'skip' || !it.name) return;
      var d = findDuplicate(it, it.dest === 'income' ? ex.income : ex.bills);
      if (d) { it.dup = d; it.canOverwrite = it.dest === 'bills' && d.id != null; it.dupWhy = 'Looks like \u201c' + d.name + '\u201d (' + fmtMoney(d.amount) + ') already in ' + (it.dest === 'income' ? 'Income' : 'Bills') + '.'; return; }
      var key = it.dest + '|' + normName(it.name) + '|' + it.amount;
      if (seen[key]) { it.dup = { name: it.name, amount: it.amount, inFile: true }; it.dupWhy = 'Appears more than once in this file.'; } else seen[key] = 1;
    });
    items.forEach(function (it) { if (!it.canOverwrite) it.dupAction = 'keep'; });
  }
  /* Overwrite support. rec = the existing bill record. Returns { patch, changes:[{key,label,from,to}], markPaid }.
     Only values the spreadsheet actually provides are applied; everything else (id, colour, paid history, notes when the cell is blank...) is untouched. */
  var FQ_LABEL = { never: 'Never', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' };
  function recurLabel(recurring, recurrence) { return recurring ? (FQ_LABEL[recurrence] || recurrence || 'Monthly') : 'Never'; }
  function overwriteChanges(it, rec) {
    var patch = {}, changes = [], has = it.has || {};
    function chg(key, label, from, to, val) { patch[key] = val === undefined ? to : val; changes.push({ key: key, label: label, from: from, to: to }); }
    var nm = String(it.name || '').slice(0, 80); if (nm && nm !== rec.name) chg('name', 'Name', rec.name, nm);
    if (it.amount > 0 && Math.round(it.amount * 100) !== Math.round((Number(rec.amount) || 0) * 100)) chg('amount', 'Amount', fmtMoney(rec.amount), fmtMoney(it.amount), it.amount);
    if (/^\d{4}-\d{2}-\d{2}$/.test(it.due || '') && it.due !== rec.due) chg('due', 'Due', rec.due || 'none', it.due);
    if (has.freq && it.fq) {
      var recur = it.fq !== 'never' && it.fq !== 'one-time', rr = recur ? it.fq : (rec.recurrence || 'weekly');
      if (recur !== !!rec.recurring || (recur && rr !== rec.recurrence)) { chg('recurring', 'Repeats', recurLabel(rec.recurring, rec.recurrence), recurLabel(recur, rr), recur); patch.recurrence = rr; }
    }
    if (has.category && it.category && it.category !== (rec.category || '')) chg('category', 'Category', rec.category || 'none', it.category);
    if (has.notes && it.notes && it.notes !== (rec.notes || '')) chg('notes', 'Notes', rec.notes || 'none', it.notes);
    if (has.autopay && !!it.autopay !== !!rec.autopay) chg('autopay', 'Autopay', rec.autopay ? 'On' : 'Off', it.autopay ? 'On' : 'Off', !!it.autopay);
    var markPaid = !!(has.paid && it.paid);
    if (markPaid) changes.push({ key: 'paid', label: 'Paid', from: '', to: 'Mark paid' });
    return { patch: patch, changes: changes, markPaid: markPaid };
  }
  function fmtMoney(n) { n = Math.round(Number(n || 0) * 100) / 100; return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var api = { LIMITS: LIMITS, readFile: readFile, parseXlsx: parseXlsx, parseCsv: parseCsv, analyze: analyze, buildItems: buildItems, refreshItems: refreshItems, parseAmount: parseAmount, parseDate: parseDate, parseFreq: parseFreq, parsePaid: parsePaid, findDuplicate: findDuplicate, overwriteChanges: overwriteChanges, normName: normName, guessCategory: guessCategory, checkItem: checkItem, dayToISO: dayToISO, fmtMoney: fmtMoney, ROLES: ROLES, _inflate: inflate, _destOf: destOf };
  root.PAImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
