#!/usr/bin/env python3
"""
configure.py — fill in every placeholder in one command, then verify.

USAGE
  python3 deploy/configure.py \
      --domain solar.example.com \
      --company "Example Energy Ltd" \
      --email support@example.com \
      --address "12 Sun Street, Riyadh, Saudi Arabia" \
      --country "Saudi Arabia" \
      --ga-id G-ABC123XYZ            # optional; omit to keep analytics inert

  python3 deploy/configure.py --check     # exits 1 if any placeholder remains

Run from the project root. Safe to re-run; files are edited in place, so
commit/backup first if you want an undo.
"""
import argparse, re, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT_FILES = ["index.html", "404.html", "privacy.html", "terms.html",
              "robots.txt", "sitemap.xml", "assets/js/tracking.js"]

LEFTOVER_PATTERNS = [
    (r"yourdomain\.com", "placeholder domain"),
    (r'class="placeholder"', "highlighted legal placeholder"),
    (r"G-XXXXXXXXXX(?!';\s*//)", "placeholder GA ID"),
    (r"\[Your Company", "placeholder company"),
]

def check():
    bad = []
    for rel in TEXT_FILES:
        p = ROOT / rel
        if not p.exists():
            continue
        txt = p.read_text(encoding="utf-8")
        if rel.endswith("tracking.js"):
            # analytics may intentionally stay unconfigured; only warn
            continue
        for pat, label in LEFTOVER_PATTERNS:
            n = len(re.findall(pat, txt))
            if n:
                bad.append(f"  ✘ {rel}: {n} × {label}")
    if bad:
        print("Placeholders still present:\n" + "\n".join(bad))
        return 1
    print("✔ No placeholders remain. Safe to deploy.")
    return 0

def configure(a):
    today = datetime.date.today()
    sec = a.security_email or a.email
    provider = "Google Analytics" if a.ga_id else "no analytics provider (analytics disabled)"

    span = lambda inner: r'<span class="placeholder">\[' + inner + r'\]</span>'
    legal_map = [
        (span(r"DATE[^\]]*"), today.strftime("%B %d, %Y")),
        (span(r"YEAR"), str(today.year)),
        (span(r"Your Company / Individual Name"), a.company),
        (span(r"Your Company Name"), a.company),
        (span(r"Street Address, City, Country"), a.address),
        (span(r"your-support-email@yourdomain\.com"), a.email),
        (span(r"contact@yourdomain\.com"), a.email),
        (span(r"security@yourdomain\.com"), sec),
        (span(r"Your Country/State"), a.country),
        (span(r"Google Analytics / Plausible / your chosen provider"), provider),
    ]

    for rel in TEXT_FILES:
        p = ROOT / rel
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8")

        if rel.endswith(".html"):
            for pat, val in legal_map:
                t = re.sub(pat, lambda m, v=val: v, t)
            if not a.keep_callouts:
                t = re.sub(r'\s*<div class="legal-callout">.*?</div>', "", t, flags=re.S)
            # footer line in index.html
            t = t.replace('<span class="placeholder-note">[Your Company Name] · contact@yourdomain.com</span>',
                          f"{a.company} · {a.email}")
            t = t.replace("security@yourdomain.com", sec)
            t = t.replace("contact@yourdomain.com", a.email)

        if rel.endswith("tracking.js") and a.ga_id:
            t = re.sub(r"const GA_MEASUREMENT_ID = '[^']*';",
                       f"const GA_MEASUREMENT_ID = '{a.ga_id}';", t)

        t = t.replace("https://yourdomain.com", f"https://{a.domain}")
        t = t.replace("yourdomain.com", a.domain)

        if rel == "sitemap.xml":
            t = re.sub(r"(<loc>[^<]+</loc>)(?!\s*<lastmod>)",
                       lambda m: m.group(1) + f"\n    <lastmod>{today.isoformat()}</lastmod>", t)

        p.write_text(t, encoding="utf-8")
        print(f"  ✔ {rel}")
    print("\nDone. Now run:  python3 deploy/configure.py --check")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--domain"); ap.add_argument("--company"); ap.add_argument("--email")
    ap.add_argument("--address"); ap.add_argument("--country")
    ap.add_argument("--security-email"); ap.add_argument("--ga-id")
    ap.add_argument("--keep-callouts", action="store_true")
    a = ap.parse_args()
    if a.check:
        sys.exit(check())
    missing = [k for k in ("domain", "company", "email", "address", "country") if not getattr(a, k)]
    if missing:
        ap.error("missing required: " + ", ".join("--" + m for m in missing))
    configure(a)
