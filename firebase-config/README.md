# Firebase Security Rules — How This Actually Protects You

Your original database (`solar-thermal-e-harvesting`) has **no rules set**,
which in Firebase means **public read AND write** — anyone with the URL
(which is visible in your dashboard's own JavaScript!) can read your data
or, worse, send fake commands to your pump/relays. `database.rules.json`
in this folder fixes that completely.

## The permission model

```
/sites/{siteId}/
  ├── meta/           owner UID, site name — only the owner can read/write
  ├── members/{uid}   viewer accounts the owner has invited (read sensors+controls, can toggle controls)
  ├── devices/{uid}   a device account (your ESP32) — write-only to sensors, cannot read controls history
  ├── sensors/        ESP32 writes here; owner + members can read
  └── controls/       owner + members can read/write; device (ESP32) can read to know what to do

/users/{uid}/          each person's own profile — which sites they belong to
```

**Nobody can read or write anything without being authenticated.** The
top-level `.read`/`.write` are both `false` — every single permission is
granted explicitly deeper in the tree, which is the Firebase-recommended
"deny by default" pattern.

## Field-level validation

Notice the ranges:
```json
"T1": { ".validate": "newData.isNumber() && newData.val() >= -20 && newData.val() <= 200" }
```
This rejects garbage writes — a compromised or buggy device can't push
`T1: "hacked"` or `T1: 99999`. Firebase enforces this server-side, before
the write is even accepted, so it protects you even if someone gets your
device's auth token.

The `"$other": { ".validate": false }` line at the end of `sensors` and
`controls` blocks means **only the exact fields listed are allowed** —
no extra keys can be injected.

## How to deploy these rules

### Option A — Firebase Console (fastest, no CLI needed)
1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. Realtime Database → **Rules** tab
3. Paste the entire contents of `database.rules.json`
4. Click **Publish**

### Option B — Firebase CLI (recommended for ongoing projects)
```bash
npm install -g firebase-tools
firebase login
firebase init database        # select your existing project
# when it asks for rules file, point to firebase-config/database.rules.json
firebase deploy --only database
```

## Creating your owner account and first site

1. Firebase Console → **Authentication** → Sign-in method → enable **Email/Password**
2. Open the dashboard, paste your **Web API Key** (Project settings → General) under
   "Configure Firebase Web API Key", then choose **Create Account**
3. On first sign-up the app creates your first site ("Main Collector") for you. The rules
   allow this because a signed-in user may *create* a site node they own
   (`!data.exists() && newData.child('owner').val() === auth.uid`); after that only the owner can change it
4. Copy the **Site ID** from **Settings → Active Site** — your ESP32 firmware needs it as `SITE_ID`

> The dashboard reads `/sites/{id}/sensors` and `/sites/{id}/controls` separately.
> The rules deliberately grant **no** read on the whole site node, so `members` and `devices`
> lists are never exposed to viewers.

## Creating a restricted "device" account for your ESP32

Don't reuse your personal login on the ESP32 — create a **separate** account
just for the device, then grant it write-only access to sensors:

1. Authentication → Add user → `esp32-site-main@yourdomain.local` / random password
2. Copy that UID
3. In the database: `/sites/<Site ID>/devices/{DEVICE_UID} = true`  (Console → Realtime Database → Data; there is no in-app UI for this yet)
4. Now that account can **only** write to `/sites/<Site ID>/sensors` and read
   `/sites/<Site ID>/controls` — nothing else, per the rules above. If the
   device is ever physically stolen, the blast radius is limited to one site.

## Testing your rules before trusting them

Firebase Console → Realtime Database → Rules → **Rules Playground** lets you
simulate a read/write as any UID at any path, before real traffic hits it.
Always test the "deny" cases too — try reading `/sites/<Site ID>/sensors`
as `auth: null` and confirm it's rejected.
