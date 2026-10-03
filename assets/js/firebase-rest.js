/* ═══════════════════════════════════════════════════════════════
   firebase-rest.js v6  ·  Firebase RTDB REST — auth-aware, site-scoped
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const DEFAULT_URL = 'https://solar-thermal-e-harvesting-default-rtdb.firebaseio.com';
  let _base        = DEFAULT_URL;
  let _onData      = null;
  let _onStatus    = null;
  let _pollTimer   = null;
  let _pollMs      = 2000;
  let _fetchCount  = 0;
  let _failCount   = 0;
  let _connected   = false;
  let _lastRawJSON = null;
  let _responseTimes = [];

  function avgRT() {
    if (!_responseTimes.length) return 0;
    return Math.round(_responseTimes.reduce((a,b)=>a+b,0)/_responseTimes.length);
  }

  /* ── Auth-aware query string ─────────────────────────────────── */
  function authQS() {
    const t = window.AUTH?.getIdToken?.();
    return t ? `auth=${t}` : '';
  }

  /* ── Active data path — site-scoped if SITES module is active ── */
  function activePath() {
    if (window.SITES?.getCurrent?.()) return window.SITES.rootPath();
    return '';   // legacy flat-root mode
  }

  /* ── Fetch root (or active site root) ────────────────────────── */
  async function fetchRoot() {
    const t0 = performance.now();
    try {
      const qs   = authQS();
      const q    = qs ? '?'+qs : '';
      const opts = { signal: AbortSignal.timeout(8000), cache:'no-store' };
      const site = window.SITES?.getCurrent?.();
      let raw, hasData;

      if (site) {
        // Multi-site: the security rules grant read on /sensors and /controls
        // individually (not on the whole site node), so fetch those two paths.
        const base = `${_base}/sites/${site}`;
        const [rs, rc] = await Promise.all([
          fetch(`${base}/sensors.json${q}`,  opts),
          fetch(`${base}/controls.json${q}`, opts)
        ]);
        if (!rs.ok || !rc.ok) throw new Error(`HTTP ${!rs.ok ? rs.status : rc.status}`);
        const [s, c] = await Promise.all([rs.json(), rc.json()]);
        raw     = { sensors: s || {}, controls: c || {} };
        hasData = !!s && Object.keys(s).length > 0;
      } else {
        const res = await fetch(`${_base}/.json${q}`, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        raw     = await res.json();
        hasData = raw !== null;
      }

      const ms = Math.round(performance.now() - t0);
      _responseTimes.push(ms);
      if (_responseTimes.length > 20) _responseTimes.shift();
      _fetchCount++; _failCount = 0; _connected = true; _lastRawJSON = raw;

      if (_onStatus) _onStatus({ state:'connected', ms, fetchCount:_fetchCount, avgMs:avgRT(), failCount:0, raw, hasData });
      if (_onData && hasData) _onData(raw, ms);
      return raw;

    } catch(err) {
      const ms = Math.round(performance.now() - t0);
      _failCount++; _connected = false;
      if (_onStatus) _onStatus({ state:'disconnected', ms, fetchCount:_fetchCount, avgMs:avgRT(), failCount:_failCount, error:err.message });
      return null;
    }
  }

  /* ── Write (PUT a field, site-scoped) ────────────────────────── */
  async function write(path, value) {
    try {
      const qs  = authQS();
      const full = activePath() + path;
      const res = await fetch(`${_base}${full}.json${qs?'?'+qs:''}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(value), signal: AbortSignal.timeout(5000)
      });
      return res.ok;
    } catch(e) { console.warn('FB write error:', e.message); return false; }
  }

  async function patch(path, obj) {
    try {
      const qs  = authQS();
      const full = activePath() + path;
      const res = await fetch(`${_base}${full}.json${qs?'?'+qs:''}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(obj), signal: AbortSignal.timeout(5000)
      });
      return res.ok;
    } catch(e) { console.warn('FB patch error:', e.message); return false; }
  }

  function startPolling(ms) {
    if (ms) _pollMs = ms;
    if (_pollTimer) clearInterval(_pollTimer);
    fetchRoot();
    _pollTimer = setInterval(fetchRoot, _pollMs);
  }
  function stopPolling() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }
  function setPollInterval(ms) { _pollMs = Math.max(500,+ms||2000); if(_pollTimer){clearInterval(_pollTimer);_pollTimer=setInterval(fetchRoot,_pollMs);} }
  function setBaseURL(url) { if (url && url.trim()) _base = url.trim().replace(/\/$/, ''); }

  global.FB = {
    start: startPolling, stop: stopPolling, fetchNow: fetchRoot,
    write, patch, setPoll: setPollInterval, setURL: setBaseURL,
    onData: fn => { _onData = fn; }, onStatus: fn => { _onStatus = fn; },
    isConnected: () => _connected, getLastRaw: () => _lastRawJSON,
    getFetchCount: () => _fetchCount, getAvgRT: avgRT,
    get baseURL() { return _base; }
  };

})(window);
