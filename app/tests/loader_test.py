#!/usr/bin/env python3
"""Web load-up screen + single sync status. DEMO mode, localhost only.
Usage: python3 app/tests/loader_test.py [screenshot_dir]"""
import http.server, os, socketserver, sys, threading, functools, re
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SH = sys.argv[1] if len(sys.argv) > 1 else None
if SH: os.makedirs(SH, exist_ok=True)
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
PAGES = ['index', 'calendar', 'bills', 'income', 'budget', 'accounts', 'settings', 'activity']
WIDTHS = [(360, 740), (390, 844), (768, 1024), (1280, 800), (1920, 1080)]
MET = "()=>{const b=document.getElementById('boot');if(!b)return null;const r=b.getBoundingClientRect(),d=document.documentElement;const cs=getComputedStyle(b);const clouds=[...b.querySelectorAll('.bl')].map(c=>c.getBoundingClientRect().width);const core=b.querySelector('.boot-core').getBoundingClientRect();const logo=b.querySelector('.boot-logo').getBoundingClientRect();return{w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,sw:d.scrollWidth,cw:d.clientWidth,pos:cs.position,anim:getComputedStyle(b.querySelector('.bl')).animationName,barAnim:getComputedStyle(b.querySelector('.boot-bar i')).animationName,clouds,coreL:core.left,coreR:core.right,coreT:core.top,coreB:core.bottom,logo:logo.width}}"
with sync_playwright() as p:
    br = p.chromium.launch()
    # 1. markup + CSP on every app page (the loader must not need inline styles/scripts)
    for pg_ in PAGES:
        t = open(os.path.join(ROOT, 'app', pg_ + '.html')).read()
        check(f'{pg_}: has load-up markup', 'id="boot"' in t and 'class="bl far"' in t and 'class="bl front"' in t)
        check(f'{pg_}: no inline style/script added for loader', 'style=' not in t and '<script>' not in t)
        check(f'{pg_}: css cache string bumped', re.search(r'app\.css\?v=\d{12}', t) is not None)
    # 2. loader visible while JS has not mounted; geometry per size
    for (w, h) in WIDTHS:
        ctx = br.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        csp = []; pg.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
        pg.route('**/js/pages/*.js', lambda r: r.abort())
        pg.goto(B + 'index.html?demo=1'); pg.wait_for_timeout(2800)
        m = pg.evaluate(MET)
        check(f'{w}: loader covers the viewport', m and m['pos'] == 'fixed' and abs(m['w'] - w) < 1 and abs(m['h'] - h) < 1, m)
        check(f'{w}: no horizontal scroll', m and m['sw'] <= m['cw'], m)
        check(f'{w}: content inside the screen', m and m['coreL'] >= 0 and m['coreR'] <= w and m['coreT'] >= 0 and m['coreB'] <= h, m)
        check(f'{w}: logo size sensible (84..132)', m and 83 <= m['logo'] <= 133, m)
        check(f'{w}: clouds + bar animate', m and m['anim'] == 'bootfly' and m['barAnim'] == 'bootbar', m)
        co = pg.evaluate("()=>[...document.querySelectorAll('.bl')].map(c=>{const s=getComputedStyle(c);return [c.className.replace('bl ',''),parseFloat(s.animationDuration),c.getBoundingClientRect().height,c.getBoundingClientRect().width,s.backgroundImage.split('radial-gradient').length-1]})")
        check(f'{w}: five cloud depth layers (far, mist, mid, near, front)', [c[0] for c in co] == ['far', 'mist', 'mid', 'near', 'front'], co)
        check(f'{w}: layers drift at different speeds (parallax, far slowest)', len(set(c[1] for c in co)) == 5 and co[0][1] > co[2][1] > co[3][1] > co[4][1], co)
        check(f'{w}: every layer is a seamless wide tile (wider than the screen) with many soft puffs', all(c[3] > w and c[4] >= 15 for c in co), co)
        check(f'{w}: layers are tall enough to fill sky (>= w/4 each)', all(c[2] >= w / 4 - 1 for c in co), co)
        vl = pg.evaluate("()=>[getComputedStyle(document.querySelector('.boot-veil')).animationName,getComputedStyle(document.querySelector('.boot-logo')).animationName]")
        check(f'{w}: logo emerges from a clearing cloud veil', vl == ['bootclear', 'bootemerge'], vl)
        tr = pg.evaluate("()=>[...document.querySelectorAll('.bl')].every(c=>!/(?<!-)filter/.test(c.getAttribute('style')||'')&&getComputedStyle(c).filter==='none')")
        check(f'{w}: cloud layers use transform-only animation (no filter/paint cost)', tr)
        check(f'{w}: no CSP violations from the loader', not csp, csp)
        if SH: pg.screenshot(path=f'{SH}/web-loading-{w}.png')
        ctx.close()
    # 3. reduced motion: nothing animates
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce'); pg = ctx.new_page()
    pg.route('**/js/pages/*.js', lambda r: r.abort()); pg.goto(B + 'index.html?demo=1'); pg.wait_for_timeout(500)
    m = pg.evaluate(MET)
    check('reduced motion: clouds, veil, logo and bar are still', m and m['anim'] == 'none' and m['barAnim'] == 'none' and pg.evaluate("[getComputedStyle(document.querySelector('.boot-veil')).animationName,getComputedStyle(document.querySelector('.boot-logo')).animationName].join()") == 'none,none', m)
    if SH: pg.screenshot(path=f'{SH}/web-loading-390-reduced-motion.png')
    ctx.close()
    # 4. slow-load fallback text switches after 15 s (CSS only): at t=0 first message visible
    ctx = br.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page()
    pg.route('**/js/pages/*.js', lambda r: r.abort()); pg.goto(B + 'index.html?demo=1'); pg.wait_for_timeout(300)
    o = pg.evaluate("()=>[getComputedStyle(document.querySelector('.boot-msg .m1')).opacity,getComputedStyle(document.querySelector('.boot-msg .m2')).opacity]")
    check('status line starts on "Getting things ready"', o[0] == '1' and o[1] == '0', o)
    ctx.close()
    # 5. normal load: loader goes away, app is usable, one sync status only, no "Signed in" duplicate
    for (w, h) in WIDTHS:
        ctx = br.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page()
        pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=15000); pg.wait_for_selector('.content', timeout=15000)
        end = 0
        while pg.evaluate("!!document.getElementById('boot')") and end < 60: pg.wait_for_timeout(100); end += 1
        check(f'{w}: load-up removed after the app mounts', not pg.evaluate("!!document.getElementById('boot')"))
        vis = pg.evaluate("()=>[...document.querySelectorAll('.sync')].filter(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'}).length")
        check(f'{w}: exactly one sync status visible', vis == 1, vis)
        txt = pg.evaluate("document.body.innerText")
        check(f'{w}: no separate "Signed in" label', 'Signed in' not in txt)
        check(f'{w}: still no horizontal scroll', pg.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"))
        if SH and w in (360, 390, 768, 1280): pg.screenshot(path=f'{SH}/web-status-{w}.png')
        ctx.close()
    # 6. signed-in (non-demo-style) sidebar shows the account email only, no status pill
    ctx = br.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page()
    pg.goto(B + 'signin.html?demo=1'); pg.wait_for_url('**/index.html', timeout=15000); pg.wait_for_selector('.side-foot', timeout=15000)
    check('sidebar footer holds no sync pill', pg.evaluate("document.querySelectorAll('.side-foot .sync').length") == 0)
    check('header keeps the sync pill', pg.evaluate("document.querySelectorAll('.top .sync').length") == 1)
    ctx.close(); br.close()
print(f'{passes} passed, {len(fails)} failed'); sys.exit(1 if fails else 0)
