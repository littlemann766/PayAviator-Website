#!/usr/bin/env python3
"""Calendar screenshots (demo mode) -> /workspace/shots/web-calendar (or argv[1]). 1440x900@2x and 390x844@2x."""
import functools, http.server, os, socketserver, sys, threading, datetime
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/shots/web-calendar'; os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
s = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); P = s.server_address[1]; threading.Thread(target=s.serve_forever, daemon=True).start()
B = f'http://localhost:{P}/app/'; day = datetime.date.today().replace(day=1) + datetime.timedelta(days=0)
d = datetime.date.today().isoformat()[:8] + '15'
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, n in ((1440, 900, 'desktop'), (390, 844, 'phone')):
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2); pg = c.new_page()
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html'); pg.goto(B + 'calendar.html'); pg.wait_for_selector('.cday'); pg.wait_for_timeout(500)
        pg.screenshot(path=f'{OUT}/calendar-month-{n}.png')
        pg.click(f'.cday[data-iso="{d}"]'); pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/calendar-selected-day-{n}.png', full_page=(n == 'phone'))
        pg.click('[data-add=bill-day]'); pg.wait_for_selector('.sheet'); pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/calendar-add-bill-{n}.png'); c.close()
    b.close()
s.shutdown(); print(sorted(os.listdir(OUT)))
