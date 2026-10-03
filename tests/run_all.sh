#!/usr/bin/env bash
# Full verification: static checks + real-browser layout, feature and integration tests.
# Requires: python3, node, playwright (pip install playwright && playwright install chromium)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "== JSON ==";  for f in firebase.json .firebaserc manifest.json firebase-config/database.rules.json; do python3 -c "import json;json.load(open('$ROOT/$f'))" && echo "  ✔ $f"; done
echo "== XML ==";   python3 -c "import xml.etree.ElementTree as E;E.parse('$ROOT/sitemap.xml')" && echo "  ✔ sitemap.xml"
echo "== JS ==";    for f in "$ROOT"/assets/js/*.js; do node --check "$f" && echo "  ✔ $(basename $f)"; done
python3 "$ROOT/tests/build_preview.py" >/dev/null
echo "== Layout (desktop/tablet/mobile) =="; python3 "$ROOT/tests/run_layout_tests.py"
echo "== Features (forms, consent, tabs, legal, 404) =="; python3 "$ROOT/tests/run_feature_tests.py"
echo "== Integration (mock Firebase: login, multi-site, controls, polling) =="; python3 "$ROOT/tests/run_integration_tests.py"
echo; echo "ALL SUITES PASSED ✔"
