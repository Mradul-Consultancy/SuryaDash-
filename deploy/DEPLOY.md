# Deployment Guide — Get This on a Real Domain

## Step 0 — Fill in your real details (required, 1 command)

The site ships with clearly-marked placeholders (domain, company name, contact
email, address, Google Analytics ID). Nothing was invented for you. Fill them all at once:

```bash
python3 deploy/configure.py \
  --domain solar.yourrealdomain.com \
  --company "Your Real Company Name" \
  --email support@yourrealdomain.com \
  --address "Your real street address, City, Country" \
  --country "Your governing-law country/state" \
  --ga-id G-XXXXXXXXXX        # optional; leave out to keep analytics disabled

python3 deploy/configure.py --check     # must print "No placeholders remain"
bash tests/run_all.sh                   # must print "ALL SUITES PASSED"
```

Have a lawyer review `privacy.html` and `terms.html` before real users rely on them.

---

Two real paths, both free at this scale. Pick one.

---

## Path A — Firebase Hosting (recommended — same project as your DB)

### 1. Install tools
```bash
npm install -g firebase-tools
firebase login
```

### 2. Deploy
From the project root (where `firebase.json` lives):
```bash
firebase deploy --only hosting
```
You'll get a live URL immediately:
```
✔  Deploy complete!
Hosting URL: https://solar-thermal-e-harvesting.web.app
```
That URL is real, HTTPS, and CDN-backed — usable right now, no custom domain needed.

### 3. Connect your own domain (optional but "real business" feel)
1. Buy a domain if you don't have one (Namecheap, Google Domains, Cloudflare — ~$10–15/yr)
2. Firebase Console → Hosting → **Add custom domain**
3. Enter e.g. `solar.yourdomain.com`
4. Firebase gives you DNS records to add at your registrar:

| Type | Host | Value |
|---|---|---|
| A | `solar` | `151.101.1.195` |
| A | `solar` | `151.101.65.195` |
| TXT | `solar` | (verification string Firebase gives you) |

*(Exact IPs are shown live in the Firebase Console when you add the domain — always use the ones it shows you, not these examples.)*

5. Add those records in your registrar's DNS panel
6. Wait 10 min – 24 hrs for propagation, Firebase auto-provisions a free SSL cert
7. Done — `https://solar.yourdomain.com` is now your dashboard, real cert, real domain

---

## Path B — Vercel (faster propagation, nicer git-based CI/CD)

### 1. Install & deploy
```bash
npm install -g vercel
cd /path/to/solar-v6
vercel --prod
```
It auto-detects a static site and deploys. You'll get `https://your-project.vercel.app` instantly.

### 2. Custom domain
```bash
vercel domains add solar.yourdomain.com
```
Vercel shows you a CNAME record:

| Type | Host | Value |
|---|---|---|
| CNAME | `solar` | `cname.vercel-dns.com` |

Add it at your registrar, wait a few minutes (Vercel propagates faster than most), SSL is automatic.

### 3. Connect Git for auto-deploy on push (optional)
```bash
vercel git connect
```
Now every `git push` to your main branch auto-deploys — genuinely production-grade CI/CD, free.

---

## Which one should you actually pick?

| | Firebase Hosting | Vercel |
|---|---|---|
| Same dashboard as your DB | ✔ Yes | No, separate login |
| Free tier | 10GB storage, 360MB/day transfer | 100GB/month transfer |
| Custom domain SSL | Automatic | Automatic |
| Git auto-deploy | Via GitHub Actions (extra setup) | Native, one command |
| Best for | Keeping everything in one Firebase project | If you'll iterate a lot via GitHub |

**For this project specifically: Firebase Hosting** — your database, rules,
and hosting all live under one project, one login, one `firebase deploy`.

---

## Before you deploy — checklist

- [ ] `database.rules.json` has been published (see `firebase-config/README.md`)
- [ ] At least one owner account exists in Firebase Auth
- [ ] `assets/js/firebase-rest.js` points at your real `FIREBASE_HOST`
- [ ] `assets/js/auth.js` has your real **Web API Key** (Console → Project Settings → General → Web API Key — *different* from the database secret)
- [ ] You've tested login locally by opening `index.html` directly in a browser first

## After deploying — verify it's actually secure

Open your live URL in an **incognito window**, don't log in, and open DevTools
→ Network tab. Try to manually fetch:
```
https://YOUR-PROJECT-default-rtdb.firebaseio.com/sites/<Site ID>/sensors.json
```
You should get:
```json
{"error":"Permission denied"}
```
If you instead see your real sensor data, your rules aren't published yet — go back to `firebase-config/README.md`.
