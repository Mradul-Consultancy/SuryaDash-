/* ═══════════════════════════════════════════════════════════════
   site-manager.js  ·  Multi-site support
   ─────────────────────────────────────────────────────────────
   Data model:
     /sites/{siteId}/meta/{owner,name,createdAt}
     /sites/{siteId}/sensors/{T1..F2}
     /sites/{siteId}/controls/{power,solenoid,pump,lamp}
     /users/{uid}/sites/{siteId} = true    (membership index)
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  let _base      = null;   // Firebase REST base URL
  let _currentId = null;
  let _sites     = {};     // { siteId: { name, owner, createdAt } }
  let _onSwitch  = null;

  function setBase(url) { _base = url.replace(/\/$/, ''); }

  /* ── Auth header helper ──────────────────────────────────────── */
  function authQS() {
    const t = window.AUTH?.getIdToken?.();
    return t ? `?auth=${t}` : '';
  }

  /* ── List sites the current user belongs to ──────────────────── */
  async function listMySites() {
    const uid = window.AUTH?.getUid?.();
    if (!uid || !_base) return [];
    try {
      const res = await fetch(`${_base}/users/${uid}/sites.json${authQS()}`);
      const idx = await res.json();
      if (!idx) return [];
      const ids = Object.keys(idx).filter(k => idx[k]);
      const sites = [];
      for (const id of ids) {
        const mRes = await fetch(`${_base}/sites/${id}/meta.json${authQS()}`);
        const meta = await mRes.json();
        if (meta) { sites.push({ id, ...meta }); _sites[id] = meta; }
      }
      return sites;
    } catch(e) { console.warn('listMySites failed', e); return []; }
  }

  /* ── Create a new site ────────────────────────────────────────── */
  async function createSite(name) {
    const uid = window.AUTH?.getUid?.();
    if (!uid || !_base) throw new Error('Not signed in');
    const id = 'site_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    const meta = { owner: uid, name, createdAt: Date.now() };

    const put = async (path, body) => {
      const r = await fetch(`${_base}${path}.json${authQS()}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body });
      if (!r.ok) throw new Error(`Write to ${path} was rejected (HTTP ${r.status}). Check that the database rules are published.`);
    };
    await put(`/sites/${id}/meta`, JSON.stringify(meta));
    await put(`/users/${uid}/sites/${id}`, 'true');
    await put(`/sites/${id}/controls`, JSON.stringify({ power:false, solenoid:false, pump:false, lamp:false }));

    _sites[id] = meta;
    return { id, ...meta };
  }

  /* ── Delete / leave a site ───────────────────────────────────── */
  async function deleteSite(id) {
    const uid = window.AUTH?.getUid?.();
    if (!uid || !_base) return false;
    await fetch(`${_base}/sites/${id}.json${authQS()}`, { method:'DELETE' });
    await fetch(`${_base}/users/${uid}/sites/${id}.json${authQS()}`, { method:'DELETE' });
    delete _sites[id];
    return true;
  }

  /* ── Rename ───────────────────────────────────────────────────── */
  async function renameSite(id, newName) {
    await fetch(`${_base}/sites/${id}/meta/name.json${authQS()}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newName)
    });
    if (_sites[id]) _sites[id].name = newName;
  }

  /* ── Switch active site ──────────────────────────────────────── */
  function switchTo(id) {
    _currentId = id;
    localStorage.setItem('solar-v6-active-site', id);
    if (_onSwitch) _onSwitch(id, _sites[id]);
  }

  function restoreLastSite() {
    return localStorage.getItem('solar-v6-active-site');
  }

  /* ── Path helpers — every FB call in the app goes through these ── */
  function sensorsPath()  { return _currentId ? `/sites/${_currentId}/sensors`  : '/sensors'; }
  function controlsPath() { return _currentId ? `/sites/${_currentId}/controls` : '/controls'; }
  function rootPath()     { return _currentId ? `/sites/${_currentId}` : '/'; }

  /* ── Render site switcher dropdown ───────────────────────────── */
  function renderSwitcher(sites) {
    const sel = document.getElementById('site-switcher');
    if (!sel) return;
    sel.innerHTML = sites.map(s => `<option value="${s.id}" ${s.id===_currentId?'selected':''}>${s.name}</option>`).join('')
      + `<option value="__new__">+ Add new site…</option>`;
  }

  /* ── Public API ──────────────────────────────────────────────── */
  global.SITES = {
    setBase, listMySites, createSite, deleteSite, renameSite,
    switchTo, restoreLastSite,
    sensorsPath, controlsPath, rootPath,
    getCurrent: () => _currentId,
    getCurrentMeta: () => _sites[_currentId] || null,
    getAll: () => ({..._sites}),
    onSwitch: fn => { _onSwitch = fn; },
    renderSwitcher
  };

})(window);
