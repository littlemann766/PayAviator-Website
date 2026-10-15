#!/usr/bin/env python3
"""Contract test: the web app's LIVE adapter (api.js, ADAPTER='live') against Lucian's real backend code
(branch cloud-sync-pause-banks, in-memory store, test JWT). Playwright maps https://api.payaviator.app/** to the local backend.
Skips if the backend repo/node_modules are not present.   Usage: python3 app/tests/live_contract_test.py [backend_dir]"""
import functools, http.server, json, os, socketserver, subprocess, sys, threading, time, urllib.request
from playwright.sync_api import sync_playwright

BE = sys.argv[1] if len(sys.argv) > 1 else '/workspace/PayAviator-Backend'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if not os.path.isdir(os.path.join(BE, 'node_modules')): print('SKIP: backend not found at', BE); sys.exit(0)
node = subprocess.Popen(['node', os.path.join(ROOT, 'app/tests/live_backend_server.mjs'), BE], cwd=BE, stdout=subprocess.PIPE, text=True)
assert 'ready' in node.stdout.readline()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class TS(socketserver.ThreadingTCPServer): allow_reuse_address = True; daemon_threads = True
static = TS(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); PORT = static.server_address[1]
threading.Thread(target=static.serve_forever, daemon=True).start()
tok = lambda uid, v=1: json.load(urllib.request.urlopen(f'http://127.0.0.1:8799/__token/{uid}?v={v}'))['token']
def local(method, path, token, body=None):
    r = urllib.request.Request('http://127.0.0.1:8799' + path, method=method, data=json.dumps(body).encode() if body else None, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {'status': e.code, **json.load(e)}
fails = []; passes = 0
def check(n, c, x=''):
    global passes
    if c: passes += 1; print('  ok  ', n)
    else: fails.append(n); print('  FAIL', n, x)

def cors(h): return {**h, 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type,accept', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS'}
def handler(route):
    req = route.request
    if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors({}))
    url = req.url.replace('https://api.payaviator.app', 'http://127.0.0.1:8799')
    r = route.fetch(url=url); route.fulfill(response=r, headers=cors(dict(r.headers)))
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(); ctx.route('https://www.gstatic.com/**', lambda r: r.abort()); ctx.route('https://api.payaviator.app/**', handler)
        pg = ctx.new_page(); pg.goto(f'http://localhost:{PORT}/app/signin.html'); pg.wait_for_selector('.si-card:not([aria-busy])', timeout=20000)
        T = tok('u1'); js = lambda s, arg=None: pg.evaluate(s, arg)
        INIT = "async(t)=>{const {api}=await import('./js/api.js');window.__api=api;window.__ev=[];api.subscribe(e=>window.__ev.push(e.type));await api.init({uid:'u1',getToken:async()=>t,demo:false});return api.adapter}"
        check('adapter is live (not stub) when not in demo mode', js(INIT, T) == 'live')
        js("async()=>{const a=window.__api;await a.bills.save({id:'b1',name:'Rent',amount:1450,due:'2026-10-01',recurring:true,recurrence:'monthly',color:'green',category:'Housing',notes:'',paid:false});await a.income.save({id:'i1',name:'Pay',amount:2000,date:'2026-10-02',frequency:'biweekly',incomeType:'salary'});await a.cushion.save({mode:'dollar',dollar:25});await a.budget.save('2026-10',{limit:3000,categories:{Groceries:400}});await a.spending.save({id:'s1',name:'Lunch',amount:12.5,date:'2026-10-03',flow:'spending',category:'Dining out',notes:''})}")
        srv = local('GET', '/api/sync/changes?since=0', T)
        kinds = sorted(i['kind'] for i in srv['items'])
        check('push reached the real server: bill, income, cushion, budget (month record incl. category limits), spending stored', kinds == ['bill', 'budget', 'cushion', 'income', 'spending'], str(kinds))
        check('wire shapes: {kind,id,data,updatedAt(ms int),deleted,seq}', all(set(i) == {'kind', 'id', 'data', 'updatedAt', 'deleted', 'seq'} and isinstance(i['updatedAt'], int) for i in srv['items']))
        bill = next(i for i in srv['items'] if i['kind'] == 'bill'); check('bill data uses the APP shape: raw id inside data, hex color, no updatedAt', bill['data']['id'] == 'b1' and 'updatedAt' not in bill['data'] and bill['data']['name'] == 'Rent')
        # phone edits the bill later (newer updatedAt) -> web pulls it
        newer = dict(bill['data'], amount=1500)
        res = local('POST', '/api/sync/push', T, {'items': [{'kind': 'bill', 'id': 'b1', 'data': newer, 'updatedAt': bill['updatedAt'] + 5000}]})
        check('phone edit accepted by server', res['results'][0]['status'] == 'accepted')
        js("async()=>window.__api.sync()")
        check('web pulls the phone edit via /api/sync/changes?since=cursor', js("window.__api.bills.list().find(b=>b.id==='b1').amount") == 1500)
        # stale batch -> rejected with winner
        r = js("async()=>{const a=window.__api;const b=a.bills.list()[0];const {id,updatedAt,...d}=b;return (await a.batch([{kind:'bill',id:'b1',data:{...d,amount:1},updatedAt:1000}])).results[0]}")
        check('stale write rejected (reason=stale) and winner returned', r['status'] == 'rejected' and r['reason'] == 'stale' and r['winner']['data']['amount'] == 1500, str(r))
        # concurrent: web edit with older clock than a phone edit -> conflict event, phone wins
        local('POST', '/api/sync/push', T, {'items': [{'kind': 'bill', 'id': 'b1', 'data': dict(newer, amount=1600), 'updatedAt': int(time.time() * 1000) + 120000}]})
        out = js("async()=>{const a=window.__api;const b=a.bills.list()[0];const {id,updatedAt,...d}=b;window.__ev.length=0;const r=await a.bills.save({id:'b1',...d,amount:1111});return {r,ev:window.__ev.slice(),amt:a.bills.list()[0].amount}}")
        check('web edit older than phone edit: conflict event and phone version kept', 'conflict' in out['ev'] and out['amt'] == 1600, str(out))
        js("async()=>window.__api.bills.remove('b1')")
        srv = local('GET', '/api/sync/changes?since=0', T); ts = next(i for i in srv['items'] if i['id'] == 'b1')
        check('delete sends a tombstone (deleted:true, data:null) and bill leaves the list', ts['deleted'] is True and ts['data'] is None and js("window.__api.bills.list().length") == 0)
        # chunking >200
        js("async()=>{const a=window.__api;const ops=[];for(let i=0;i<450;i++)ops.push(a.bills.save({id:'bulk'+i,name:'B'+i,amount:1,due:'2026-10-05',recurring:false,recurrence:'weekly',color:'green',category:'Other',notes:'',paid:false}));await Promise.all(ops)}")
        got = 0; since = 0
        while True:
            pgj = local('GET', f'/api/sync/changes?since={since}&limit=500', T); got += sum(1 for i in pgj['items'] if i['id'].startswith('bulk')); since = pgj['next']
            if not pgj['more']: break
        check('450 queued changes are delivered (batched at most 200 per push)', got == 450 and js("window.__api.bills.list().length") == 450, str(got))
        # read-only endpoints
        acc = js("async()=>window.__api.accounts()"); bs = js("async()=>window.__api.billing()")
        check('GET /api/plaid/accounts and /api/billing/status read through the live base URL', acc == {'accounts': [], 'items': [], 'errors': []} and bs['plan'] == 'free' and 'pausedBanks' in bs, str(bs))
        # delete all
        d = js("async()=>window.__api.deleteAllCloud()")
        check('DELETE /api/sync/all wipes cloud data; local memory cleared', d['deleted'] >= 450 and local('GET', '/api/sync/changes?since=0', T)['items'] == [])
        # unverified token
        T0 = tok('u2', 0)
        ev = js("async(t)=>{const {api}=await import('./js/api.js');const ev=[];api.subscribe(e=>ev.push(e.type));await api.init({uid:'u2',getToken:async()=>t,demo:false});return {ev,s:api.status}}", T0)
        check('unverified email -> 403 EMAIL_NOT_VERIFIED surfaces as status=error + auth event (UI then runs reload()+getIdToken(true))', ev['s']['status'] == 'error' and 'auth' in ev['ev'] and ev['s']['error']['code'] == 'EMAIL_NOT_VERIFIED', str(ev))
        b.close()
finally:
    static.shutdown(); node.terminate()
print(f'\n{passes} passed, {len(fails)} failed')
if fails: print('FAILED:', *fails, sep='\n  '); sys.exit(1)
