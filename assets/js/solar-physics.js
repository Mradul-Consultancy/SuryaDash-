/* ═══════════════════════════════════════════════════════════════
   solar-physics.js  ·  Real-time solar geometry & irradiance
   Pure math — no API key, no network call
   ─────────────────────────────────────────────────────────────
   Implements:
   • Solar declination (Spencer equation)
   • Equation of Time
   • Hour angle → Solar elevation & azimuth
   • Air Mass (Kasten & Young 1989)
   • Extra-terrestrial irradiance (Spencer correction)
   • Sunrise / Sunset / Solar Noon
   • Clearness Index display (if measured G provided)
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const RAD = Math.PI / 180;
  const SC  = 1361;   // W/m²  solar constant

  let _lat = 24.0;    // default: approx Middle-East/India solar belt
  let _lon = 45.0;
  let _updateTimer = null;
  let _onUpdate = null;

  /* ── Day-of-year ────────────────────────────────────────────── */
  function dayOfYear(d) {
    return Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000);
  }

  /* ── Declination & Equation of Time (Spencer 1971) ──────────── */
  function sunParams(n) {
    const B   = (360/365) * (n - 81) * RAD;
    const dec = 23.45 * Math.sin((360/365*(284+n)) * RAD);
    const ET  = 9.87*Math.sin(2*B) - 7.53*Math.cos(B) - 1.5*Math.sin(B); // minutes
    return { dec, ET };
  }

  /* ── Solar position ─────────────────────────────────────────── */
  function position(lat, lon, date) {
    const n       = dayOfYear(date);
    const { dec, ET } = sunParams(n);
    const tzOff   = -date.getTimezoneOffset() / 60;
    const LSTM    = 15 * tzOff;
    const TC      = 4 * (lon - LSTM) + ET;          // minutes
    const LST     = date.getHours() + date.getMinutes()/60 + date.getSeconds()/3600 + TC/60;
    const HRA     = 15 * (LST - 12);                // degrees
    const latR    = lat * RAD;
    const decR    = dec * RAD;
    const hraR    = HRA * RAD;
    const sinEl   = Math.sin(latR)*Math.sin(decR) + Math.cos(latR)*Math.cos(decR)*Math.cos(hraR);
    const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
    let azimuth = 0;
    if (elevation > -5) {
      const cosEl = Math.cos(elevation * RAD);
      if (cosEl > 0.001) {
        const cosAz = (Math.sin(decR) - Math.sin(latR)*sinEl) / (Math.cos(latR)*cosEl);
        azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD;
        if (LST > 12) azimuth = 360 - azimuth;
      }
    }
    // Extra-terrestrial irradiance (W/m²)
    const eccCorr = 1 + 0.033 * Math.cos(360 * n / 365 * RAD);
    const G0 = elevation > 0 ? SC * eccCorr * sinEl : 0;
    // Air mass (Kasten & Young 1989) — accounts for refraction
    let AM = 0;
    if (elevation > 0) {
      AM = 1 / (sinEl + 0.50572 * Math.pow(elevation + 6.07995, -1.6364));
    }
    // Beam irradiance at surface (Linke turbidity = 3.5 typical)
    const tau = 0.1;  // clear-sky attenuation coefficient
    const Gb  = elevation > 0 ? G0 * Math.exp(-tau * AM) : 0;
    return { elevation, azimuth, G0: +G0.toFixed(1), Gb: +Gb.toFixed(1), AM: +AM.toFixed(2), LST: +LST.toFixed(3), dec: +dec.toFixed(2), HRA: +HRA.toFixed(2) };
  }

  /* ── Sunrise / Sunset / Solar Noon ─────────────────────────── */
  function sunTimes(lat, lon, date) {
    const n       = dayOfYear(date);
    const { dec, ET } = sunParams(n);
    const latR    = lat  * RAD;
    const decR    = dec * RAD;
    const cosHA   = -Math.tan(latR) * Math.tan(decR);
    if (cosHA <= -1) return { sunrise: 0,    sunset: 24,  noon: 12, dayLen: 24 };
    if (cosHA >=  1) return { sunrise: 12,   sunset: 12,  noon: 12, dayLen:  0 };
    const HA      = Math.acos(cosHA) / RAD;     // degrees
    const tzOff   = -date.getTimezoneOffset() / 60;
    const LSTM    = 15 * tzOff;
    const TC      = 4 * (lon - LSTM) + ET;
    const noon    = 12 - TC/60;
    const sunrise = noon - HA/15;
    const sunset  = noon + HA/15;
    return {
      sunrise: +sunrise.toFixed(3),
      sunset:  +sunset.toFixed(3),
      noon:    +noon.toFixed(3),
      dayLen:  +(sunset - sunrise).toFixed(2)
    };
  }

  /* ── Format decimal hours to HH:MM ─────────────────────────── */
  function fmtHour(h) {
    if (h < 0 || h > 24) return '--:--';
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }

  /* ── Clearness Index ────────────────────────────────────────── */
  function clearnessIndex(G_measured, G0) {
    if (!G0 || G0 < 10) return null;
    return Math.min(1, Math.max(0, G_measured / G0));
  }

  /* ── Render solar panel UI ───────────────────────────────────── */
  function renderPanel(pos, times, measuredG) {
    const el = id => document.getElementById(id);
    const set = (id,v) => { const e=el(id); if(e) e.textContent=v; };

    set('sol-elev',   pos.elevation > 0 ? pos.elevation.toFixed(1)+'°' : 'Below horizon');
    set('sol-az',     pos.azimuth.toFixed(1)+'°');
    set('sol-g0',     pos.G0 + ' W/m²');
    set('sol-gb',     pos.Gb + ' W/m²');
    set('sol-am',     pos.AM > 0 ? pos.AM.toFixed(2) : '--');
    set('sol-rise',   fmtHour(times.sunrise));
    set('sol-set',    fmtHour(times.sunset));
    set('sol-noon',   fmtHour(times.noon));
    set('sol-daylen', times.dayLen.toFixed(1)+'h');
    set('sol-rise-lbl', fmtHour(times.sunrise));
    set('sol-set-lbl', fmtHour(times.sunset));

    const ki = el('sol-kt');
    if (ki && measuredG > 0 && pos.G0 > 10) {
      const kt = clearnessIndex(measuredG, pos.G0);
      ki.textContent = (kt*100).toFixed(0)+'%';
      ki.style.color = kt>0.7?'var(--on)':kt>0.4?'var(--al-warn)':'var(--al-crit)';
    } else if (ki) { ki.textContent='--'; }

    // Sun arc SVG
    const arc = el('sol-arc-sun');
    if (arc) {
      const d = new Date();
      const h = d.getHours() + d.getMinutes()/60;
      const pct = (h - times.sunrise) / Math.max(0.1, times.dayLen);
      const clampedPct = Math.max(0, Math.min(1, pct));
      // Sun position on semicircle: x=20+80*pct, y tracks sin curve
      const angle = clampedPct * Math.PI;
      const cx = 10 + 80 * clampedPct;
      const cy = 50 - 38 * Math.sin(angle);
      arc.setAttribute('cx', cx.toFixed(1));
      arc.setAttribute('cy', cy.toFixed(1));
      arc.style.fill = pos.elevation > 0 ? '#f9a825' : '#72706d';
    }

    // Elevation colour
    const elevEl = el('sol-elev');
    if (elevEl) elevEl.style.color = pos.elevation>30?'var(--al-warn)':pos.elevation>0?'var(--on)':'var(--pbi-muted)';
  }

  /* ── Tick ────────────────────────────────────────────────────── */
  function tick(measuredG) {
    const now  = new Date();
    const pos  = position(_lat, _lon, now);
    const times = sunTimes(_lat, _lon, now);
    renderPanel(pos, times, measuredG || 0);
    if (_onUpdate) _onUpdate(pos, times);
    return { pos, times };
  }

  /* ── Public API ──────────────────────────────────────────────── */
  global.SOLAR = {
    setLocation: (lat, lon) => { _lat = +lat || 24; _lon = +lon || 45; },
    start: (measuredG, onUpdate) => {
      _onUpdate = onUpdate;
      if (_updateTimer) clearInterval(_updateTimer);
      _updateTimer = setInterval(() => tick(measuredG), 30000);
      return tick(measuredG);
    },
    tick,
    position: (lat, lon, date) => position(lat||_lat, lon||_lon, date||new Date()),
    sunTimes:  (lat, lon, date) => sunTimes(lat||_lat, lon||_lon, date||new Date()),
    fmtHour,
    clearness: clearnessIndex
  };

})(window);
