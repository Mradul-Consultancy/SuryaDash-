/* ═══════════════════════════════════════════════════════════════
   alarms.js v5  ·  Full alarm engine + sound + notifications
   NEW: stagnation, freeze, night-cooling, predictive maintenance
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  let _thresh = {
    T3max:90, T4max:75, T1max:70, F1min:0.5, balMin:85, effMin:30,
    stagnateT:95,    // °C  — absorber stagnation
    freezeT:  5,     // °C  — freeze risk
    nightDT:  3,     // °C  — night cooling delta
    effTrend: 15     // %   — efficiency decline per 10 readings triggers warning
  };

  let _soundOn = true;
  let _pushOn  = false;
  let _active  = {};
  let _history = [];
  let _audioCtx = null;
  let _effHist  = [];   // rolling efficiency history for trend
  const EFF_WINDOW = 10;

  function ctx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    return _audioCtx;
  }

  function beep(freq, dur, vol=0.1) {
    if (!_soundOn) return;
    try {
      const c=ctx(), o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type='square'; o.frequency.value=freq;
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+dur);
      o.start(c.currentTime); o.stop(c.currentTime+dur);
    } catch(e){}
  }

  function playAlarm(lvl) {
    if (!_soundOn) return;
    if (lvl==='crit') { beep(880,.1); setTimeout(()=>beep(880,.1),180); setTimeout(()=>beep(1174,.15),360); }
    else if (lvl==='warn') { beep(440,.28); }
    else { beep(330,.18,.07); }
  }

  function playOk()   { beep(523,.15,.07); setTimeout(()=>beep(659,.18,.07),200); }
  function playConn() { beep(440,.08,.06); setTimeout(()=>beep(554,.08,.06),140); setTimeout(()=>beep(659,.18,.06),280); }

  async function requestPush() {
    if (!('Notification' in window)) return false;
    if (Notification.permission==='granted') { _pushOn=true; return true; }
    if (Notification.permission!=='denied') {
      const r = await Notification.requestPermission();
      _pushOn = r==='granted'; return _pushOn;
    }
    return false;
  }

  function pushNotif(title, body) {
    if (!_pushOn || Notification.permission!=='granted') return;
    try { new Notification(title, { body }); } catch(e){}
  }

  function addHistory(lvl, icon, msg) {
    const d=new Date();
    const ts=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    _history.unshift({ lvl, icon, msg, ts });
    if (_history.length>120) _history.pop();
    renderPanel();
    updateBell();
  }

  function updateBell() {
    const n=Object.values(_active).filter(Boolean).length;
    const b=document.getElementById('alert-badge');
    if (!b) return;
    b.style.display=n>0?'flex':'none';
    b.textContent=n;
  }

  function toast(lvl, icon, title, msg) {
    const c=document.getElementById('toast-container'); if(!c) return;
    const t=document.createElement('div');
    t.className=`toast ${lvl}`;
    t.innerHTML=`<div class="toast-ico">${icon}</div><div class="toast-body"><div class="toast-ttl">${title}</div><div class="toast-msg">${msg}</div></div><button class="toast-cls" onclick="this.closest('.toast').remove()">✕</button>`;
    c.appendChild(t);
    setTimeout(()=>{ if(t.parentNode) t.remove(); }, 7000);
  }

  /* ── Predictive: efficiency trend ──────────────────────────── */
  function checkEffTrend(eff) {
    _effHist.push(eff);
    if (_effHist.length > EFF_WINDOW) _effHist.shift();
    if (_effHist.length < EFF_WINDOW) return null;
    const first = _effHist.slice(0,3).reduce((a,b)=>a+b,0)/3;
    const last  = _effHist.slice(-3).reduce((a,b)=>a+b,0)/3;
    return first > 5 ? ((first-last)/first)*100 : null;
  }

  /* ── Alarm rules ────────────────────────────────────────────── */
  function buildRules(vals, calc, ctrl) {
    const v=vals, c=calc;
    return [
      // Original rules
      { key:'T3-hi',    lvl:'crit', icon:'🔥', card:'sc-T3', al:'a-T3', fire:v.T3>_thresh.T3max,                           msg:`T3 Absorber ${v.T3.toFixed(1)}°C exceeds max ${_thresh.T3max}°C` },
      { key:'T4-hi',    lvl:'warn', icon:'⚠',  card:'sc-T4', al:'a-T4', fire:v.T4>_thresh.T4max,                           msg:`T4 Outlet ${v.T4.toFixed(1)}°C exceeds max ${_thresh.T4max}°C`   },
      { key:'T1-hi',    lvl:'warn', icon:'⚠',  card:'sc-T1', al:'a-T1', fire:v.T1>_thresh.T1max,                           msg:`T1 Storage ${v.T1.toFixed(1)}°C exceeds max ${_thresh.T1max}°C` },
      { key:'F1-lo',    lvl:'crit', icon:'💧', card:'sc-F1', al:'a-F1', fire:v.F1<_thresh.F1min&&ctrl.pump,                msg:`Low flow: ${v.F1.toFixed(2)} L/min (min ${_thresh.F1min})`        },
      { key:'bal',      lvl:'warn', icon:'⚖',  card:'sc-F2', al:'a-F2', fire:c.bal<_thresh.balMin,                         msg:`Flow imbalance: ${c.bal.toFixed(1)}% (min ${_thresh.balMin}%)`    },
      { key:'eff-lo',   lvl:'info', icon:'📉', card:'sc-T2', al:'a-T2', fire:c.eff<_thresh.effMin&&ctrl.pump,              msg:`Low efficiency: ${c.eff.toFixed(0)}% (target ${_thresh.effMin}%)` },

      // NEW v5 rules
      { key:'stagnate', lvl:'crit', icon:'🌡🔥', card:'sc-T3', al:'a-T3', fire:v.T3>_thresh.stagnateT&&v.F1<0.2&&ctrl.pump, msg:`⚠ STAGNATION — T3 ${v.T3.toFixed(1)}°C with near-zero flow! Overheating risk.` },
      { key:'freeze',   lvl:'crit', icon:'🧊',  card:'sc-T1', al:'a-T1', fire:v.T1<_thresh.freezeT||v.T2<_thresh.freezeT,  msg:`FREEZE RISK — ${Math.min(v.T1,v.T2).toFixed(1)}°C is near freezing point!`   },
      { key:'nightcool',lvl:'warn', icon:'🌙',  card:'sc-T4', al:'a-T4', fire:ctrl.pump&&(v.T4<v.T1-_thresh.nightDT),      msg:`Night cooling: T4(${v.T4.toFixed(1)}) < T1(${v.T1.toFixed(1)}) — heat loss!`  },
      { key:'dry-run',  lvl:'crit', icon:'🚫',  card:'sc-F1', al:'a-F1', fire:ctrl.pump&&v.F1<0.05,                        msg:`Dry-run risk — pump running with zero flow! Check valve/priming.`            },
    ];
  }

  function check(vals, calc, ctrl) {
    const rules = buildRules(vals, calc, ctrl);

    // Predictive efficiency trend
    const trendDrop = checkEffTrend(calc.eff);
    if (trendDrop !== null && trendDrop > _thresh.effTrend && ctrl.pump) {
      if (!_active['eff-trend']) {
        _active['eff-trend'] = true;
        const m = `Efficiency dropped ${trendDrop.toFixed(0)}% over last ${EFF_WINDOW} readings — check fouling/scaling`;
        playAlarm('warn');
        addHistory('warn','🔮',m);
        toast('warn','🔮','Predictive Alert',m);
      }
    } else { _active['eff-trend'] = false; }

    rules.forEach(r => {
      const card=document.getElementById(r.card);
      const alEl=document.getElementById(r.al);
      if (r.fire) {
        if (card) { card.className=card.className.replace(/alarm-\w+/g,''); card.classList.add('alarm-'+r.lvl); }
        if (alEl) { alEl.textContent=r.icon+' '+r.msg; alEl.className='s-alarm '+r.lvl; }
        if (!_active[r.key]) {
          _active[r.key]=true;
          playAlarm(r.lvl);
          pushNotif(r.key.toUpperCase(), r.msg);
          addHistory(r.lvl, r.icon, r.msg);
          toast(r.lvl, r.icon, r.key.replace(/-/g,' ').toUpperCase(), r.msg);
        }
      } else {
        if (_active[r.key]) _active[r.key]=false;
        if (card) card.className=card.className.replace(/alarm-\w+/g,'');
        if (alEl) { alEl.textContent=''; alEl.className='s-alarm'; }
      }
    });
    updateBell();
  }

  function renderPanel() {
    const list=document.getElementById('alert-list'); if(!list) return;
    if (!_history.length) { list.innerHTML='<div class="empty-msg">No alarms</div>'; return; }
    list.innerHTML=_history.slice(0,60).map(a=>
      `<div class="alert-item ${a.lvl}"><span class="alert-icon">${a.icon}</span><span class="alert-msg">${a.msg}</span><span class="alert-time">${a.ts}</span></div>`
    ).join('');
  }

  global.ALARMS = {
    check,
    setThresholds: t => Object.assign(_thresh, t),
    getThresholds: () => ({..._thresh}),
    setSound:  on => { _soundOn=!!on; },
    isSoundOn: ()  => _soundOn,
    setPush:   on => { _pushOn=!!on; },
    requestPush,
    getHistory: () => [..._history],
    clearAll: () => { _history=[]; _active={}; _effHist=[]; renderPanel(); updateBell(); },
    playOk, playConn, toast,
    renderPanel
  };

})(window);
