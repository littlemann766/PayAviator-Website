#!/usr/bin/env python3
"""The cloud load-up shows at most once per browser session while clicking through every tab. DEMO mode, localhost only."""
import http.server, os, socketserver, threading, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
srv = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = f'http://localhost:{PORT}/app/'
fails = []; passes = 0
def check(n, c, x=''):
    global passes
    if c: passes += 1; print('  ok  ', n)
    else: fails.append(n); print('  FAIL', n, x)
VIS = "()=>{const b=document.getElementById('boot');return !!b&&getComputedStyle(b).display!=='none'&&getComputedStyle(b).opacity!=='0'}"
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page()
    pg.add_init_script("(()=>{window.__seen=0;const c=()=>{const b=document.getElementById('boot');if(b&&getComputedStyle(b).display!=='none')window.__seen=1};new MutationObserver(c).observe(document,{childList:true,subtree:true});document.addEventListener('DOMContentLoaded',c);})()")
    pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=8000); pg.wait_for_timeout(100)
    check('first load shows the cloud loader', pg.evaluate(VIS))
    pg.wait_for_function("()=>!document.getElementById('boot')", timeout=15000)
    check('flag set once app mounted', pg.evaluate("sessionStorage.getItem('pa_boot_seen')") == '1')
    shown = 0
    for name in ['calendar', 'bills', 'income', 'budget', 'accounts', 'settings', 'activity', 'index', 'bills']:
        with pg.expect_navigation():
            pg.evaluate(f"()=>{{const a=[...document.querySelectorAll('a[href]')].find(a=>/{name}\\.html/.test(a.getAttribute('href')));a?a.click():(location.href='{name}.html?demo=1')}}")
        pg.wait_for_timeout(50)
        shown += pg.evaluate("window.__seen")
        pg.wait_for_function("()=>!!document.querySelector('main')", timeout=15000)
        check(f'{name}: no loader after navigation in same session', pg.evaluate("window.__seen") == 0 and not pg.evaluate(VIS))
    check('loader shown 0 further times across all tabs', shown == 0)
    # new session (fresh context) shows it again
    ctx2 = br.new_context(); pg2 = ctx2.new_page(); pg2.goto(B + 'signin.html?demo=1'); pg2.wait_for_url('**/index.html', timeout=8000); pg2.wait_for_timeout(300)
    check('new session shows the loader again', pg2.evaluate(VIS))
    # storage blocked: falls back to showing it, no errors
    ctx3 = br.new_context(); pg3 = ctx3.new_page(); errs = []; pg3.on('pageerror', lambda e: errs.append(str(e)))
    pg3.add_init_script("Object.defineProperty(window,'sessionStorage',{get(){throw new Error('blocked')}})")
    pg3.route('**/js/pages/*.js', lambda r: r.abort()); pg3.goto(B + 'index.html'); pg3.wait_for_timeout(300)
    check('storage blocked: loader still shows, no crash', pg3.evaluate(VIS) and not errs, errs)
    br.close()
print(f'{passes} passed, {len(fails)} failed'); raise SystemExit(1 if fails else 0)
