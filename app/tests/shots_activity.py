#!/usr/bin/env python3
"""Recent activity by range screenshots (demo mode): python3 app/tests/shots_activity.py [outdir]"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/shots/web-activity-range'; os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
s = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); P = s.server_address[1]; threading.Thread(target=s.serve_forever, daemon=True).start()
B = f'http://localhost:{P}/app/'
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in ((390, 844), (1280, 800)):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1)
        pg = c.new_page(); pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')
        pg.goto(B + 'index.html?bank=1'); pg.wait_for_selector('[data-act]')
        for r in ('week', 'month', 'year'):
            pg.click(f'.activity [data-act-range={r}]'); pg.wait_for_timeout(200)
            pg.locator('.activity.card').scroll_into_view_if_needed(); pg.locator('.activity.card').screenshot(path=f'{OUT}/home_activity_{r}_{w}.png')
        pg.goto(B + 'activity.html?bank=1&range=year'); pg.wait_for_selector('[data-act]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/view_all_{w}.png', full_page=True)
    b.close()
s.shutdown()
