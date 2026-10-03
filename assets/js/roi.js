/* ═══════════════════════════════════════════════════════════════
   roi.js  ·  Economics, CO₂, 7-day history, differential control
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  /* ── Config ─────────────────────────────────────────────────── */
  let _tariff   = 0.15;   // $/kWh  (global avg household electricity)
  let _co2      = 0.475;  // kg CO₂/kWh (global grid average 2024, IEA)
  let _currency = '$';
  let _dtOn     = 8.0;    // °C  pump ON  differential
  let _dtOff    = 3.0;    // °C  pump OFF differential
  let _ambient  = 25.0;   // °C  ambient temperature
  let _uValue   = 3.5;    // W/(m²·K) typical uninsulated pipe heat loss

  /* ── Session accumulators ───────────────────────────────────── */
  let _totalKWh   = 0;
  let _pumpOnSec  = 0;
  let _totalSec   = 0;
  let _prevPump   = false;
  let _prevTime   = Date.now();

  /* ── 7-day history (localStorage) ──────────────────────────── */
  const KEY = 'solar-v5-daily';
  function _loadHist()  { try { return JSON.parse(localStorage.getItem(KEY)||'{}'); } catch(e) { return {}; } }
  function _saveHist(h) { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch(e){} }

  function recordDaily(kWhIncrement, date) {
    const hist = _loadHist();
    const day  = (date||new Date()).toISOString().slice(0,10);
    hist[day]  = (hist[day]||0) + kWhIncrement;
    // Keep 30 days
    const trimmed = {};
    Object.keys(hist).sort().slice(-30).forEach(k => trimmed[k] = hist[k]);
    _saveHist(trimmed);
  }

  function getLast7Days() {
    const hist = _loadHist();
    const result = [];
    for (let i=6; i>=0; i--) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const day = d.toISOString().slice(0,10);
      result.push({ day: d.toLocaleDateString('en',{weekday:'short'}), date: day, kWh: +(hist[day]||0).toFixed(3) });
    }
    return result;
  }

  /* ── ROI calculation ─────────────────────────────────────────── */
  function calc(kWh) {
    return {
      money:    +(_tariff * kWh).toFixed(4),
      co2:      +(_co2   * kWh).toFixed(3),
      trees:    +(_co2   * kWh / 21).toFixed(4),  // avg tree = 21 kg CO₂/year
      liters:   +(kWh * 0.27).toFixed(2)           // 0.27L petrol equivalent per kWh
    };
  }

  /* ── Heat loss estimate (pipe) ───────────────────────────────── */
  function pipeLoss(Tm, pipeLen, pipeDia) {
    // Q_loss = U × π × D × L × (Tm - Ta)   [W]
    const A = Math.PI * (pipeDia||0.025) * (pipeLen||10);
    return Math.max(0, _uValue * A * (Tm - _ambient)) / 1000;  // kW
  }

  /* ── Differential controller ────────────────────────────────── */
  function differentialCheck(T3, T1, pumpOn) {
    const diff = T3 - T1;
    let recommendation = 'HOLD';
    let reason = '';
    if (!pumpOn && diff >= _dtOn)  { recommendation = 'ON';  reason = `ΔT ${diff.toFixed(1)}°C ≥ ${_dtOn}°C`; }
    if (pumpOn  && diff <= _dtOff) { recommendation = 'OFF'; reason = `ΔT ${diff.toFixed(1)}°C ≤ ${_dtOff}°C`; }
    return { diff: +diff.toFixed(1), recommendation, reason, dtOn: _dtOn, dtOff: _dtOff };
  }

  /* ── Uptime tracking ─────────────────────────────────────────── */
  function trackUptime(pumpOn, kWhTick) {
    const now  = Date.now();
    const dt   = (now - _prevTime) / 1000;
    _prevTime  = now;
    _totalSec += dt;
    if (pumpOn) _pumpOnSec += dt;
    _totalKWh += kWhTick;
    recordDaily(kWhTick, new Date());
    _prevPump = pumpOn;
    return {
      pumpUptime: _totalSec > 0 ? +(_pumpOnSec/_totalSec*100).toFixed(1) : 0,
      pumpOnHrs:  +(_pumpOnSec/3600).toFixed(3),
      totalHrs:   +(_totalSec/3600).toFixed(3)
    };
  }

  /* ── Render ROI strip ────────────────────────────────────────── */
  function renderStrip(kWh, uptime) {
    const roi = calc(kWh);
    const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    set('roi-money',  _currency + roi.money.toFixed(3));
    set('roi-co2',    roi.co2.toFixed(3) + ' kg');
    set('roi-trees',  roi.trees.toFixed(4));
    set('roi-pump',   (uptime?.pumpUptime||0).toFixed(1)+'%');
    set('roi-kwh',    kWh.toFixed(3) + ' kWh');
    set('roi-petrol', roi.liters.toFixed(2) + ' L');
  }

  /* ── Render differential controller UI ───────────────────────── */
  function renderController(ctrl) {
    const set = (id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
    const stEl = document.getElementById('dc-status');
    set('dc-diff',  ctrl.diff + '°C');
    set('dc-on',    _dtOn  + '°C');
    set('dc-off',   _dtOff + '°C');
    if (stEl) {
      const col = ctrl.recommendation==='ON'?'var(--on)':ctrl.recommendation==='OFF'?'var(--al-crit)':'var(--al-warn)';
      stEl.textContent  = ctrl.recommendation + (ctrl.reason ? ` — ${ctrl.reason}` : '');
      stEl.style.color  = col;
    }
    const bar = document.getElementById('dc-bar');
    if (bar) {
      const pct = Math.min(100, Math.max(0, (ctrl.diff / 20) * 100));
      bar.style.width     = pct + '%';
      bar.style.background = ctrl.recommendation==='ON'?'var(--on)':ctrl.recommendation==='OFF'?'var(--al-crit)':'var(--al-warn)';
    }
  }

  /* ── Public API ──────────────────────────────────────────────── */
  global.ROI = {
    set: (cfg) => {
      if (cfg.tariff   !== undefined) _tariff   = +cfg.tariff;
      if (cfg.co2      !== undefined) _co2      = +cfg.co2;
      if (cfg.currency !== undefined) _currency = cfg.currency;
      if (cfg.dtOn     !== undefined) _dtOn     = +cfg.dtOn;
      if (cfg.dtOff    !== undefined) _dtOff    = +cfg.dtOff;
      if (cfg.ambient  !== undefined) _ambient  = +cfg.ambient;
      if (cfg.uValue   !== undefined) _uValue   = +cfg.uValue;
    },
    get: () => ({ tariff:_tariff, co2:_co2, currency:_currency, dtOn:_dtOn, dtOff:_dtOff, ambient:_ambient }),
    calc, pipeLoss, differentialCheck, trackUptime, renderStrip, renderController,
    getLast7Days, recordDaily,
    reset: () => { _totalKWh=0; _pumpOnSec=0; _totalSec=0; _prevTime=Date.now(); }
  };

})(window);
