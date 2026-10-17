#!/usr/bin/env python3
"""Spreadsheet import, end to end in the web app (DEMO mode, localhost only). Usage: python3 app/tests/import_ui_test.py
Needs playwright + openpyxl. Fixtures: app/tests/import_fixtures (regenerate with make_fixtures.py)."""
import http.server, os, socketserver, sys, threading, functools, datetime, tempfile
from playwright.sync_api import sync_playwright, expect
import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FX = os.path.join(os.path.dirname(__file__), 'import_fixtures')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
srv = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{PORT}/app/'
fails, passes = [], 0
def check(name, cond, extra=''):
    global passes
    if cond: passes += 1; print('  ok  ', name)
    else: fails.append(name); print('  FAIL', name, extra)

today = datetime.date.today()
def dd(n): return (today.replace(day=1) + datetime.timedelta(days=n - 1))
tmp = tempfile.mkdtemp()
live = os.path.join(tmp, 'this_month.xlsx')
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Bill', 'Amount', 'Due Date', 'Frequency', 'Category', 'Paid?'])
for r in [('Electric Bill', 120, dd(5), 'Monthly', 'Utilities', 'No'), ('Gym', 24.99, dd(10), 'Monthly', 'Subscriptions', 'Yes'), ('Dog walking income', 200, dd(12), 'Weekly', '', ''), ('Old loan', 55, dd(20), 'Never', 'Other', ''), ('Total', 400, None, None, None, None)]: ws.append(list(r))
wb.save(live)

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900}); pg = ctx.new_page()
        logs, hosts, bodies = [], set(), []
        pg.on('console', lambda m: logs.append((m.type, m.text)) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
        def on_req(r):
            hosts.add(r.url.split('/')[2])
            if r.method != 'GET': bodies.append((r.url, r.post_data or ''))
        pg.on('request', on_req)
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=8000)
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill')
        n0 = pg.locator('.bill').count()

        print('[entry points]')
        check('Bills page has "Import from spreadsheet"', pg.locator('[data-import=bills]').count() == 1)
        pg.goto(B + 'settings.html'); pg.wait_for_selector('[data-act=import]'); check('Settings has an Import entry', True)
        pg.click('[data-act=import]'); pg.wait_for_selector('[data-import]'); check('Settings entry opens the importer', pg.locator('.imp-drop').count() == 1)
        check('privacy line: file stays on this device', 'read on this device only' in pg.inner_text('.sheet'))
        pg.keyboard.press('Escape'); check('Escape closes it', pg.locator('.sheet').count() == 0)

        print('[bad files are explained]')
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill'); pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]')
        for f, word in [('old_format.xls', '.xlsx'), ('empty.csv', 'empty'), ('truncated.xlsx', ''), ('garbage.csv', 'not a readable'), ('opendoc.ods', 'xlsx'), ('bomb.xlsx', 'too large'), ('only_header.csv', '')]:
            pg.set_input_files('[data-import-file]', os.path.join(FX, f))
            pg.wait_for_timeout(250)
            if f == 'only_header.csv':
                check('header-only file: friendly "no bill rows" state', 'No bill rows found' in pg.inner_text('.sheet')); pg.click('text=Choose another file'); pg.wait_for_selector('[data-import-file]'); continue
            txt = pg.inner_text('[data-import-error]') if pg.locator('[data-import-error]').count() else ''
            check(f'{f}: clear message, stays on the pick step', len(txt) > 10 and word.lower() in txt.lower() and pg.locator('.imp-list').count() == 0, txt)

        print('[preview: detection, duplicates, defaults]')
        hosts.clear(); bodies.clear()
        pg.set_input_files('[data-import-file]', live); pg.wait_for_selector('.imp-row')
        check('detection was sure: went straight to the list (no mapping step)', pg.locator('[data-map]').count() == 0)
        check('every row shown (5 rows read)', pg.locator('.imp-row').count() == 5, pg.locator('.imp-row').count())
        ROWNO = {'Electric Bill': 2, 'Gym': 3, 'Dog walking income': 4, 'Old loan': 5, 'Total': 6}
        row = lambda n: pg.locator(f'.imp-row[data-row="{ROWNO[n]}"]')
        check('"Electric Bill" flagged Possible duplicate and unchecked', row('Electric Bill').locator('[data-dup]').count() == 1 and not row('Electric Bill').locator('[data-r=chk]').is_checked())
        check('new rows checked by default', row('Gym').locator('[data-r=chk]').is_checked() and row('Old loan').locator('[data-r=chk]').is_checked())
        check('income row defaults to Income', row('Dog walking income').locator('[data-r=dest]').input_value() == 'income')
        check('Total row defaults to Skip and unchecked', row('Total').locator('[data-r=dest]').input_value() == 'skip' and not row('Total').locator('[data-r=chk]').is_checked())
        check('Add button counts what is ticked', 'Add 2 bills and 1 income' in pg.inner_text('[data-import-add]'), pg.inner_text('[data-import-add]'))
        check('Gym paid=Yes read; frequency/category prefilled', row('Gym').locator('[data-r=rep]').input_value() == 'monthly' and row('Gym').locator('[data-r=cat]').input_value() == 'Subscriptions')
        check('Never -> one-time', row('Old loan').locator('[data-r=rep]').input_value() == 'never')
        check('NOTHING left this machine while reading the file (localhost only, no POST)', hosts <= {f'localhost:{PORT}'} and not bodies, str((hosts, bodies)))

        print('[edit, retarget, confirm]')
        g = row('Gym'); g.locator('[data-r=name]').fill('Gym membership')
        g.locator('[data-r=amount]').fill('29.99'); g.locator('[data-r=due]').fill(dd(11).isoformat())
        row('Old loan').locator('[data-r=chk]').uncheck()
        check('summary updates live', 'Add 1 bill and 1 income' in pg.inner_text('[data-import-add]'))
        # an invalid ticked row blocks the add and says why
        t = row('Total'); t.locator('[data-r=dest]').select_option('bills'); t.locator('[data-r=chk]').check()
        check('Total switched to Bills now needs a due date and is highlighted', t.locator('[data-needs]').count() == 1 and 'due date' in t.locator('[data-needs]').inner_text())
        pg.click('[data-import-add]'); check('Add is blocked with a plain message until fixed', pg.locator('[data-import-msg]').is_visible() and 'need' in pg.inner_text('[data-import-msg]'))
        t.locator('[data-r=chk]').uncheck(); t.locator('[data-r=dest]').select_option('skip')
        pg.click('[data-import-add]'); pg.wait_for_selector('[data-import-result]')
        res = pg.inner_text('[data-import-result]'); check('result says what was added', 'Added 1 bill and 1 income item' in res, res)
        check('result says synced to phone app', 'synced' in res.lower(), res)
        srv_items = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const r=await api.changes(0);return r.items.filter(i=>!i.deleted&&['bill','income'].includes(i.kind)).map(i=>({kind:i.kind,name:i.data&&i.data.name,amount:i.data&&i.data.amount,due:i.data&&(i.data.due||i.data.date),rec:i.data&&i.data.recurring,recurrence:i.data&&i.data.recurrence,paid:i.data&&i.data.paid,pa:i.data&&i.data._pa,cat:i.data&&i.data.category,freq:i.data&&i.data.frequency}))}""")
        gm = [i for i in srv_items if i['name'] == 'Gym membership']; dw = [i for i in srv_items if i['name'] == 'Dog walking income']
        check('bill reached the sync server through the normal add path with the edited values', len(gm) == 1 and gm[0]['amount'] == 29.99 and gm[0]['due'] == dd(11).isoformat() and gm[0]['rec'] and gm[0]['recurrence'] == 'monthly' and gm[0]['cat'] == 'Subscriptions', str(gm))
        check('paid=Yes became a paid occurrence', gm and gm[0]['pa'] and gm[0]['pa'].get(dd(11).isoformat()) == 29.99 or (gm and gm[0]['pa'] and gm[0]['pa'].get(dd(10).isoformat()) is not None), str(gm))
        check('income row reached the server as income (weekly)', len(dw) == 1 and dw[0]['freq'] == 'weekly' and dw[0]['amount'] == 200 and dw[0]['kind'] == 'income', str(dw))
        check('unticked / duplicate / skipped rows were NOT added', not any(i['name'] in ('Old loan', 'Electric Bill', 'Total') for i in srv_items))
        check('push traffic never left localhost', hosts <= {f'localhost:{PORT}'})
        pg.click('[data-import-done]'); pg.wait_for_selector('.bill'); pg.wait_for_timeout(200)
        pg.check('[data-show-paid]')  # Gym was marked paid in the file, so it only shows with "Show paid bills"
        check('Bills page now lists the imported bill (paid, shown with Show paid bills)', pg.locator('.bill', has_text='Gym membership').count() >= 1 and pg.locator('.bill', has_text='Gym membership').inner_text().count('Paid') >= 1)
        # a phone change to the imported bill comes back down (two-way)
        back = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const b=api.bills.list().find(x=>x.name==='Gym membership');api.demo.phone('bill',b.id,{...(await api.changes(0)).items.find(i=>i.id===b.id).data,amount:31.5});await api.sync();return api.bills.list().find(x=>x.name==='Gym membership').amount}""")
        check('edit made on the phone side syncs back to the imported bill', back == 31.5, back)

        print('[mapping step when unsure]')
        pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'ambiguous.xlsx')); pg.wait_for_selector('[data-map=name]')
        check('ambiguous file shows the column-mapping step first', pg.locator('[data-map=amount]').count() == 1 and pg.is_enabled('[data-map-continue]') is True)
        pg.select_option('[data-map=name]', ''); check('Continue is disabled until a name column is chosen', pg.is_disabled('[data-map-continue]'))
        pg.select_option('[data-map=name]', '0'); pg.select_option('[data-map=amount]', '2'); pg.click('[data-map-continue]'); pg.wait_for_selector('.imp-row')
        check('mapping applied (Phone $85.00 from column C)', pg.locator('.imp-row input[data-r=amount]').first.input_value() == '85')
        check('rows without a date are unticked and flagged', pg.locator('.imp-row [data-needs]').count() == 2 and pg.locator('.imp-row [data-r=chk]:checked').count() == 0)
        pg.click('[data-import-cols]'); pg.wait_for_selector('[data-map=name]'); check('"Change columns" returns to the mapping step', True)
        pg.keyboard.press('Escape')

        print('[sheets, headerless, huge]')
        pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'multi_sheet.xlsx')); pg.wait_for_selector('.imp-row')
        check('multi-sheet workbook: sheet picker (hidden sheet skipped)', pg.locator('[data-import-sheet] option').count() == 2 and pg.locator('.imp-row').count() == 2)
        pg.select_option('[data-import-sheet]', '1'); pg.wait_for_timeout(150); check('switching sheet reloads rows', pg.locator('.imp-row').count() == 1)
        pg.keyboard.press('Escape')
        pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'no_header.xlsx')); pg.wait_for_selector('[data-map=name]')
        check('file with no column titles asks to confirm columns', pg.locator('[data-map-header]').is_checked() is False)
        pg.click('[data-map-continue]'); pg.wait_for_selector('.imp-row'); check('headerless rows all imported as rows', pg.locator('.imp-row').count() == 5)
        pg.keyboard.press('Escape')
        import time; t0 = time.time()
        pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'huge_6000_rows.xlsx')); pg.wait_for_selector('.imp-row', timeout=20000)
        el = time.time() - t0
        check(f'6000-row file opens in {el:.1f}s, caps at 5000 rows with a notice, renders in pages', 'first 5,000 rows' in pg.inner_text('.sheet') and pg.locator('.imp-row').count() == 200 and pg.locator('[data-import-more]').is_visible() and el < 12, str(el))
        check('summary counts all rows', '5000 rows read' in pg.inner_text('[data-import-summary]'))
        pg.click('[data-import-more]'); check('"Show more" adds the next page', pg.locator('.imp-row').count() == 400)
        pg.click('[data-import-none]'); check('Select none leaves nothing ticked and disables Add', pg.is_disabled('[data-import-add]'))
        pg.keyboard.press('Escape')

        print('[mobile 390px]')
        pg.set_viewport_size({'width': 390, 'height': 844}); pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill'); pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]')
        pg.set_input_files('[data-import-file]', live); pg.wait_for_selector('.imp-row')
        over = pg.evaluate("document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.sheet-b').scrollWidth > document.querySelector('.sheet-b').clientWidth + 1")
        check('no horizontal overflow at 390px', not over)
        bad = pg.evaluate("[...document.querySelectorAll('.imp-row input:not([type=checkbox]),.imp-row select')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width<60).length")
        check('row inputs stay usable (>=60px wide) at 390px', bad == 0, bad)

        errs = [l for l in logs if not ('favicon' in l[1] or 'Failed to load resource' in l[1])]
        check('no console errors / CSP violations', not errs, str(errs[:3]))
        b.close()
run()
print(f'\n{passes} checks passed, {len(fails)} failed')
if fails: print('\n'.join(fails)); sys.exit(1)
