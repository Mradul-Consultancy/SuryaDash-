/* ═══════════════════════════════════════════════════════════════
   auth.js  ·  Firebase Authentication — pure REST, no SDK
   ─────────────────────────────────────────────────────────────
   Uses the real Google Identity Toolkit REST API:
     https://firebase.google.com/docs/reference/rest/auth

   Requires a Firebase "Web API Key" (Console → Project Settings →
   General → Web API Key). This is a PUBLIC key — safe to ship in
   client code (it identifies your project, not a secret credential).
   Actual security comes from the database rules, not from hiding
   this key.
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const IDTOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
  const SECURETOKEN = 'https://securetoken.googleapis.com/v1';

  let _apiKey   = null;
  let _session  = null;   // { idToken, refreshToken, localId, email, expiresAt }
  let _onChange = null;
  let _refreshTimer = null;

  /* ── Storage ──────────────────────────────────────────────────── */
  const SKEY = 'solar-v6-session';
  function saveSession(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch(e){} }
  function loadSession()  { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch(e) { return null; } }
  function clearSession() { try { localStorage.removeItem(SKEY); } catch(e){} }

  /* ── Configure ────────────────────────────────────────────────── */
  function configure(apiKey) {
    _apiKey = apiKey;
    const saved = loadSession();
    if (saved && saved.refreshToken) {
      _session = saved;
      scheduleRefresh();
      if (_onChange) _onChange(_session);
    }
  }

  /* ── Sign in with email/password ─────────────────────────────── */
  async function signIn(email, password) {
    if (!_apiKey) throw new Error('Call AUTH.configure(apiKey) first');
    const res = await fetch(`${IDTOOLKIT}/accounts:signInWithPassword?key=${_apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Sign in failed');
    _session = {
      idToken: data.idToken, refreshToken: data.refreshToken,
      localId: data.localId, email: data.email,
      expiresAt: Date.now() + (+data.expiresIn * 1000)
    };
    saveSession(_session);
    scheduleRefresh();
    if (_onChange) _onChange(_session);
    return _session;
  }

  /* ── Sign up (create account) ────────────────────────────────── */
  async function signUp(email, password) {
    if (!_apiKey) throw new Error('Call AUTH.configure(apiKey) first');
    const res = await fetch(`${IDTOOLKIT}/accounts:signUp?key=${_apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Sign up failed');
    _session = {
      idToken: data.idToken, refreshToken: data.refreshToken,
      localId: data.localId, email: data.email,
      expiresAt: Date.now() + (+data.expiresIn * 1000)
    };
    saveSession(_session);
    scheduleRefresh();
    if (_onChange) _onChange(_session);
    return _session;
  }

  /* ── Refresh token (idTokens expire after 1hr) ───────────────── */
  async function refreshToken() {
    if (!_session?.refreshToken) return null;
    try {
      const res = await fetch(`${SECURETOKEN}/token?key=${_apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${_session.refreshToken}`
      });
      const data = await res.json();
      if (!res.ok) { signOut(); return null; }
      _session = {
        idToken: data.id_token, refreshToken: data.refresh_token,
        localId: data.user_id, email: _session.email,
        expiresAt: Date.now() + (+data.expires_in * 1000)
      };
      saveSession(_session);
      scheduleRefresh();
      if (_onChange) _onChange(_session);
      return _session;
    } catch(e) { return null; }
  }

  function scheduleRefresh() {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (!_session) return;
    const msUntil = Math.max(10000, _session.expiresAt - Date.now() - 60000); // refresh 1min early
    _refreshTimer = setTimeout(refreshToken, msUntil);
  }

  /* ── Sign out ─────────────────────────────────────────────────── */
  function signOut() {
    _session = null;
    clearSession();
    if (_refreshTimer) clearTimeout(_refreshTimer);
    if (_onChange) _onChange(null);
  }

  /* ── Password reset ──────────────────────────────────────────── */
  async function sendPasswordReset(email) {
    if (!_apiKey) throw new Error('Call AUTH.configure(apiKey) first');
    const res = await fetch(`${IDTOOLKIT}/accounts:sendOobCode?key=${_apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Reset failed');
    return true;
  }

  /* ── Public API ──────────────────────────────────────────────── */
  global.AUTH = {
    configure,
    signIn, signUp, signOut, refreshToken, sendPasswordReset,
    isSignedIn: () => !!_session,
    getSession: () => _session ? {..._session} : null,
    getIdToken: () => _session?.idToken || null,
    getUid:     () => _session?.localId || null,
    getEmail:   () => _session?.email   || null,
    onChange:   fn => { _onChange = fn; if (_session) fn(_session); }
  };

})(window);
