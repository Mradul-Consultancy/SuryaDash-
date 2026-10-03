import sys
import os
B = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(B, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
from playwright.sync_api import sync_playwright
fails=[]
def check(n,ok,d=''):
    print(('  ✔ ' if ok else '  ✘ ')+n+(f' [{d}]' if d and not ok else ''))
    if not ok: fails.append(n)

with sync_playwright() as p:
    br=p.chromium.launch()
    ctx=br.new_context(viewport={'width':1280,'height':800})
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(f'file://{OUT}/preview.html'); pg.wait_for_timeout(400)

    print('\n[Form error states — login]')
    pg.click('#btn-signin'); pg.wait_for_timeout(200)
    vis=lambda i: pg.evaluate(f"(()=>{{const e=document.getElementById('{i}');return !!e&&getComputedStyle(e).display!=='none'&&e.textContent.length>0}})()")
    check('empty email shows inline error', vis('auth-email-error'))
    check('empty password shows inline error', vis('auth-pass-error'))
    pg.fill('#auth-email','not-an-email'); pg.fill('#auth-pass','123'); pg.click('#btn-signin'); pg.wait_for_timeout(200)
    check('invalid email message', 'valid email' in pg.inner_text('#auth-email-error'))
    check('short password message', '6 characters' in pg.inner_text('#auth-pass-error'))
    check('input border turns red', pg.evaluate("getComputedStyle(document.getElementById('auth-email')).borderColor")!=pg.evaluate("getComputedStyle(document.getElementById('auth-apikey')).borderColor"))
    pg.fill('#auth-email','a@b.com'); pg.fill('#auth-pass','secret123'); pg.click('#btn-signin'); pg.wait_for_timeout(300)
    check('valid input, no key -> clear guidance message', 'Web API Key' in pg.inner_text('#auth-error'))
    check('errors cleared after fixing input', not vis('auth-email-error'))

    print('\n[Loading state on button]')
    pg.evaluate("UX.setBtnLoading(document.getElementById('btn-signin'),true,'Signing in…')")
    check('button disabled + text changes', pg.evaluate("document.getElementById('btn-signin').disabled")==True and 'Signing' in pg.inner_text('#btn-signin'))
    pg.evaluate("UX.setBtnLoading(document.getElementById('btn-signin'),false)")
    check('button restored', pg.inner_text('#btn-signin')=='Sign In')

    print('\n[Cookie banner]')
    pg.click('text=Skip login'); pg.wait_for_timeout(1500)
    check('banner visible on first visit', pg.is_visible('#cookie-banner'))
    pg.click('#cookie-decline'); pg.wait_for_timeout(200)
    check('decline hides banner', not pg.is_visible('#cookie-banner'))
    check('choice persisted', pg.evaluate("localStorage.getItem('solar-v7-consent')")=='declined')
    pg.reload(); pg.wait_for_timeout(500); pg.click('text=Skip login'); pg.wait_for_timeout(800)
    check('banner stays hidden after reload', not pg.is_visible('#cookie-banner'))
    check('analytics inert w/o real GA ID', pg.evaluate("TRACKING.isConfigured()")==False)

    print('\n[Tabs -> per-tab title]')
    for t,exp in [('analytics','Analytics'),('report','Report'),('settings','Settings'),('dashboard','Dashboard')]:
        pg.evaluate(f"switchTab('{t}')"); pg.wait_for_timeout(150)
        check(f'title on {t} tab', exp in pg.title(), pg.title())
    check('no page JS errors in flow', not errs, str(errs))

    print('\n[Settings validation]')
    pg.evaluate("switchTab('settings')")
    pg.fill('#set-dton','2'); pg.fill('#set-dtoff','5'); pg.evaluate("applySettings()"); pg.wait_for_timeout(200)
    check('ON<=OFF threshold blocked with inline error', 'must be greater' in pg.inner_text('#set-dton-error'))
    pg.fill('#set-dton','8'); pg.fill('#set-dtoff','3'); pg.evaluate("applySettings()"); pg.wait_for_timeout(200)
    check('valid thresholds accepted', not pg.is_visible('#set-dton-error'))

    print('\n[Welcome overlay]')
    pg.evaluate("UX.showWelcome('me@x.com')")
    check('welcome overlay renders', pg.is_visible('#welcome-overlay'))
    pg.click('#welcome-overlay button'); check('welcome dismisses', pg.locator('#welcome-overlay').count()==0)

    print('\n[Legal + 404 pages at mobile width]')
    m=br.new_context(viewport={'width':375,'height':812})
    for f,needle in [('privacy.html','Privacy Policy'),('terms.html','Hardware'),('404.html','404')]:
        q=m.new_page(); q.goto(f'file://{B}/{f}'); q.wait_for_timeout(300)
        check(f'{f} renders content', needle in q.inner_text('body'))
        check(f'{f} no horizontal scroll', q.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
        q.screenshot(path=f'{OUT}/t-{f.split(".")[0]}-m.png')
    br.close()
print('\nRESULT:','ALL PASS ✔' if not fails else f'{len(fails)} FAIL {fails}'); sys.exit(1 if fails else 0)
