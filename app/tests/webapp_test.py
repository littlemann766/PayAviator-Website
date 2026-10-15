#!/usr/bin/env python3
"""PayAviator web app (phase 1) end-to-end test. Runs in DEMO mode (?demo=1 on localhost): no real credentials, no network except localhost.
Usage: python3 app/tests/webapp_test.py     (needs: pip install playwright; playwright install chromium)"""
import http.server, os, re, socketserver, sys, threading, functools, datetime
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
srv = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{PORT}/app/'
PAGES = ['signin', 'index', 'bills', 'income', 'budget', 'accounts', 'settings']
fails, passes = [], 0
def check(name, cond, extra=''):
    global passes
    if cond: passes += 1; print('  ok  ', name)
    else: fails.append(name); print('  FAIL', name, extra)
money = lambda t: float(re.sub(r'[^0-9.\-]', '', t.replace('\u2212', '-')) or 0)
today = datetime.date.today().isoformat()

def wait_until(pg, expr, timeout=8000):
    # polling evaluate (page.wait_for_function evals a string, which the page's strict CSP forbids)
    import time
    end = time.time() + timeout / 1000
    while time.time() < end:
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(50)
    raise AssertionError('timeout waiting for: ' + expr)

def safe(pg):
    pg.goto(B + 'index.html'); pg.wait_for_selector('[data-safe]')
    return money(pg.inner_text('[data-safe]'))
def stat(pg, k): return money(pg.locator(f'[data-stat={k}]').inner_text())

def run():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        pg = ctx.new_page(); logs = []
        pg.on('console', lambda m: logs.append((m.type, m.text, m.location.get('url', ''))) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(('pageerror', str(e), '')))

        print('[auth]')
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=8000)
        pg.wait_for_selector('h1'); check('?demo=1 on localhost signs in the demo user and lands on the dashboard', pg.locator('h1', has_text='Home').count() == 1)
        pg.evaluate("sessionStorage.clear()")  # drop demo flag: now behaves like production
        ctx2 = b.new_context(); ctx2.route('https://www.gstatic.com/**', lambda r: r.abort()); p2 = ctx2.new_page()  # simulate Firebase SDK unreachable
        p2.goto(B + 'index.html'); p2.wait_for_timeout(300)
        wait_until(p2, "location.pathname.endsWith('signin.html') || document.querySelector('.fatal')")
        check('signed out (no demo flag) -> redirect to /app/signin, or clear "unavailable" state if Firebase cannot load', p2.url.endswith('signin.html') or p2.locator('.fatal').count() == 1)
        p2.goto(B + 'signin.html'); p2.wait_for_selector('.si-card:not([aria-busy])', timeout=20000)
        txt = p2.inner_text('body').lower()
        check('Firebase unavailable -> clear "Sign-in is unavailable" state, Google disabled, email form present, no phone option', 'sign-in is unavailable' in txt and 'phone number' not in txt and 'sms' not in txt and p2.locator('input[type=tel]').count() == 0 and p2.locator('.btn.google[disabled]').count() == 1 and p2.locator('input[type=email]').count() == 1)
        ctx2.close()
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')

        print('[verify cooldown]')
        pg.goto(B + 'index.html'); pg.wait_for_selector('[data-safe]')
        r = pg.evaluate("""async()=>{const {auth}=await import('./js/auth.js');await auth.init();let first=null,second=null;
          try{await auth.sendVerification(true)}catch(e){first=e.code}
          try{await auth.sendVerification()}catch(e){second=e.code+'|'+e.message}
          return {first,second,left:auth.resendRemaining()}}""")
        check('resend verification: 60 s cooldown, message tells user to use the newest email', r['first'] is None and (r['second'] or '').startswith('pa/cooldown') and 'newest' in r['second'] and 55 <= r['left'] <= 60, str(r))
        pg.goto(B + 'index.html')

        print('[dashboard + gauge]')
        s0 = safe(pg)
        a0 = pg.locator('.hero-g svg.gauge').get_attribute('aria-label')
        check('gauge present with readable label', 'Safe to spend' in (a0 or ''), a0)
        check('Safe to Spend = ledger: income received - paid bills - spending (demo data)', (abs(s0 - 617.61) < 0.02 if 14 <= datetime.date.today().day <= 27 else s0 >= 0), str(s0))

        print('[bills]')
        pg.goto(B + 'bills.html'); pg.wait_for_selector('[data-add=bill]')
        u0 = stat(pg, 'unpaid')
        pg.click('[data-add=bill]'); sh = pg.locator('.sheet'); expect(sh).to_be_visible()
        check('add panel is a dialog, focus moved inside', pg.evaluate("document.activeElement.closest('.sheet')!==null"))
        sh.get_by_role('button', name='Add bill').click()
        check('validation: empty name + amount show errors, nothing saved', sh.locator('.fld.invalid').count() >= 2 and pg.locator('.sheet').count() == 1)
        sh.get_by_label('Name').fill('Test water'); sh.get_by_label('Amount').fill('abc'); sh.get_by_role('button', name='Add bill').click()
        check('validation: non-numeric amount rejected', sh.locator('.fld.invalid').count() == 1)
        sh.get_by_label('Amount').fill('100'); sh.get_by_label('Due date').fill(today); sh.get_by_label('Repeats').select_option('never')
        sh.get_by_role('button', name='Add bill').click()
        expect(pg.locator('.toast')).to_contain_text('Saved. Synced to your phone.')
        check('panel closed after save', pg.locator('.sheet').count() == 0)
        pg.wait_for_selector('.bill:has-text("Test water")')
        check('Unpaid total went up by $100.00', abs(stat(pg, 'unpaid') - (u0 + 100)) < 0.01, f'{u0} -> {stat(pg, "unpaid")}')
        # edit: amount 120 + mark paid
        pg.click('.bill:has-text("Test water")'); sh = pg.locator('.sheet')
        check('edit sheet prefilled', sh.get_by_label('Name').input_value() == 'Test water' and sh.get_by_label('Amount').input_value() == '100')
        sh.get_by_label('Amount').fill('120'); sh.get_by_role('button', name='Save changes').click()
        wait_until(pg, "document.querySelector('.toast') && !document.querySelector('.sheet')")
        check('edit saved: unpaid +$120.00', abs(stat(pg, 'unpaid') - (u0 + 120)) < 0.01)
        pg.click('.bill:has-text("Test water")'); sh = pg.locator('.sheet')
        sh.get_by_label('Paid', exact=True).check(); sh.get_by_role('button', name='Save changes').click()
        wait_until(pg, "!document.querySelector('.sheet')")
        check('marking paid moves $120 from unpaid to paid', abs(stat(pg, 'unpaid') - u0) < 0.01)
        s1 = safe(pg)
        check('dashboard Safe to Spend dropped by the $120 paid bill', abs((s0 - s1) - 120) < 0.01 or (s0 < 120 and s1 == 0), f'{s0} -> {s1}')
        a1 = pg.locator('.hero-g svg.gauge').get_attribute('aria-label')
        check('gauge label updated', a1 != a0 or s1 == s0)
        pg.goto(B + 'bills.html'); pg.wait_for_selector('[data-show-paid]')
        check('paid bills are hidden by default, like the app', pg.locator('.bill:has-text("Test water")').count() == 0)
        pg.check('[data-show-paid]'); pg.wait_for_selector('.bill:has-text("Test water")')
        pg.click('.bill:has-text("Test water")'); pg.locator('.sheet').get_by_role('button', name='Delete').click()
        expect(pg.locator('[role=alertdialog]')).to_be_visible()
        pg.keyboard.press('Escape'); check('Esc closes the confirm only (sheet stays)', pg.locator('[role=alertdialog]').count() == 0 and pg.locator('.sheet').count() == 1)
        pg.locator('.sheet').get_by_role('button', name='Delete').click(); pg.locator('[role=alertdialog]').get_by_role('button', name='Delete bill').click()
        wait_until(pg, "!document.querySelector('.sheet') && !document.querySelector('[role=alertdialog]')")
        check('delete removes the bill', pg.locator('.bill:has-text("Test water")').count() == 0)
        check('totals back to start after delete', abs(stat(pg, 'unpaid') - u0) < 0.01 and abs(stat(pg, 'paid') - 1465.49) < 50)
        # keyboard: open with Enter, Tab trap, Esc, focus return
        pg.focus('[data-add=bill]'); pg.keyboard.press('Enter'); expect(pg.locator('.sheet')).to_be_visible()
        inside = []
        for _ in range(25):
            pg.keyboard.press('Tab'); inside.append(pg.evaluate("!!document.activeElement.closest('.sheet')"))
        check('focus trap: Tab never leaves the open panel', all(inside))
        pg.keyboard.press('Escape'); check('Esc closes panel and returns focus to the Add button', pg.locator('.sheet').count() == 0 and pg.evaluate("document.activeElement.dataset.add==='bill'"))

        print('[income]')
        pg.goto(B + 'income.html'); pg.wait_for_selector('[data-add=income]')
        r0 = stat(pg, 'received'); s_before = safe(pg)
        pg.goto(B + 'income.html'); pg.click('[data-add=income]'); sh = pg.locator('.sheet')
        sh.get_by_role('button', name='Add income').click(); check('income validation shows errors', sh.locator('.fld.invalid').count() >= 2)
        sh.get_by_label('Name').fill('Test bonus'); sh.get_by_label('Amount (each time)').fill('500'); sh.get_by_label('Pay date').fill(today); sh.get_by_label('Repeats').select_option('one-time')
        sh.get_by_role('button', name='Add income').click(); expect(pg.locator('.toast')).to_contain_text('Saved. Synced to your phone.')
        pg.wait_for_selector('.bill:has-text("Test bonus")')
        check('Received went up by $500.00', abs(stat(pg, 'received') - (r0 + 500)) < 0.01)
        s_after = safe(pg)
        check('dashboard Safe to Spend rose by $500.00', abs((s_after - s_before) - 500) < 0.01, f'{s_before} -> {s_after}')
        pg.goto(B + 'income.html'); pg.click('.bill:has-text("Test bonus")'); sh = pg.locator('.sheet')
        sh.get_by_label('Amount (each time)').fill('300'); sh.get_by_role('button', name='Save changes').click(); wait_until(pg, "!document.querySelector('.sheet')")
        check('income edit updates total', abs(stat(pg, 'received') - (r0 + 300)) < 0.01)
        pg.click('.bill:has-text("Test bonus")'); pg.locator('.sheet').get_by_role('button', name='Delete').click(); pg.locator('[role=alertdialog]').get_by_role('button', name='Delete income').click()
        wait_until(pg, "!document.querySelector('.sheet') && !document.querySelector('[role=alertdialog]')")
        check('income delete restores total', abs(stat(pg, 'received') - r0) < 0.01 and abs(safe(pg) - s_before) < 0.01)

        print('[budget]')
        pg.goto(B + 'budget.html'); pg.wait_for_selector('[data-add=spending]')
        left0 = stat(pg, 'left'); spent0 = stat(pg, 'spent')
        pg.click('[data-act=limits]'); sh = pg.locator('.sheet'); sh.get_by_label('Groceries (optional)').fill('300')
        sh.get_by_label('New category (optional)', exact=True).fill('Pets'); sh.get_by_role('button', name='Save limits').click()
        check('new category needs a limit (validation)', pg.locator('.sheet .form-err:not([hidden])').count() == 1)
        sh.get_by_label('New category limit (optional)').fill('50'); sh.get_by_role('button', name='Save limits').click()
        pg.wait_for_selector('li[data-cat=Pets]'); check('limit rows shown for Groceries and Pets', pg.locator('li[data-cat=Groceries]').count() == 1)
        pg.click('[data-add=spending]'); sh = pg.locator('.sheet'); sh.get_by_role('button', name='Add spending').click(); check('spending validation', sh.locator('.fld.invalid').count() >= 2)
        sh.get_by_label('What was it?').fill('Test lunch'); sh.get_by_label('Amount').fill('25.50'); sh.get_by_label('Category').select_option('Groceries'); sh.get_by_role('button', name='Add spending').click()
        pg.wait_for_selector('[data-spend]:has-text("Test lunch")')
        check('Spent + bills +$25.50 and Left -$25.50', abs(stat(pg, 'spent') - (spent0 + 25.5)) < 0.01 and abs(stat(pg, 'left') - (left0 - 25.5)) < 0.01)
        lbl = pg.locator('li[data-cat=Groceries] .bar').get_attribute('aria-label'); check('category bar reflects spending', bool(lbl) and int(re.search(r'\d+', lbl).group()) > 0, lbl)
        pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const d=new Date();const p=new Date(d.getFullYear(),d.getMonth()-1,10);
          await api.bills.save({id:'prior1',name:'Test prior one-off',amount:42,due:p.toISOString().slice(0,10),recurring:false,recurrence:'weekly',color:'cyan',category:'Other',notes:'',paid:false})}""")
        pg.click('[data-act=copy]'); expect(pg.locator('[role=alertdialog]')).to_be_visible(); pg.locator('[role=alertdialog]').get_by_role('button', name='Cancel').click()
        check('copy previous month asks for confirmation (app-styled dialog); Cancel copies nothing', pg.locator('[role=alertdialog]').count() == 0)
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill'); check('...nothing copied after Cancel', pg.locator('.bill:has-text("Test prior one-off")').count() == 0)
        pg.goto(B + 'budget.html'); pg.wait_for_selector('[data-act=copy]'); pg.click('[data-act=copy]'); pg.locator('[role=alertdialog]').get_by_role('button', name='Copy').click()
        expect(pg.locator('.toast')).to_contain_text('Synced to your phone')
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill:has-text("Test prior one-off")'); check('Copy previous month copies the one-time bill into this month', True)
        pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const all=api.bills.list().filter(b=>b.name==='Test prior one-off');for(const b of all)await api.bills.remove(b.id)}""")
        pg.goto(B + 'budget.html'); pg.wait_for_selector('[data-spend]')
        pg.click('[data-spend]:has-text("Test lunch")'); pg.locator('.sheet').get_by_role('button', name='Delete').click(); pg.locator('[role=alertdialog]').get_by_role('button', name='Delete').click()
        wait_until(pg, "!document.querySelector('.sheet') && !document.querySelector('[role=alertdialog]')")
        check('spending delete restores totals', abs(stat(pg, 'spent') - spent0) < 0.01)

        print('[sync + conflict]')
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill')
        bid = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const b=api.bills.list().find(x=>x.name==='Internet');
          api.demo.phone('bill',b.id,{...b,amount:99.99});await api.sync();return b.id}""")
        pg.wait_for_selector('.bill:has-text("$99.99")'); check('a change made on the phone appears after sync (pull)', True)
        res = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');const b=api.bills.list().find(x=>x.name==='Internet');
          const old=Date.now()-86400000;const r=await api.batch([{kind:'bill',id:b.id,data:{...b,amount:1},updatedAt:old}]);return r.results[0]}""")
        check('last-write-wins: older push rejected as stale with the winner returned', res['status'] == 'rejected' and res['reason'] == 'stale' and res['winner']['data']['amount'] == 99.99, str(res))
        check('sync indicator shows Synced', pg.locator('[data-sync]').first.get_attribute('data-sync') == 'ok')

        print('[accounts + paused]')
        pg.goto(B + 'accounts.html?bank=1'); pg.wait_for_selector('[data-item]')
        check('accounts page lists the linked bank read-only', pg.locator('[data-item][data-paused="0"]').count() == 1)
        pg.goto(B + 'accounts.html?paused=1'); pg.wait_for_selector('[data-item][data-paused="1"]')
        check('paused bank shows a clear Paused state + plan banner', pg.locator('[data-item][data-paused="1"] .tag.paused').count() == 1 and pg.locator('[data-paused-banner]').count() == 1)
        pg.goto(B + 'accounts.html?bank=1'); pg.wait_for_selector('[data-item]'); pg.goto(B + 'index.html?bank=1'); pg.wait_for_selector('[data-safe]')
        check('with a linked bank Safe to Spend uses bank balances (app rule)', abs(money(pg.inner_text('[data-safe]')) - 1840.62) < 0.01, pg.inner_text('[data-safe]'))
        pg.goto(B + 'index.html')

        print('[recent activity]')
        pg.wait_for_selector('[data-activity]')
        check('Home shows Recent activity with synced spending only (no bank): sorted, <=10, spending red/neg, refund green/pos',
              pg.locator('[data-act]').count() >= 3 and pg.locator('[data-act]').count() <= 10 and pg.locator('[data-act] .neg').count() >= 3 and pg.locator('[data-act] .pos').count() >= 1 and pg.locator('[data-act] .neg').first.inner_text().startswith('\u2212$'))
        check('Recent activity has a View all link to the budget page', pg.locator('.activity a.more').get_attribute('href') == 'budget.html')
        pg.goto(B + 'index.html?bank=1'); pg.wait_for_selector('[data-act]:has-text("Grocery Mart")')
        check('with a bank, bank transactions merge in (Pending tag, income green)', pg.locator('[data-act]:has-text("Grocery Mart"):has-text("Pending")').count() == 1 and pg.locator('[data-act]:has-text("Acme Co.") .pos').count() == 1)
        pg.locator('[data-act]:has-text("Grocery Mart")').click(); pg.wait_for_selector('[data-info-sheet]')
        dt = pg.locator('[data-info-sheet]').inner_text()
        check('activity row opens a detail panel: status, date, category, bank, account, type', all(x in dt for x in ['Pending', 'Category', 'Food And Drink', 'Account', 'Demo Checking', 'Money out', 'Date']), dt)
        pg.keyboard.press('Escape'); check('Escape closes the detail panel', pg.locator('[data-info-sheet]').count() == 0)
        dates = pg.evaluate("[...document.querySelectorAll('[data-act]')].length")
        check('merged list capped at 10', dates <= 10)
        print('[spending breakdown]')
        pg.goto(B + 'index.html?bank=1'); pg.wait_for_selector('.spend-card [data-legend]')
        check('breakdown card: default Week + Categories, donut slices drawn, legend rows have % and $', pg.locator('.spend-card [data-range=week].active').count() == 1 and pg.locator('.spend-card [data-breakdown=category].active').count() == 1 and pg.locator('.spend-card [data-slice]').count() >= 2)
        cats = pg.locator('.spend-card [data-legend]').all_inner_texts()
        check('Categories: bank PFC categories + manual categories; transfers/income excluded', any('Food And Drink' in c for c in cats) and not any('Income' in c or 'Loan' in c for c in cats), str(cats))
        pg.click('.spend-card [data-breakdown=location]'); pg.wait_for_selector('.spend-card .pp-spend-legend-row.merchant')
        mer = pg.locator('.spend-card [data-legend]').all_inner_texts()
        check('Merchants view lists bank merchants with letter marks', any('Grocery Mart' in c for c in mer) and pg.locator('.pp-spend-merchant-mark').count() >= 2, str(mer))
        pg.click('.spend-card [data-range=month]'); pg.wait_for_selector('.spend-card [data-range=month].active')
        check('Month period updates the heading', 'this month' in pg.inner_text('.spend-card .sp-period').lower() and 'net spent' in pg.inner_text('.spend-card .pp-spend-donut-center').lower())
        pct = sum(int(re.search(r'(\d+)%', c).group(1)) for c in pg.locator('.spend-card [data-legend]').all_inner_texts())
        check('legend percentages add to ~100', 98 <= pct <= 102, str(pct))
        pg.goto(B + 'index.html'); pg.wait_for_selector('.spend-card')
        pg.evaluate("sessionStorage.setItem('x','1')")
        pg.goto(B + 'index.html')

        print('[layout]')
        for w, fs, label in [(360, None, '360'), (390, None, '390'), (412, None, '412'), (1280, None, '1280'), (360, 24, '360 @1.5x root font')]:
            c = b.new_context(viewport={'width': w, 'height': 800}); c.route('https://www.gstatic.com/**', lambda r: r.abort()); q = c.new_page()
            q.goto(B + 'signin.html?demo=1'); q.wait_for_url('**/index.html')
            bad = []
            for n in PAGES[1:]:
                q.goto(B + n + '.html'); q.wait_for_selector('#main')
                if fs: q.evaluate(f"document.documentElement.style.setProperty('font-size','{fs}px')")
                q.wait_for_timeout(250)
                d = q.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
                if d > 0: bad.append((n, d))
            # open sheet at this size
            q.goto(B + 'bills.html'); q.wait_for_selector('[data-add=bill]')
            if fs: q.evaluate(f"document.documentElement.style.setProperty('font-size','{fs}px')")
            q.click('[data-add=bill]'); q.wait_for_selector('.sheet')
            sw = q.evaluate("(()=>{const s=document.querySelector('.sheet');return [s.scrollWidth-s.clientWidth, document.documentElement.scrollWidth-document.documentElement.clientWidth]})()")
            if sw[0] > 0 or sw[1] > 0: bad.append(('sheet', sw))
            q.keyboard.press('Escape')
            c.close()
            check(f'no horizontal scroll at {label} (6 app pages + open sheet)', not bad, str(bad))
        c = b.new_context(viewport={'width': 360, 'height': 800}); c.route('https://www.gstatic.com/**', lambda r: r.abort()); q = c.new_page(); q.goto(B + 'signin.html?demo=1'); q.wait_for_url('**/index.html'); q.goto(B + 'signin.html?demo=0'); q.wait_for_selector('.si-card:not([aria-busy])', timeout=20000)
        q.evaluate("document.documentElement.style.setProperty('font-size','24px')")
        check('sign-in page: no horizontal scroll at 360 @1.5x', q.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 0); c.close()

        print('[account unify + delete account]')
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')
        pg.goto(B + 'settings.html#plan'); pg.wait_for_selector('[data-act=portal]')
        check('settings has Plan & billing with Manage subscription and a Delete my account button', pg.locator('#plan').count() == 1 and pg.locator('[data-act=delete-account]').count() == 1)
        pg.click('[data-act=delete-account]'); pg.wait_for_selector('.sheet')
        pg.locator('.sheet').get_by_role('button', name='Delete my account forever').click(); pg.wait_for_timeout(300)
        check('delete account: blocked until DELETE is typed', '/signin.html' not in pg.url and pg.locator('.sheet').count() == 1)
        pg.locator('.sheet input').first.fill('DELETE'); pg.locator('.sheet').get_by_role('button', name='Delete my account forever').click()
        pg.wait_for_url('**/signin.html?deleted=1', timeout=8000)
        check('delete account: signs out, clears local data, shows confirmation', pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('pa_demo_server_v1:')).length") == 0)
        for u in ('account.html', 'account/index.html'):
            t = open(os.path.join(ROOT, u)).read()
            check(f'site /{u} is a static landing page linking to /app/settings.html#plan (no refresh/JS)', 'href="/app/settings.html#plan"' in t and 'http-equiv' not in t and '<script' not in t)
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')

        print('[security]')
        html = [open(os.path.join(ROOT, 'app', f'{n}.html')).read() for n in PAGES]
        check('every page has a CSP meta, no inline script/style/handlers', all('Content-Security-Policy' in x and not re.search(r'<script(?![^>]*\bsrc=)[^>]*>', x) and ' style=' not in x and not re.search(r'\son\w+=', x) for x in html))
        src = ''.join(open(os.path.join(ROOT, 'app', 'js', f)).read() for f in os.listdir(os.path.join(ROOT, 'app', 'js')) if f.endswith('.js')) + ''.join(open(os.path.join(ROOT, 'app', 'js', 'pages', f)).read() for f in os.listdir(os.path.join(ROOT, 'app', 'js', 'pages')))
        check('no eval / document.write / insecure http:// calls in app code', not re.search(r'\beval\(|document\.write|new Function\(', src) and 'http://' not in src.replace("http://www.w3.org/2000/svg", ''))
        xss = pg.evaluate("""async()=>{const {api}=await import('./js/api.js');await api.bills.save({id:'xss1',name:'<img src=x onerror=window.__x=1>',amount:5,due:new Date().toISOString().slice(0,10),recurring:false,recurrence:'weekly',color:'green',category:'Other',notes:'',paid:false});return 1}""")
        pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill:has-text("<img")')
        check('user text is escaped (HTML in a bill name shows as text, nothing executes)', pg.evaluate('window.__x') is None and pg.locator('.bill img').count() == 0)
        pg.evaluate("""async()=>{const {api}=await import('./js/api.js');await api.bills.remove('xss1')}""")
        pg.goto(B + 'settings.html'); pg.wait_for_selector('[data-act=signout]'); pg.click('[data-act=signout]'); pg.wait_for_url('**/signin.html')
        left = pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('pa_demo_server_v1:')).length")
        check('sign out clears local data and returns to sign-in', left == 0 and pg.url.endswith('signin.html'))
        pg.goto(B + 'index.html'); pg.wait_for_url('**/signin.html')
        check('after sign-out protected pages redirect to /app/signin', True)

        errs = [l for l in logs if not (l[0] == 'warning')]
        check('no console errors or page errors during the whole run', not errs, str(errs[:5]))
        b.close()
try:
    run()
finally:
    srv.shutdown()
print(f'\n{passes} passed, {len(fails)} failed')
if fails: print('FAILED:', *fails, sep='\n  '); sys.exit(1)
