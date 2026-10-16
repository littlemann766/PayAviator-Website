import functools, http.server, os, socketserver, threading, sys
from playwright.sync_api import sync_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..')); OUT='/workspace/shots/web-header'; os.makedirs(OUT,exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address=True; daemon_threads=True
s=TS(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); P=s.server_address[1]; threading.Thread(target=s.serve_forever,daemon=True).start()
bad=[]
with sync_playwright() as p:
    b=p.chromium.launch()
    for w in (320,360,390,430,768,900,1024,1100,1180,1181,1280,1440,1920):
        pg=b.new_page(viewport={'width':w,'height':800}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        for n in ('pricing','index','features','support'):
            pg.goto(f'http://localhost:{P}/{n}.html'); pg.wait_for_timeout(300)
            r=pg.evaluate("""()=>{const nl=document.querySelector('.navlinks'),mb=document.querySelector('.menu-btn');const menu=getComputedStyle(mb).display!=='none';
             const br=document.querySelector('.brand').getBoundingClientRect();const as=[...nl.querySelectorAll('a')];
             const wrap=as.some(a=>a.getBoundingClientRect().height>(menu?60:50));
             const rs=as.map(a=>a.getBoundingClientRect());const navr=document.querySelector('.nav').getBoundingClientRect();
             const hdr=document.querySelector('.site-header').getBoundingClientRect();
             return {menu,sw:document.documentElement.scrollWidth-innerWidth,hh:hdr.height,wrap,right:menu?0:Math.max(...rs.map(x=>x.right)),left:menu?999:Math.min(br.right,...[0]),gap:menu?99:rs[0].left-br.right,navr:navr.right,ov:as.some(a=>a.scrollWidth>a.clientWidth+1)}}""")
            if r['sw']>0 or r['wrap'] or r['ov'] or r['hh']>80 or (not r['menu'] and (r['right']>w-4 or r['gap']<8)) or errs: bad.append((w,n,r,errs))
        if w in (320,360,390,768,1280,1920):
            pg.goto(f'http://localhost:{P}/pricing.html'); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/header_{w}.png',clip={'x':0,'y':0,'width':w,'height':140})
            if pg.evaluate("getComputedStyle(document.querySelector('.menu-btn')).display")!='none':
                pg.click('.menu-btn'); pg.wait_for_timeout(400); pg.screenshot(path=f'{OUT}/menu_open_{w}.png')
        pg.close()
    b.close()
s.shutdown()
print('BAD',bad[:3]) if bad else print('header ok at all widths')
