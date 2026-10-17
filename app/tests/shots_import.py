#!/usr/bin/env python3
"""Screenshots of the spreadsheet import (desktop 1280 + mobile 390). Usage: python3 app/tests/shots_import.py [outdir]"""
import http.server, os, socketserver, sys, threading, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FX = os.path.join(os.path.dirname(__file__), 'import_fixtures')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/shots/import'; os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
srv = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{PORT}/app/'
with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in (('desktop', {'width': 1280, 'height': 860}), ('mobile', {'width': 390, 'height': 844})):
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if tag == 'mobile' else 1); pg = ctx.new_page()
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_selector('h1'); pg.goto(B + 'bills.html'); pg.wait_for_selector('.bill')
        pg.evaluate("sessionStorage.setItem('pa_view_month','2026-11')"); pg.goto(B + 'bills.html'); pg.wait_for_selector('.toolbar')
        pg.screenshot(path=f'{OUT}/web-{tag}-0-bills-entry.png')
        pg.click('[data-import=bills]'); pg.wait_for_selector('.imp-drop'); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/web-{tag}-1-file-pick.png')
        pg.set_input_files('[data-import-file]', os.path.join(FX, 'bills_typical.xlsx')); pg.wait_for_selector('.imp-row'); pg.wait_for_timeout(250)
        pg.screenshot(path=f'{OUT}/web-{tag}-2-preview-list.png')
        pg.locator('.imp-row').nth(3).scroll_into_view_if_needed(); pg.locator('.imp-row').nth(5).locator('[data-r=dest]').select_option('bills'); pg.locator('.imp-row').nth(5).locator('[data-r=chk]').check()
        pg.locator('.imp-row').nth(5).locator('[data-r=due]').fill(''); pg.wait_for_timeout(100)
        pg.locator('.imp-row').nth(5).scroll_into_view_if_needed(); pg.screenshot(path=f'{OUT}/web-{tag}-3-preview-needs-fix-and-duplicates.png')
        pg.locator('.imp-row').nth(5).locator('[data-r=chk]').uncheck(); pg.locator('.imp-row').nth(5).locator('[data-r=dest]').select_option('skip')
        pg.evaluate("document.querySelector('.sheet-b').scrollTop=0"); pg.click('[data-import-add]'); pg.wait_for_selector('[data-import-result]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/web-{tag}-4-result.png')
        pg.click('[data-import-done]'); pg.wait_for_selector('.bill'); pg.check('[data-show-paid]'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/web-{tag}-5-bills-after-import.png')
        pg.click('[data-import=bills]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'ambiguous.xlsx')); pg.wait_for_selector('[data-map=name]'); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/web-{tag}-6-column-mapping.png')
        pg.keyboard.press('Escape'); pg.click('[data-import=bills]'); pg.set_input_files('[data-import-file]', os.path.join(FX, 'old_format.xls')); pg.wait_for_selector('[data-import-error]:not([hidden])'); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/web-{tag}-7-old-xls-message.png')
        pg.keyboard.press('Escape'); pg.goto(B + 'settings.html'); pg.wait_for_selector('[data-act=import]'); pg.locator('[data-act=import]').scroll_into_view_if_needed()
        pg.screenshot(path=f'{OUT}/web-{tag}-8-settings-entry.png')
        ctx.close()
    b.close()
print(sorted(os.listdir(OUT)))
