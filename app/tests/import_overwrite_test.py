#!/usr/bin/env python3
"""Spreadsheet import: Overwrite / Keep mine for rows that match an existing bill (web app, DEMO mode, localhost only).
Usage: python3 app/tests/import_overwrite_test.py   (needs playwright)"""
import http.server, os, socketserver, threading, functools, datetime, tempfile, json
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
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

today = datetime.date.today(); first = today.replace(day=1)
def dd(n): return (first + datetime.timedelta(days=n - 1)).isoformat()
tmp = tempfile.mkdtemp(); CSV = os.path.join(tmp, 'bills.csv')
open(CSV, 'w').write('\n'.join([
    'Bill,Amount,Due Date,Frequency',
    f'Rent,1495.50,{dd(1)},Monthly',                       # row 2: amount changes
    f'Internet,79.99,{dd(min(28, today.day))},Monthly',     # row 3: amount changes
    f'Phone,65,{dd(min(28, today.day + 7))},Monthly',       # row 4: identical to what is saved
    f'Brand New Thing,12,{dd(20)},Monthly',                 # row 5: new
]) + '\n')

STATE = """async()=>{const {api}=await import('./js/api.js');const r=await api.changes(0);
 const b=r.items.filter(i=>!i.deleted&&i.kind==='bill').map(i=>({id:i.id,name:i.data.name,amount:i.data.amount,due:i.data.due,color:i.data.color,cat:i.data.category,notes:i.data.notes,pa:i._pa||i.data._pa||null,ov:i.data._ov||null,rec:i.data.recurring}));
 return {bills:b,local:api.bills.list().map(x=>({id:x.id,name:x.name,amount:x.amount,notes:x.notes,occ:x.occ,color:x.color,category:x.category}))}}"""
ROWNO = {'Rent': 2, 'Internet': 3, 'Phone': 4, 'New': 5}

def run():
    with sync_playwright() as p:
        b = p.chromium.launch()
        def fresh(w=1280, h=900, note=False):
            ctx = b.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); logs = []
            pg.on('console', lambda m: logs.append(m.text) if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
            pg.on('pageerror', lambda e: logs.append(str(e)))
            pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=8000)
            pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill')
            if note:
                pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const x=api.bills.list().find(b=>b.name==='Internet');api.bills.save({...x,notes:'my own note',autopay:true})}""")
            pg.click('[data-import=bills]'); pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', CSV); pg.wait_for_selector('.imp-row')
            return pg, logs
        row = lambda pg, n: pg.locator(f'.imp-row[data-row="{ROWNO[n]}"]')
        done = lambda pg: (pg.click('[data-import-add]'), pg.wait_for_selector('[data-import-result]'), pg.inner_text('[data-import-result]'))[2]
        def by(st, n): return [x for x in st['bills'] if x['name'] == n]

        print('[defaults: Keep mine, nothing overwritten by accident]')
        pg, logs = fresh()
        check('3 existing-bill rows offer Keep mine / Overwrite', pg.locator('.imp-act').count() == 3)
        check('every matched row defaults to Keep mine', all(row(pg, n).locator('[data-r=act-keep]').get_attribute('aria-pressed') == 'true' for n in ('Rent', 'Internet', 'Phone')))
        check('matched rows start unticked', all(not row(pg, n).locator('[data-r=chk]').is_checked() for n in ('Rent', 'Internet', 'Phone')))
        d = row(pg, 'Rent').locator('[data-r=diff]').inner_text()
        check('existing vs new is shown for a matched row (Amount $1,450.00 -> $1,495.50)', '$1,450.00' in d and '$1,495.50' in d and 'Amount' in d, d)
        check('identical row says nothing would change', 'Nothing would change' in row(pg, 'Phone').locator('[data-r=diff]').inner_text())
        check('Add button counts only the new row', pg.inner_text('[data-import-add]').strip() == 'Add 1 bill', pg.inner_text('[data-import-add]'))
        check('Select all does NOT flip matched rows to Overwrite', (pg.click('[data-import-all]'), row(pg, 'Rent').locator('[data-r=act-keep]').get_attribute('aria-pressed'))[1] == 'true')
        before = pg.evaluate(STATE)
        res = done(pg); st = pg.evaluate(STATE)
        check('Keep mine: new row added, matched bills untouched, no copies', len(by(st, 'Rent')) == 1 and by(st, 'Rent')[0]['amount'] == 1450 and len(by(st, 'Internet')) == 1 and by(st, 'Internet')[0]['amount'] == 74.99 and len(by(st, 'Brand New Thing')) == 1 and len(st['bills']) == len(before['bills']) + 1, str(st['bills']))
        check('result says 3 of your bills were kept', '3 of your bills kept' in res and 'Added 1 bill' in res, res)
        check('no console errors', not logs, str(logs))

        print('[Overwrite one row: in place, id + history preserved, synced]')
        pg, logs = fresh(note=True)
        before = pg.evaluate(STATE); n0 = len(before['bills'])
        row(pg, 'Rent').locator('[data-r=act-overwrite]').click()
        check('picking Overwrite ticks the row and the button says Overwrite 1', row(pg, 'Rent').locator('[data-r=chk]').is_checked() and 'Overwrite 1' in pg.inner_text('[data-import-add]') and 'will overwrite' in pg.inner_text('[data-import-summary]'), pg.inner_text('[data-import-add]'))
        check('diff heading switches to "Overwrite will change"', 'Overwrite will change' in row(pg, 'Rent').locator('[data-r=diff]').inner_text())
        pg.click('[data-import-add]'); pg.wait_for_selector('[data-import-result]'); res = pg.inner_text('[data-import-result]')
        pg.wait_for_timeout(300); st = pg.evaluate(STATE); r = by(st, 'Rent')
        check('exactly one Rent still exists (no copy), same id demo-rent', len(r) == 1 and r[0]['id'] == 'demo-rent', str(r))
        check('amount updated to the spreadsheet value on the sync server', r and r[0]['amount'] == 1495.5, str(r))
        check('paid history, colour and category kept', r and r[0]['color'] == '#3ddc97' and r[0]['cat'] == 'Housing' and (r[0]['pa'] or {}).get(dd(1)) == 1450, str(r))
        check('only the new row was added: bill count +1, no duplicate of the overwritten bill', len(st['bills']) == n0 + 1 and len(by(st, 'Brand New Thing')) == 1, f"{n0} -> {len(st['bills'])}")
        check('result says one existing bill updated', 'updated 1 existing bill' in res.lower() or 'Updated 1 existing bill' in res, res)
        check('sync: nothing left pending, server holds the edit', pg.evaluate("async()=>{const {api}=await import('./js/api.js');return api.status.pending}") == 0)
        # an edit from the phone side still flows back to the overwritten bill (two-way)
        back = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const it=(await api.changes(0)).items.find(i=>i.id==='demo-rent');api.demo.phone('bill','demo-rent',{...it.data,amount:1500});await api.sync();return api.bills.list().find(x=>x.id==='demo-rent').amount}""")
        check('phone edit syncs back to the overwritten bill', back == 1500, back)
        check('no console errors', not logs, str(logs))

        print('[Mixed: overwrite Rent, keep Internet, row that matches exactly, plus a new row; notes preserved]')
        pg, logs = fresh(note=True)
        row(pg, 'Rent').locator('[data-r=act-overwrite]').click(); row(pg, 'Internet').locator('[data-r=act-keep]').click(); row(pg, 'Phone').locator('[data-r=act-overwrite]').click()
        check('Add button reads "Add 1 bill, Overwrite 2"', pg.inner_text('[data-import-add]').strip() == 'Add 1 bill, Overwrite 2', pg.inner_text('[data-import-add]'))
        res = done(pg); pg.wait_for_timeout(300); st = pg.evaluate(STATE)
        check('Rent overwritten, Internet kept, new added', by(st, 'Rent')[0]['amount'] == 1495.5 and by(st, 'Internet')[0]['amount'] == 74.99 and len(by(st, 'Brand New Thing')) == 1)
        check('Phone overwrite with identical values is a no-op (reported, not re-saved)', 'already matched' in res and by(st, 'Phone')[0]['amount'] == 65, res)
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill')
        loc = {x['name']: x for x in pg.evaluate(STATE)['local']}
        check('notes the file does not provide are preserved (Internet note intact)', loc['Internet']['notes'] == 'my own note')
        pg.click('[data-import=bills]')
        # now overwrite Internet too: spreadsheet has no notes/autopay columns, so those stay
        pg.wait_for_selector('[data-import-file]'); pg.set_input_files('[data-import-file]', CSV); pg.wait_for_selector('.imp-row')
        row(pg, 'Internet').locator('[data-r=act-overwrite]').click(); done(pg); pg.wait_for_timeout(300)
        loc = {x['name']: x for x in pg.evaluate(STATE)['local']}
        check('overwrite keeps notes (no notes column in file) and updates the amount', loc['Internet']['notes'] == 'my own note' and loc['Internet']['amount'] == 79.99, str(loc['Internet']))
        check('no console errors', not logs, str(logs))

        print('[shortcuts]')
        pg, logs = fresh()
        check('shortcut buttons are offered', pg.locator('[data-import-overwrite-all]').count() == 1 and pg.locator('[data-import-keep-all]').count() == 1)
        pg.click('[data-import-overwrite-all]')
        check('Overwrite all duplicates flips every matched row', all(row(pg, n).locator('[data-r=act-overwrite]').get_attribute('aria-pressed') == 'true' for n in ('Rent', 'Internet', 'Phone')) and 'Overwrite 3' in pg.inner_text('[data-import-add]'), pg.inner_text('[data-import-add]'))
        check('the new row is untouched by the shortcut (still ticked)', row(pg, 'New').locator('[data-r=chk]').is_checked())
        pg.click('[data-import-keep-all]')
        check('Keep all mine flips them back', all(row(pg, n).locator('[data-r=act-keep]').get_attribute('aria-pressed') == 'true' and not row(pg, n).locator('[data-r=chk]').is_checked() for n in ('Rent', 'Internet', 'Phone')) and pg.inner_text('[data-import-add]').strip() == 'Add 1 bill')
        pg.click('[data-import-overwrite-all]'); n0 = len(pg.evaluate(STATE)['bills']); pg.click('[data-import-none]')
        check('Select none resets Overwrite back to Keep mine', row(pg, 'Rent').locator('[data-r=act-keep]').get_attribute('aria-pressed') == 'true' and pg.is_disabled('[data-import-add]'))
        pg.click('[data-import-overwrite-all]'); res = done(pg); pg.wait_for_timeout(300); st = pg.evaluate(STATE)
        check('Overwrite all: Rent+Internet updated in place, new row was unticked so not added, no copies', by(st, 'Rent')[0]['amount'] == 1495.5 and by(st, 'Internet')[0]['amount'] == 79.99 and len(by(st, 'Rent')) == 1 and len(by(st, 'Internet')) == 1 and len(st['bills']) == n0 and len(by(st, 'Brand New Thing')) == 0, str(st['bills']))
        check('no console errors', not logs, str(logs))

        print('[checkbox and editing a row]')
        pg, logs = fresh()
        row(pg, 'Rent').locator('[data-r=chk]').check()
        check('ticking a matched row means Overwrite (never a copy)', row(pg, 'Rent').locator('[data-r=act-overwrite]').get_attribute('aria-pressed') == 'true')
        row(pg, 'Rent').locator('[data-r=name]').fill('Zebra Habitat'); pg.wait_for_timeout(100)
        check('renaming the row so it no longer matches turns it into a plain new bill (no overwrite controls) and is unticked rather than silently added', row(pg, 'Rent').locator('.imp-act').count() == 0 and not row(pg, 'Rent').locator('[data-r=chk]').is_checked())
        row(pg, 'Rent').locator('[data-r=name]').fill('Rent'); pg.wait_for_timeout(100)
        check('typing the name back shows the controls again, defaulting to Keep mine (safe)', row(pg, 'Rent').locator('.imp-act').count() == 1 and row(pg, 'Rent').locator('[data-r=act-keep]').get_attribute('aria-pressed') == 'true' and not row(pg, 'Rent').locator('[data-r=chk]').is_checked())

        print('[screens]')
        os.makedirs('/workspace/shots/import-overwrite', exist_ok=True)
        for (w, h, tag) in [(1280, 900, 'desktop'), (390, 844, 'mobile390')]:
            pg, logs = fresh(w, h)
            row(pg, 'Rent').locator('[data-r=act-overwrite]').click()
            pg.screenshot(path=f'/workspace/shots/import-overwrite/web-{tag}-preview.png')
            if tag == 'mobile390':
                over = pg.evaluate("document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.sheet-b').scrollWidth > document.querySelector('.sheet-b').clientWidth + 1")
                check('no horizontal overflow at 390px with the new controls', not over)
            pg.click('[data-import-overwrite-all]'); pg.screenshot(path=f'/workspace/shots/import-overwrite/web-{tag}-overwrite-all.png')
            pg.click('[data-import-add]'); pg.wait_for_selector('[data-import-result]'); pg.screenshot(path=f'/workspace/shots/import-overwrite/web-{tag}-result.png')
        b.close()
run()
print(f'\n{passes} checks passed, {len(fails)} failed'); [print('  FAILED:', f) for f in fails]
raise SystemExit(1 if fails else 0)
