#!/usr/bin/env python3
"""Screenshots for review (demo mode): python3 app/tests/shots.py  -> shots/webapp-build/<page>-<390|1280>.png"""
import functools, http.server, os, socketserver, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = os.path.join(ROOT, 'shots', 'webapp-build'); os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
s = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); P = s.server_address[1]; threading.Thread(target=s.serve_forever, daemon=True).start()
B = f'http://localhost:{P}/app/'
def full(pg, path):
    H = pg.evaluate('document.documentElement.scrollHeight'); w = pg.viewport_size['width']
    pg.set_viewport_size({'width': w, 'height': max(800, H)}); pg.evaluate("document.querySelectorAll('.tabs').forEach(t=>t.classList.add('shot'))"); pg.screenshot(path=path)
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in ((390, 844), (1280, 800)):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1)
        # sign-in: Firebase SDK is stubbed out so the normal form renders without network
        c0 = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1); q = c0.new_page()
        c0.route('https://www.gstatic.com/**', lambda r: r.abort()); q.goto(B + 'signin.html'); q.wait_for_selector('.si-card:not([aria-busy])', timeout=20000)
        q.screenshot(path=f'{OUT}/signin-{w}.png', full_page=True); c0.close()
        pg = c.new_page(); pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')
        for n, q_ in [('dashboard', 'index.html?bank=1'), ('bills', 'bills.html'), ('income', 'income.html'), ('budget', 'budget.html'), ('accounts', 'accounts.html?paused=1'), ('settings', 'settings.html')]:
            pg.goto(B + q_); pg.wait_for_selector('#main *'); pg.wait_for_timeout(600); full(pg, f'{OUT}/{n}-{w}.png')
            pg.set_viewport_size({'width': w, 'height': h})
        pg.goto(B + 'bills.html'); pg.wait_for_selector('[data-add=bill]'); pg.click('.bill >> nth=1'); pg.wait_for_selector('.sheet'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/panel-edit-bill-{w}.png')
        pg.keyboard.press('Escape'); pg.click('[data-add=bill]'); pg.locator('.sheet').get_by_role('button', name='Add bill').click(); pg.wait_for_timeout(200); pg.screenshot(path=f'{OUT}/panel-add-validation-{w}.png')
        c.close()
    b.close()
s.shutdown(); print(sorted(os.listdir(OUT)))
