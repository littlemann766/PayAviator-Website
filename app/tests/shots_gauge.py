#!/usr/bin/env python3
"""Gauge pager screenshots (demo): python3 app/tests/shots_gauge.py [outdir]"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/shots/web-gauge-swipe'; os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
s = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); P = s.server_address[1]; threading.Thread(target=s.serve_forever, daemon=True).start()
B = f'http://localhost:{P}/app/'
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (390, 1280):
        c = b.new_context(viewport={'width': w, 'height': 900 if w > 500 else 844}, device_scale_factor=2 if w < 500 else 1)
        pg = c.new_page(); pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html')
        pg.goto(B + 'index.html?bank=1'); pg.wait_for_selector('[data-g-dot]'); pg.wait_for_timeout(500)
        pg.locator('.hero-g').screenshot(path=f'{OUT}/gauge1_overall_{w}.png')
        pg.locator('.g-dot').nth(1).click(); pg.wait_for_timeout(900)
        pg.locator('.hero-g').screenshot(path=f'{OUT}/gauge2_account_{w}.png')
    b.close()
s.shutdown()
