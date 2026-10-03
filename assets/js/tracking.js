/* ═══════════════════════════════════════════════════════════════
   tracking.js  ·  Google Analytics 4 — consent-gated, real gtag.js
   ─────────────────────────────────────────────────────────────
   ⚠ Replace GA_MEASUREMENT_ID below with your real ID from
   analytics.google.com (format: G-XXXXXXXXXX). Until you do,
   this module is inert — enable() will log a warning and do
   nothing rather than send data to a fake/wrong ID.
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';  // ← put your real GA4 ID here
  let _loaded  = false;
  let _enabled = false;

  function isConfigured() {
    return GA_MEASUREMENT_ID && GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX';
  }

  function loadScript() {
    if (_loaded || !isConfigured()) return;
    _loaded = true;

    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  function enable() {
    _enabled = true;
    if (!isConfigured()) {
      console.info('[TRACKING] Consent given, but no real GA_MEASUREMENT_ID is set in tracking.js — skipping.');
      return;
    }
    loadScript();
  }

  function disable() {
    _enabled = false;
    // gtag doesn't have a clean "unload" — the practical approach is to
    // simply stop sending events. If script already loaded, we set a flag
    // GA's own consent mode also respects, for defense in depth:
    if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' });
  }

  function event(name, params) {
    if (_enabled && window.gtag) window.gtag('event', name, params || {});
  }

  function pageview(path) {
    if (_enabled && window.gtag) window.gtag('event', 'page_view', { page_path: path });
  }

  global.TRACKING = { enable, disable, event, pageview, isConfigured, isEnabled: () => _enabled };

})(window);
