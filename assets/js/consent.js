/* ═══════════════════════════════════════════════════════════════
   consent.js  ·  Cookie / local-storage consent banner
   ─────────────────────────────────────────────────────────────
   Honest design: essential localStorage (auth session, dashboard
   settings) is always used — the Service can't function without it,
   same as any app that remembers you're logged in. This banner is
   about DISCLOSURE, and it gates the one thing that's genuinely
   optional: third-party analytics (see tracking.js).
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const KEY = 'solar-v7-consent';   // 'accepted' | 'declined'

  function getChoice() {
    try { return localStorage.getItem(KEY); } catch(e) { return null; }
  }

  function setChoice(val) {
    try { localStorage.setItem(KEY, val); } catch(e){}
    render();
    if (global.TRACKING) {
      if (val === 'accepted') global.TRACKING.enable();
      else global.TRACKING.disable();
    }
  }

  function render() {
    const el = document.getElementById('cookie-banner');
    if (!el) return;
    el.style.display = getChoice() ? 'none' : 'flex';
  }

  function init() {
    render();
    const acceptBtn  = document.getElementById('cookie-accept');
    const declineBtn = document.getElementById('cookie-decline');
    if (acceptBtn)  acceptBtn.addEventListener('click',  () => setChoice('accepted'));
    if (declineBtn) declineBtn.addEventListener('click', () => setChoice('declined'));

    // If already accepted on a previous visit, enable tracking immediately
    if (getChoice() === 'accepted' && global.TRACKING) global.TRACKING.enable();
  }

  global.CONSENT = {
    init,
    getChoice,
    hasAnswered: () => !!getChoice(),
    reset: () => { try{localStorage.removeItem(KEY);}catch(e){} render(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
