#!/usr/bin/env python3
"""Founder / Aviator Elite screenshots (demo mode): python3 app/tests/shots_plans.py [outdir]"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'shots', 'plans'); os.makedirs(OUT, exist_ok=True)
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
        for k, q in (('elite', 'plan=comp'), ('founder', 'plan=comp&tier=founder')):
            for n in ('accounts', 'settings'):
                pg.goto(B + f'{n}.html?{q}'); pg.wait_for_selector('[data-plan-card]'); pg.wait_for_timeout(400)
                pg.screenshot(path=f'{OUT}/web_{n}_{k}_{w}.png')
    b.close()
s.shutdown()
