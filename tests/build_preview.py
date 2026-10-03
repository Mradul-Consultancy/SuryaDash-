"""Builds tests/out/preview.html — the whole app inlined into one file (same as the published preview)."""
import os, re
B = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(B, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
MODULES = ['auth','site-manager','firebase-rest','charts','alarms','analytics','solar-physics','roi','consent','tracking','ux-polish','app']

def build(dest=None):
    r = lambda p: open(os.path.join(B, p), encoding='utf-8').read()
    html = r('index.html'); css = r('assets/css/style.css')
    js = '\n'.join(r(f'assets/js/{m}.js') for m in MODULES)
    html = html.replace('<link rel="manifest" href="manifest.json">\n', '')
    html = html.replace('<link rel="stylesheet" href="assets/css/style.css">', f'<style>\n{css}\n</style>')
    block = f'<script>\n{js}\n</script>\n'
    html = re.sub(r'(<script src="assets/js/[a-z-]+\.js"></script>\n?)+', lambda m: block, html)
    dest = dest or os.path.join(OUT, 'preview.html')
    open(dest, 'w', encoding='utf-8').write(html)
    return dest

if __name__ == '__main__':
    print('built', build())
