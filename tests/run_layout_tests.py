import re, json, sys
import os
B = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(B, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
from playwright.sync_api import sync_playwright

def read(p):
    with open(p) as f: return f.read()

# ---------- BUILD ----------
html = read(f'{B}/index.html')
css  = read(f'{B}/assets/css/style.css')
mods = ['auth','site-manager','firebase-rest','charts','alarms','analytics','solar-physics','roi','consent','tracking','ux-polish','app']
js = '\n'.join(read(f'{B}/assets/js/{m}.js') for m in mods)
html = html.replace('<link rel="manifest" href="manifest.json">\n','')
html = html.replace('<link rel="stylesheet" href="assets/css/style.css">', f'<style>\n{css}\n</style>')
block = f'<script>\n{js}\n</script>\n'
html = re.sub(r'(<script src="assets/js/[a-z-]+\.js"></script>\n?)+', lambda m: block, html)
open(f'{OUT}/preview.html','w').write(html)
print(f'BUILD ok ({len(html)/1024:.0f} KB)')

# ---------- TEST ----------
fails=[]
def check(name, ok, detail=''):
    print(('  ✔ ' if ok else '  ✘ ')+name+(f'  [{detail}]' if detail and not ok else ''))
    if not ok: fails.append(name)

with sync_playwright() as p:
    br = p.chromium.launch()
    for label,(w,h) in {'desktop':(1400,900),'tablet':(900,1000),'mobile':(375,812)}.items():
        print(f'\n[{label} {w}x{h}]')
        pg = br.new_page(viewport={'width':w,'height':h})
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'file://{OUT}/preview.html')
        pg.wait_for_timeout(400)
        pg.click('text=Skip login'); pg.wait_for_timeout(2200)
        r = pg.evaluate('''() => {
          const q=s=>document.querySelector(s);
          const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
          return {
            areas:getComputedStyle(q('.canvas')).gridTemplateAreas,
            sensors:rect(q('.sensor-row')), ctrl:rect(q('.ctrl-col')), charts:rect(q('.chart-col')),
            log:rect(q('.log-panel')), overlay:(q('#connecting-overlay')||{style:{display:'none'}}).style.display,
            switcher:getComputedStyle(q('#site-switcher-wrap')).display,
            hScroll:document.documentElement.scrollWidth>window.innerWidth+2,
            skeletons:document.querySelectorAll('.skeleton-pulse').length,
            mnav:!!q('#mobile-bottom-nav'), sVal:q('#v-T1').textContent,
            ribbonH:rect(q('.ribbon')).h,
            ribbonRight:rect(q('.ribbon-right')).x+rect(q('.ribbon-right')).w,
            kpiCards:[...document.querySelectorAll('.kpi-card')].map(rect),
            banner:rect(q('#cookie-banner')), bannerShown:getComputedStyle(q('#cookie-banner')).display!='none',
            nav:q('#mobile-bottom-nav')?rect(q('#mobile-bottom-nav')):null,
            sunLbl:q('#sol-rise-lbl').textContent, logoW:rect(q('.pbi-logo')).w, titleVis:rect(q('.report-title')).w
          }}''')
        check('grid-template-areas valid', r['areas']!='none')
        check('no page JS errors', not errs, str(errs))
        check('connecting overlay hidden', r['overlay']=='none')
        check('site switcher hidden in demo', r['switcher']=='none')
        check('skeletons cleared', r['skeletons']==0, str(r['skeletons']))
        check('T1 value populated', re.match(r'^[\d.]+$', r['sVal']) is not None, r['sVal'])
        check('no horizontal scroll', not r['hScroll'])
        if w>1050:
            check('controls sit RIGHT of sensors', r['ctrl']['x']>r['sensors']['x']+r['sensors']['w']-5)
            check('panels do not overlap (sensors/charts)', r['charts']['y']>=r['sensors']['y']+r['sensors']['h']-2)
        else:
            check('single-column stack (ctrl below sensors)', r['ctrl']['y']>=r['sensors']['y']+r['sensors']['h']-2)
        if w<=640: check('mobile bottom nav present', r['mnav'])
        check('ribbon stays compact (<=64px)', r['ribbonH']<=64, str(r['ribbonH']))
        check('ribbon content inside viewport', r['ribbonRight']<=w+1, str(r['ribbonRight']))
        ov=[(a,b) for i,a in enumerate(r['kpiCards']) for b in r['kpiCards'][i+1:] if a['x']<b['x']+b['w']-2 and b['x']<a['x']+a['w']-2 and a['y']<b['y']+b['h']-2 and b['y']<a['y']+a['h']-2]
        check('KPI cards do not overlap', not ov)
        check('logo not squished (>=30px)', r['logoW']>=30, str(r['logoW']))
        check('app title visible', r['titleVis']>20, str(r['titleVis']))
        check('sun-arc sunrise label populated', r['sunLbl']!='--:--', r['sunLbl'])
        if r['nav'] and r['bannerShown']:
            check('cookie banner does not cover bottom nav', r['banner']['y']+r['banner']['h']<=r['nav']['y']+2)
        pg.screenshot(path=f'{OUT}/t-{label}.png')
    br.close()

print('\nRESULT:', 'ALL PASS ✔' if not fails else f'{len(fails)} FAIL: {fails}')
sys.exit(1 if fails else 0)
