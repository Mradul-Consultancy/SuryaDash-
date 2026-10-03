"""
Integration tests against a MOCK Firebase backend (no network, no real project needed).

The mock enforces the same access model as firebase-config/database.rules.json:
  - every /sites and /users read/write needs a valid ?auth= token
  - reading the whole site node (/sites/{id}.json) is DENIED
  - writing /sites/{id}/pump.json is DENIED (only /controls/pump is allowed)
So these tests fail if the dashboard ever goes back to talking to Firebase in a way the rules forbid.
"""
import os, sys, json, time, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
import build_preview

PREVIEW = build_preview.build()
URL = 'file://' + PREVIEW
fails = []
def check(name, ok, detail=''):
    print(('  ✔ ' if ok else '  ✘ ') + name + (f'  [{detail}]' if detail and not ok else ''))
    if not ok: fails.append(name)

TOKENS = {'TOKEN123': 'uid1', 'TOKEN456': 'uid2'}
def cors(extra=None):
    h = {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,PATCH,DELETE,OPTIONS',
         'access-control-allow-headers': '*', 'content-type': 'application/json'}
    h.update(extra or {}); return h

class Backend:
    """In-memory RTDB that mirrors firebase-config/database.rules.json (same read/write conditions)."""
    def __init__(self, legacy=None, legacy_mode=False, deny_writes=False):
        self.legacy_mode, self.legacy, self.deny_writes = legacy_mode, legacy, deny_writes
        self.db = {'sites': {'site_a': {
                        'meta': {'owner': 'uid1', 'name': 'Rooftop Collector', 'createdAt': 1},
                        'sensors': {'T1': 51.2, 'T2': 33.4, 'T3': 71.0, 'T4': 48.9, 'F1': 2.4, 'F2': 2.3},
                        'controls': {'power': True, 'solenoid': True, 'pump': False, 'lamp': False}}},
                   'users': {'uid1': {'sites': {'site_a': True}}}}
        self.log, self.denied = [], []

    # -- helpers --
    def get(self, parts):
        n = self.db
        for k in parts:
            if not isinstance(n, dict) or k not in n: return None
            n = n[k]
        return n
    def put(self, parts, value):
        n = self.db
        for k in parts[:-1]: n = n.setdefault(k, {})
        n[parts[-1]] = value

    def can(self, method, parts, uid, body):
        if uid is None: return False
        write = method in ('PUT', 'PATCH', 'DELETE')
        if write and self.deny_writes: return False
        if parts[0] == 'users': return len(parts) >= 2 and parts[1] == uid
        if parts[0] == 'sites' and len(parts) >= 3:
            site = self.db['sites'].get(parts[1]); node = parts[2]
            owner  = bool(site) and site.get('meta', {}).get('owner') == uid
            member = bool(site) and uid in site.get('members', {})
            device = bool(site) and uid in site.get('devices', {})
            if node == 'meta':
                if not write: return owner or member
                creating = (not site or 'meta' not in site) and isinstance(body, dict) and body.get('owner') == uid
                return creating or owner
            if node == 'sensors':  return (owner or member) if not write else (owner or device)
            if node == 'controls': return (owner or member or device) if not write else (owner or member)
        return False

    def rtdb(self, route):
        req = route.request; u = urlparse(req.url); q = parse_qs(u.query); path = u.path
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors())
        self.log.append((time.time(), req.method, path))
        ok   = lambda b: route.fulfill(status=200, headers=cors(), body=json.dumps(b))
        def deny():
            self.denied.append((req.method, path)); route.fulfill(status=401, headers=cors(), body='{"error":"Permission denied"}')
        if self.legacy_mode:
            if u.hostname != 'solar-thermal-e-harvesting-default-rtdb.firebaseio.com' or not path.startswith('/'):
                return route.fulfill(status=404, headers=cors(), body='bad url')     # malformed URLs must fail loudly
            return ok(self.legacy if (path == '/.json' and req.method == 'GET') else None)
        if not path.endswith('.json'): return deny()
        parts = [x for x in path[:-5].split('/') if x]
        uid = TOKENS.get(q.get('auth', [''])[0])
        body = json.loads(req.post_data) if req.post_data else None
        if not parts or not self.can(req.method, parts, uid, body): return deny()
        if req.method == 'GET': return ok(self.get(parts))
        if req.method in ('PUT', 'PATCH'): self.put(parts, body); return ok(body)
        return deny()

    def auth(self, route):
        req = route.request
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors())
        body = json.loads(req.post_data or '{}'); signup = 'accounts:signUp' in req.url
        if body.get('email') == 'bad@x.com':
            return route.fulfill(status=400, headers=cors(), body='{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}')
        tok, uid = ('TOKEN456', 'uid2') if signup else ('TOKEN123', 'uid1')
        route.fulfill(status=200, headers=cors(), body=json.dumps(
            {'idToken': tok, 'refreshToken': 'R', 'localId': uid, 'email': body.get('email'), 'expiresIn': '3600'}))

    def attach(self, ctx):
        ctx.route(re.compile(r'firebaseio\.com'), self.rtdb)
        ctx.route(re.compile(r'identitytoolkit\.googleapis\.com'), self.auth)
        ctx.route(re.compile(r'cdnjs\.cloudflare|fonts\.g|googletagmanager'), lambda r: r.abort())

def val(pg, sel): return pg.inner_text(sel).strip()
def enter_key_and_sign_in(pg, email='me@x.com'):
    pg.click('text=Configure Firebase Web API Key'); pg.fill('#auth-apikey', 'AIzaFAKEKEY'); pg.click('text=Save Key')
    pg.fill('#auth-email', email); pg.fill('#auth-pass', 'secret123'); pg.click('#btn-signin')

with sync_playwright() as p:
    br = p.chromium.launch()

    # ───────────────────────── A. first-time login → multi-site → live → control ─────────────────────────
    print('\n[A] Sign in, multi-site, live data, control toggle]')
    be = Backend(); ctx = br.new_context(viewport={'width': 1300, 'height': 850}); be.attach(ctx)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(300)
    enter_key_and_sign_in(pg)                      # key was NOT saved before → exercises first-run wiring
    try: pg.wait_for_selector('#app-root', state='visible', timeout=6000); shown = True
    except Exception: shown = False
    check('first-run login (key entered at runtime) opens the dashboard', shown)
    try: pg.wait_for_function("document.getElementById('pill-txt').textContent==='LIVE'", timeout=6000); live = True
    except Exception: live = False
    check('header shows LIVE once real data arrives', live)
    check('site switcher lists the user\'s site', 'Rooftop Collector' in pg.inner_text('#site-switcher'))
    check('signed-in email shown', 'me@x.com' in val(pg, '#user-email-display'))
    pg.evaluate("switchTab('settings')"); pg.wait_for_timeout(200)
    check('Settings → Active Site shows the Site ID for the firmware', pg.input_value('#set-site-id') == 'site_a' and pg.is_visible('#site-info-section'))
    check('Settings → Active Site shows the site name', pg.input_value('#set-site-name') == 'Rooftop Collector')
    pg.evaluate("switchTab('dashboard')")
    check('T1 shows the value from Firebase (51.2)', val(pg, '#v-T1') == '51.2', val(pg, '#v-T1'))
    check('F1 shows the value from Firebase (2.40)', val(pg, '#v-F1') == '2.40', val(pg, '#v-F1'))
    check('solenoid card ON / pump card OFF from controls', val(pg, '#s-sol') == 'ON' and val(pg, '#s-pump') == 'OFF')
    paths = [x[2] for x in be.log]
    check('never requests the whole site node (rules forbid it)', '/sites/site_a.json' not in paths)
    check('reads /sensors and /controls separately', '/sites/site_a/sensors.json' in paths and '/sites/site_a/controls.json' in paths)

    pg.click('#c-pump')
    try: pg.wait_for_function("document.getElementById('s-pump').textContent==='ON'", timeout=6000); toggled = True
    except Exception: toggled = False
    writes = [(m, x) for _, m, x in be.log if m == 'PUT']
    check('pump state persisted in the database', be.db['sites']['site_a']['controls']['pump'] is True)
    check('no request was ever denied by the rules during normal use', not be.denied, str(be.denied))
    check('pump toggle PUTs to /controls/pump (allowed path)', ('PUT', '/sites/site_a/controls/pump.json') in writes, str(writes))
    check('pump toggle never PUTs to /sites/{id}/pump (denied path)', ('PUT', '/sites/site_a/pump.json') not in writes)
    check('pump card turns ON after the write round-trips', toggled)

    t0 = time.time(); n0 = len([1 for t, m, x in be.log if x.endswith('/sensors.json')])
    pg.wait_for_timeout(6000)
    n = len([1 for t, m, x in be.log if x.endswith('/sensors.json')]) - n0
    check('single polling timer (≈3 polls in 6s at 2s interval, not ≈6)', 2 <= n <= 4, f'{n} polls')

    pg.reload(); 
    try: pg.wait_for_function("document.getElementById('pill-txt').textContent==='LIVE'", timeout=7000); restored = True
    except Exception: restored = False
    check('session restored after reload (no login screen)', restored and not pg.is_visible('#auth-gate'))
    pg.click('button[aria-label="Sign out"]'); pg.wait_for_timeout(300)
    check('sign out returns to the login screen', pg.is_visible('#auth-gate'))
    pg.fill('#auth-email', 'me@x.com'); pg.fill('#auth-pass', 'secret123'); pg.click('#btn-signin')
    try: pg.wait_for_function("document.getElementById('pill-txt').textContent==='LIVE'", timeout=7000); again = True
    except Exception: again = False
    check('can sign back in after signing out', again)
    check('no page JS errors across the whole flow', not errs, str(errs))
    ctx.close()

    # ───────────────────────── B. bad credentials → readable message ─────────────────────────
    print('\n[B] Bad credentials]')
    be = Backend(); ctx = br.new_context(); be.attach(ctx); pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(300)
    enter_key_and_sign_in(pg, 'bad@x.com'); pg.wait_for_timeout(600)
    msg = val(pg, '#auth-error')
    check('shows "Incorrect email or password."', msg == 'Incorrect email or password.', msg)
    check('raw Firebase error code is not shown', 'INVALID_LOGIN' not in msg)
    check('login screen stays up', pg.is_visible('#auth-gate'))
    ctx.close()

    # ───────────────────────── C. connected but empty database ─────────────────────────
    print('\n[C] Connected to an EMPTY database (legacy/flat mode)]')
    be = Backend(legacy=None, legacy_mode=True); ctx = br.new_context(); be.attach(ctx); pg = ctx.new_page(); pg.goto(URL)
    pg.wait_for_timeout(300); pg.click('text=Skip login'); pg.wait_for_timeout(2500)
    check('badge says CONNECTED · NO DATA', 'NO DATA' in val(pg, '#fb-txt') and 'CONNECTED' in val(pg, '#fb-txt'), val(pg, '#fb-txt'))
    check('pill is DEMO (not LIVE) while showing simulated data', val(pg, '#pill-txt') == 'DEMO')
    pg.wait_for_timeout(5000)
    check('simulated values appear after fallback delay', re.match(r'^[\d.]+$', val(pg, '#v-T1')) is not None, val(pg, '#v-T1'))
    check('pill still DEMO once simulation is running', val(pg, '#pill-txt') == 'DEMO')
    ctx.close()

    # ───────────────────────── D. legacy flat database WITH data ─────────────────────────
    print('\n[D] Legacy flat database with real data]')
    flat = {'T1': 44.4, 'T2': 30.1, 'T3': 66.6, 'T4': 45.5, 'F1': 1.9, 'F2': 1.8, 'power': True, 'pump': True}
    be = Backend(legacy=flat, legacy_mode=True); ctx = br.new_context(); be.attach(ctx); pg = ctx.new_page(); pg.goto(URL)
    pg.wait_for_timeout(300); pg.click('text=Skip login')
    try: pg.wait_for_function("document.getElementById('pill-txt').textContent==='LIVE'", timeout=6000); live = True
    except Exception: live = False
    check('LIVE with flat schema', live)
    check('T1 = 44.4 from flat root', val(pg, '#v-T1') == '44.4', val(pg, '#v-T1'))
    check('badge has no "NO DATA" note', 'NO DATA' not in val(pg, '#fb-txt'))
    ctx.close(); br.close()

    # ───────────────────────── E. brand-new account → first site is created under the rules ─────────────────────────
    print('\n[E] Sign up → first site created]')
    br2 = p.chromium.launch()
    be = Backend(); ctx = br2.new_context(viewport={'width': 1300, 'height': 850}); be.attach(ctx)
    pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(300)
    pg.click('text=Configure Firebase Web API Key'); pg.fill('#auth-apikey', 'AIzaFAKEKEY'); pg.click('text=Save Key')
    pg.fill('#auth-email', 'new@x.com'); pg.fill('#auth-pass', 'secret123'); pg.click('#btn-signup')
    try: pg.wait_for_selector('#welcome-overlay', state='visible', timeout=7000); welcome = True
    except Exception: welcome = False
    check('welcome overlay shown after sign-up', welcome)
    pg.wait_for_timeout(1500)
    mine = be.db['users'].get('uid2', {}).get('sites', {})
    check('user index /users/uid2/sites/{id} written', len(mine) == 1, str(mine))
    sid = next(iter(mine), None)
    site = be.db['sites'].get(sid, {}) if sid else {}
    check('site meta.owner is the new user', site.get('meta', {}).get('owner') == 'uid2', str(site.get('meta')))
    check('site meta.name = "Main Collector"', site.get('meta', {}).get('name') == 'Main Collector')
    check('default controls created (all OFF)', site.get('controls') == {'power': False, 'solenoid': False, 'pump': False, 'lamp': False})
    check('no request denied by the rules during sign-up', not be.denied, str(be.denied))
    check('site switcher shows the new site', 'Main Collector' in pg.inner_text('#site-switcher'))
    check('connected-but-empty site says NO DATA (device not pushing yet)', 'NO DATA' in val(pg, '#fb-txt'), val(pg, '#fb-txt'))
    check('other users\' site is not visible to uid2', 'Rooftop' not in pg.inner_text('#site-switcher'))
    ctx.close()

    # ───────────────────────── F. rules reject the first write → user is told ─────────────────────────
    print('\n[F] Site creation rejected by rules]')
    be = Backend(deny_writes=True); ctx = br2.new_context(viewport={'width': 1300, 'height': 850}); be.attach(ctx)
    pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(300)
    pg.click('text=Configure Firebase Web API Key'); pg.fill('#auth-apikey', 'AIzaFAKEKEY'); pg.click('text=Save Key')
    pg.fill('#auth-email', 'new@x.com'); pg.fill('#auth-pass', 'secret123'); pg.click('#btn-signup')
    try: pg.wait_for_function("document.getElementById('toast-container').innerText.includes('Could not create your first site')", timeout=7000); told = True
    except Exception: told = False
    check('error toast explains the site could not be created', told)
    check('toast tells the user to check the rules', told and 'rules' in pg.inner_text('#toast-container').lower())
    ctx.close(); br2.close()

    # ───────────────────────── G. rules file matches what the mock (and the app) assume ─────────────────────────
    print('\n[G] Rules file sanity]')
    R = json.load(open(os.path.join(build_preview.B, 'firebase-config', 'database.rules.json')))['rules']
    site = R['sites']['$siteId']
    check('default deny at the root', R['.read'] is False and R['.write'] is False)
    check('no .read at site level (app must read /sensors and /controls separately)', '.read' not in site)
    check('meta.write allows creating a new owned site', '!data.exists()' in site['meta']['.write'] and 'newData.child(\'owner\')' in site['meta']['.write'])
    check('sensors accept optional pressure 0-100', 'pressure' in site['sensors'])
    check('unknown sensor/control keys rejected ($other)', site['sensors']['$other']['.validate'] is False and site['controls']['$other']['.validate'] is False)

print('\nRESULT:', 'ALL PASS ✔' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(1 if fails else 0)
