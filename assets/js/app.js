/* ═══════════════════════════════════════════════════════════════
   app.js v6  ·  Main orchestrator
   NEW: Auth gate (login/signup), multi-site switching
   Integrates: FB · AUTH · SITES · CHARTS · ALARMS · ANALYTICS · SOLAR · ROI
   ═══════════════════════════════════════════════════════════════ */
'use strict';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

/* ── Config ───────────────────────────────────────────────────── */
let POLL_SEC  = 2;
let UNIT_F    = false;
let COLL_AREA = 2.0;
let IRRAD_G   = 0;
let LAT       = 24.0, LON = 45.0;
let PIPE_LEN  = 10;
let PIPE_DIA  = 0.025;
let WEB_API_KEY = '';   // Firebase Web API Key — required for real login
window.APP_POLL_SEC = POLL_SEC;

const Cp      = 4186;
const DENSITY = 1.0;
const MAX_LOG = 300;
const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');

/* ── State ────────────────────────────────────────────────────── */
let prevVals={}, logRows=[], isLive=false, demoTimer=null, prevCtrl={};
let pollTimer=null, appStarted=false;
const MM={ T1:[Infinity,-Infinity],T2:[Infinity,-Infinity],T3:[Infinity,-Infinity],T4:[Infinity,-Infinity],F1:[Infinity,-Infinity],F2:[Infinity,-Infinity] };

/* ═══════════════════════════════════════════════════════════════
   AUTH GATE
   ═══════════════════════════════════════════════════════════════ */
function loadAuthConfig() {
  try {
    const s = JSON.parse(localStorage.getItem('solar-v6-settings')||'{}');
    WEB_API_KEY = s.webApiKey || '';
    if (s.fbURL) FB.setURL(s.fbURL);
  } catch(e){}
}

function showLoginScreen() {
  const gate = $('auth-gate');
  const app  = $('app-root');
  if (gate) gate.style.display = 'flex';
  if (app)  app.style.display  = 'none';
}

function hideLoginScreen() {
  const gate = $('auth-gate');
  const app  = $('app-root');
  if (gate) gate.style.display = 'none';
  if (app)  app.style.display  = '';
}

window.doSignIn = async function() {
  if (!window.UX?.validateAuthForm()) return;
  const email = $('auth-email')?.value.trim();
  const pass  = $('auth-pass')?.value;
  const err   = $('auth-error');
  if (!WEB_API_KEY) { showAuthError('Set your Firebase Web API Key in the config box below first.'); return; }
  const btn = $('btn-signin');
  window.UX?.setBtnLoading(btn, true, 'Signing in…');
  try {
    AUTH.configure(WEB_API_KEY);
    await AUTH.signIn(email, pass);
    if (err) err.textContent='';
    window.TRACKING?.event('login', { method:'password' });
  } catch(e) { showAuthError(friendlyAuthError(e)); }
  finally { window.UX?.setBtnLoading(btn, false); }
};

let _justSignedUp = false;
window.doSignUp = async function() {
  if (!window.UX?.validateAuthForm()) return;
  const email = $('auth-email')?.value.trim();
  const pass  = $('auth-pass')?.value;
  if (!WEB_API_KEY) { showAuthError('Set your Firebase Web API Key in the config box below first.'); return; }
  const btn = $('btn-signup');
  window.UX?.setBtnLoading(btn, true, 'Creating account…');
  try {
    AUTH.configure(WEB_API_KEY);
    await AUTH.signUp(email, pass);
    $('auth-error').textContent='';
    _justSignedUp = true;
    window.TRACKING?.event('sign_up', { method:'password' });
  } catch(e) { showAuthError(friendlyAuthError(e)); }
  finally { window.UX?.setBtnLoading(btn, false); }
};

window.doDemoMode = function() {
  // Explicit "skip login, just show the demo" path — clearly labeled
  hideLoginScreen();
  isDemoOnly = true;
  boot();
};

window.saveWebApiKey = function() {
  const k = $('auth-apikey')?.value.trim();
  if (!k) return;
  WEB_API_KEY = k;
  const s = JSON.parse(localStorage.getItem('solar-v6-settings')||'{}');
  s.webApiKey = k;
  localStorage.setItem('solar-v6-settings', JSON.stringify(s));
  showAuthError('Key saved. Try signing in now.', true);
};

function showAuthError(msg, ok=false) {
  const err = $('auth-error');
  if (err) { err.textContent = msg; err.style.color = ok ? 'var(--on)' : 'var(--al-crit)'; }
}

let isDemoOnly = false;

/* Firebase Auth returns codes like INVALID_LOGIN_CREDENTIALS — show something a person can act on */
function friendlyAuthError(e) {
  const m = String((e && e.message) || e || '');
  const rules = [
    [/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/, 'Incorrect email or password.'],
    [/EMAIL_EXISTS/, 'An account with this email already exists — try Sign In instead.'],
    [/WEAK_PASSWORD/, 'Password is too weak (minimum 6 characters).'],
    [/INVALID_EMAIL/, 'That email address is not valid.'],
    [/TOO_MANY_ATTEMPTS/, 'Too many attempts. Please wait a few minutes and try again.'],
    [/USER_DISABLED/, 'This account has been disabled.'],
    [/API_KEY_INVALID|API key not valid|INVALID_API_KEY/, 'That Firebase Web API Key is not valid. Copy it again from Firebase Console → Project settings → General.'],
    [/OPERATION_NOT_ALLOWED/, 'Email/password sign-in is not enabled. Turn it on in Firebase Console → Authentication → Sign-in method.'],
    [/Failed to fetch|NetworkError|network/i, 'Network error — check your connection and try again.']
  ];
  for (const [re, msg] of rules) if (re.test(m)) return msg;
  return m || 'Something went wrong. Please try again.';
}


/* ═══════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════ */
function loadSettings() {
  try {
    const s=JSON.parse(localStorage.getItem('solar-v6-settings')||'{}');
    if (s.thresh)    ALARMS.setThresholds(s.thresh);
    if (s.sound!==undefined) ALARMS.setSound(s.sound);
    if (s.pollSec)   POLL_SEC=+s.pollSec;
    if (s.unitF!==undefined) UNIT_F=!!s.unitF;
    if (s.collArea)  COLL_AREA=+s.collArea;
    if (s.irradG)    IRRAD_G=+s.irradG;
    if (s.lat)       LAT=+s.lat;
    if (s.lon)       LON=+s.lon;
    if (s.pipeLen)   PIPE_LEN=+s.pipeLen;
    if (s.pipeDia)   PIPE_DIA=+s.pipeDia;
    if (s.theme)     setTheme(s.theme);
    if (s.roi)       ROI.set(s.roi);
    if (s.fbURL)     FB.setURL(s.fbURL);
    if (s.webApiKey) { WEB_API_KEY=s.webApiKey; const el=$('auth-apikey'); if(el) el.value=s.webApiKey; }
    populateForm(s);
  } catch(e){}
}

function saveSettings() {
  const s={
    thresh:ALARMS.getThresholds(), sound:ALARMS.isSoundOn(),
    pollSec:POLL_SEC, unitF:UNIT_F, collArea:COLL_AREA, irradG:IRRAD_G,
    lat:LAT, lon:LON, pipeLen:PIPE_LEN, pipeDia:PIPE_DIA,
    theme:document.documentElement.getAttribute('data-theme')||'dark',
    roi:ROI.get(), fbURL:$('set-fb-url')?.value||FB.baseURL, webApiKey:WEB_API_KEY
  };
  localStorage.setItem('solar-v6-settings', JSON.stringify(s));
}

function populateForm(s) {
  const t=ALARMS.getThresholds();
  const g=ROI.get();
  const sv=(id,v)=>{ const e=$(id); if(e) e.value=v; };
  sv('set-T3-max',t.T3max); sv('set-T4-max',t.T4max); sv('set-T1-max',t.T1max);
  sv('set-F1-min',t.F1min); sv('set-bal-min',t.balMin); sv('set-eff-min',t.effMin);
  sv('set-stagnate',t.stagnateT||95); sv('set-freeze',t.freezeT||5);
  sv('set-poll',POLL_SEC); sv('set-area',COLL_AREA); sv('set-irrad',IRRAD_G);
  sv('set-lat',LAT); sv('set-lon',LON);
  sv('set-pipe-len',PIPE_LEN); sv('set-pipe-dia',PIPE_DIA);
  sv('set-tariff',g.tariff); sv('set-co2',g.co2);
  sv('set-dton',g.dtOn); sv('set-dtoff',g.dtOff); sv('set-ambient',g.ambient);
  sv('set-fb-url',FB.baseURL);
  const snd=$('set-sound'); if(snd) snd.checked=ALARMS.isSoundOn();
  const utF=$('set-unit-f'); if(utF) utF.checked=UNIT_F;
  SOLAR.setLocation(LAT,LON);
}

window.applySettings = function() {
  if (!window.UX?.validateDifferentialThresholds()) {
    ALARMS.toast('crit','✘','Invalid Settings','Fix the differential threshold error before saving.');
    return;
  }
  const n=id=>(+($(id)?.value||0));
  const str=id=>($(id)?.value||'').trim();
  ALARMS.setThresholds({
    T3max:n('set-T3-max'), T4max:n('set-T4-max'), T1max:n('set-T1-max'),
    F1min:n('set-F1-min'), balMin:n('set-bal-min'), effMin:n('set-eff-min'),
    stagnateT:n('set-stagnate'), freezeT:n('set-freeze')
  });
  ALARMS.setSound($('set-sound')?.checked??true);
  UNIT_F=($('set-unit-f')?.checked??false);
  COLL_AREA=n('set-area')||2; IRRAD_G=n('set-irrad');
  LAT=n('set-lat')||24; LON=n('set-lon')||45;
  PIPE_LEN=n('set-pipe-len')||10; PIPE_DIA=n('set-pipe-dia')||0.025;
  ROI.set({ tariff:n('set-tariff'), co2:n('set-co2'), dtOn:n('set-dton'), dtOff:n('set-dtoff'), ambient:n('set-ambient') });
  SOLAR.setLocation(LAT,LON);
  const np=Math.max(1,Math.min(60,n('set-poll')));
  if (np!==POLL_SEC) { POLL_SEC=np; window.APP_POLL_SEC=np; restartPoll(); }
  const url=str('set-fb-url'); if(url) FB.setURL(url);
  saveSettings();
  ALARMS.toast('ok','✔','Settings saved','All changes applied.');
  SOLAR.tick(IRRAD_G);
};

window.testFbConn=()=>{ FB.fetchNow(); ALARMS.toast('info','🔁','Reconnecting','Testing connection…'); };
window.clearSession=()=>{
  ANALYTICS.reset(); ROI.reset(); logRows=[]; ALARMS.clearAll();
  Object.keys(MM).forEach(k=>{MM[k]=[Infinity,-Infinity];});
  const b=$('log-body'); if(b) b.innerHTML='<tr><td colspan="14" class="empty-msg">Cleared</td></tr>';
  const c=$('log-cnt'); if(c) c.textContent='0 records';
  ALARMS.toast('ok','🔄','Reset','Session data cleared.');
};

window.doSignOutApp = function() {
  AUTH.signOut();
  stopDemo(); FB.stop();
  appStarted = false;
  showLoginScreen();
};

/* ═══════════════════════════════════════════════════════════════
   SITE SWITCHER
   ═══════════════════════════════════════════════════════════════ */
async function initSites() {
  SITES.setBase(FB.baseURL);
  SITES.onSwitch((id, meta) => {
    logRows=[]; Object.keys(MM).forEach(k=>MM[k]=[Infinity,-Infinity]);
    prevVals={};
    const nameEl=$('site-name-display'); if(nameEl) nameEl.textContent = meta?.name || id;
    const sn=$('set-site-name'), si=$('set-site-id'), sec=$('site-info-section');
    if(sn) sn.value = meta?.name || ''; if(si) si.value = id; if(sec) sec.style.display = '';
    isLive=false; restartPoll(); FB.fetchNow();
  });

  const sites = await SITES.listMySites();
  if (!sites.length) {
    // First-time user — auto create a default site
    try {
      const s = await SITES.createSite('Main Collector');
      sites.push(s);
    } catch(e){ console.warn('Could not create default site', e); ALARMS.toast('crit','✘','Could not create your first site', e.message); }
  }
  SITES.renderSwitcher(sites);
  const last = SITES.restoreLastSite();
  const target = sites.find(s=>s.id===last) ? last : sites[0]?.id;
  if (target) SITES.switchTo(target);

  const switcherEl = $('site-switcher');
  if (switcherEl && !switcherEl.dataset.bound) {
    switcherEl.dataset.bound = '1';
    switcherEl.addEventListener('change', async (e) => {
      if (e.target.value === '__new__') {
        const name = prompt('Name for the new site:', 'New Collector');
        if (name) {
          const s = await SITES.createSite(name);
          const all = await SITES.listMySites();
          SITES.renderSwitcher(all);
          SITES.switchTo(s.id);
        } else {
          SITES.renderSwitcher(sites);
        }
      } else {
        SITES.switchTo(e.target.value);
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   THEME
   ═══════════════════════════════════════════════════════════════ */
function setTheme(t) { document.documentElement.setAttribute('data-theme',t); const b=$('theme-btn'); if(b) b.textContent=t==='light'?'🌙':'☀'; }
window.toggleTheme=()=>{ const c=document.documentElement.getAttribute('data-theme')||'dark'; setTheme(c==='dark'?'light':'dark'); saveSettings(); };

/* ═══════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════ */
const TAB_TITLES = {
  dashboard: 'Dashboard — SuryaDash',
  analytics: 'Analytics — SuryaDash',
  report:    'Report — SuryaDash',
  settings:  'Settings — SuryaDash'
};
window.switchTab=function(tab) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));
  document.title = TAB_TITLES[tab] || 'SuryaDash';
  window.mnavSync?.(tab);
  window.TRACKING?.pageview('/'+tab);
  if (tab==='analytics') setTimeout(()=>ANALYTICS.renderAnalytics(IRRAD_G, ROI.get().ambient),50);
  if (tab==='report')    setTimeout(()=>ANALYTICS.buildReport(),50);
  if (tab==='settings')  populateForm({});
};

/* ═══════════════════════════════════════════════════════════════
   CLOCK
   ═══════════════════════════════════════════════════════════════ */
function tickClock() {
  const d=new Date();
  const t=$('clk-t'); if(t) t.textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const dt=$('clk-d'); if(dt) dt.textContent=`${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
setInterval(tickClock,1000); tickClock();

/* ═══════════════════════════════════════════════════════════════
   THERMAL CALCULATIONS
   ═══════════════════════════════════════════════════════════════ */
function thermalCalc(v) {
  const mDot=(v.F1/60)*DENSITY;
  const dT=Math.max(0,v.T4-v.T2);
  const Qw=mDot*Cp*dT;
  const kW=Qw/1000;
  let eff;
  if (IRRAD_G>0&&COLL_AREA>0) eff=Math.min(100,(Qw/(IRRAD_G*COLL_AREA))*100);
  else eff=Math.min(100,(Qw/((5/60)*Cp*40))*100);
  const maxF=Math.max(v.F1,v.F2,0.0001);
  const bal=(1-Math.abs(v.F1-v.F2)/maxF)*100;
  const Tm=(v.T2+v.T4)/2;
  const pipeLoss=window.ROI?ROI.pipeLoss(Tm,PIPE_LEN,PIPE_DIA):0;
  return { kW, eff, bal, dT, Qw, Tm, pipeLoss };
}

/* ═══════════════════════════════════════════════════════════════
   HEALTH SCORE
   ═══════════════════════════════════════════════════════════════ */
function healthScore(v, calc, ctrl) {
  let s=100;
  const th=ALARMS.getThresholds();
  if (v.T3>th.T3max) s-=25; if (v.T4>th.T4max) s-=18;
  if (v.T1>th.T1max) s-=12; if (v.F1<th.F1min&&ctrl.pump) s-=22;
  if (calc.bal<th.balMin) s-=12; if (calc.eff<th.effMin&&ctrl.pump) s-=8;
  if (v.T3>=(th.stagnateT||95)) s-=20;
  if (v.T1<(th.freezeT||5)||v.T2<(th.freezeT||5)) s-=25;
  s=Math.max(0,s);
  let state='OPTIMAL',icon='🟢',color='#26de81';
  if (s<80){state='DEGRADED';icon='🟡';color='#fed330';}
  if (s<50){state='CRITICAL';icon='🔴';color='#ff5e57';}
  if (!ctrl.power){state='STANDBY';icon='⚪';color='#72706d';}
  return {s,state,icon,color};
}

/* ═══════════════════════════════════════════════════════════════
   KPI + ROI STRIPS
   ═══════════════════════════════════════════════════════════════ */
let pkw=0;
function updateKPI(calc,health,totals) {
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v;};
  set('kv-power', calc.kW.toFixed(2));
  set('ks-power', calc.kW>=pkw?'▲ rising':'▼ falling');
  const ks=$('ks-power'); if(ks) ks.style.color=calc.kW>=pkw?'var(--on)':'var(--al-crit)';
  pkw=calc.kW;
  set('kv-dt', calc.dT.toFixed(1));
  set('kv-flow', calc.bal.toFixed(1));
  set('kv-energy', totals.totalKWh.toFixed(3));
  set('kv-daily', totals.dailyKWh.toFixed(3));
  set('kv-eff', calc.eff.toFixed(0));
  set('kv-ploss', calc.pipeLoss.toFixed(3));
  const arc=$('arc-fill');
  if(arc){arc.style.strokeDasharray=`${Math.min(1,calc.eff/100)*78.5} 78.5`;arc.style.stroke=calc.eff>60?'var(--on)':calc.eff>30?'#fed330':'#ff5e57';}
  set('kv-health',health.state); const hEl=$('kv-health'); if(hEl)hEl.style.color=health.color;
  const hi=$('health-icon'); if(hi)hi.textContent=health.icon;
  const hb=$('health-bar'); if(hb){hb.style.width=health.s+'%';hb.style.background=health.color;}
}
function updateROI(totals, uptime) { ROI.renderStrip(totals.totalKWh, uptime); }

/* ═══════════════════════════════════════════════════════════════
   SENSOR CARDS
   ═══════════════════════════════════════════════════════════════ */
function cvt(v) { return UNIT_F?(v*9/5+32).toFixed(1):v.toFixed(1); }
function updateSensor(key,val,isTemp,elV,elD,elMM) {
  const v=parseFloat(val); if(isNaN(v))return;
  if(elV) elV.textContent=isTemp?cvt(v):v.toFixed(2);
  const prev=prevVals[key];
  if(prev!==undefined&&elD){const d=v-prev;elD.textContent=`${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(isTemp?1:2)}`;elD.className='s-delta '+(d>=0?'up':'down');}
  prevVals[key]=v;
  if(v<MM[key][0])MM[key][0]=v; if(v>MM[key][1])MM[key][1]=v;
  if(elMM)elMM.textContent=`↓${isTemp?cvt(MM[key][0]):MM[key][0].toFixed(2)} ↑${isTemp?cvt(MM[key][1]):MM[key][1].toFixed(2)}`;
}

/* ═══════════════════════════════════════════════════════════════
   CONTROLS
   ═══════════════════════════════════════════════════════════════ */
function setControl(card,statusEl,state,isPump=false) {
  const on=state===true||state===1||state==='true'||state==='on'||state==='1';
  card.className='c-card'+(isPump?' c-card--pump':'')+(on?' on':' off');
  card.style.setProperty('--state-col',on?'var(--on)':'var(--off)');
  if(statusEl)statusEl.textContent=on?'ON':'OFF';
  return on;
}
function setupClicks() {
  [['c-power','power'],['c-sol','solenoid'],['c-pump','pump'],['c-lamp','lamp']].forEach(([id,key])=>{
    const card=$(id); if(!card) return;
    card.addEventListener('click',async()=>{
      if(!isLive){ALARMS.toast('warn','⚠','Offline','Connect Firebase to control.');return;}
      if(isDemoOnly){ALARMS.toast('warn','⚠','Demo Mode','Sign in to control real devices.');return;}
      const ok=await FB.write((window.SITES?.getCurrent?.()?'/controls/':'/')+key,!prevCtrl[key]);
      if(ok){prevCtrl[key]=!prevCtrl[key]; ALARMS.toast('ok',prevCtrl[key]?'⚡':'⭕',key,'Set to '+(prevCtrl[key]?'ON':'OFF'));}
      else ALARMS.toast('crit','✘','Write Failed','Cannot send command.');
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   PRESSURE
   ═══════════════════════════════════════════════════════════════ */
function setPressure(p) {
  const pct=Math.max(0,Math.min(100,+p||0));
  const col=pct<=33?'#26de81':pct<=66?'#fed330':'#ff5e57';
  const f=$('pressure-fill'); if(f){f.style.height=pct+'%';f.style.background=col;}
  const l=$('pressure-label'); if(l)l.textContent=Math.round(pct)+'%';
}

/* ═══════════════════════════════════════════════════════════════
   LOG
   ═══════════════════════════════════════════════════════════════ */
function addLogRow(v,ctrl,calc) {
  const d=new Date();
  const ts=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  logRows.unshift({ts,T1:v.T1.toFixed(1),T2:v.T2.toFixed(1),T3:v.T3.toFixed(1),T4:v.T4.toFixed(1),F1:v.F1.toFixed(2),F2:v.F2.toFixed(2),kW:calc.kW.toFixed(2),eff:calc.eff.toFixed(0),ploss:calc.pipeLoss.toFixed(3),power:ctrl.power?'ON':'OFF',sol:ctrl.solenoid?'ON':'OFF',pump:ctrl.pump?'ON':'OFF',lamp:ctrl.lamp?'ON':'OFF'});
  if(logRows.length>MAX_LOG)logRows.pop();
  const c=$('log-cnt'); if(c)c.textContent=logRows.length+' records';
  if(logRows.length<=80)renderLog();
}
function renderLog() {
  const b=$('log-body'); if(!b) return;
  b.innerHTML=logRows.slice(0,80).map(r=>`<tr><td>${r.ts}</td><td>${r.T1}</td><td>${r.T2}</td><td>${r.T3}</td><td>${r.T4}</td><td>${r.F1}</td><td>${r.F2}</td><td style="color:var(--pbi-accent)">${r.kW}</td><td style="color:var(--on)">${r.eff}%</td><td style="color:var(--al-info)">${r.ploss}</td><td class="${r.power==='ON'?'td-on':'td-off'}">${r.power}</td><td class="${r.sol==='ON'?'td-on':'td-off'}">${r.sol}</td><td class="${r.pump==='ON'?'td-on':'td-off'}">${r.pump}</td><td class="${r.lamp==='ON'?'td-on':'td-off'}">${r.lamp}</td></tr>`).join('');
}
window.downloadCSV=()=>{
  if(!logRows.length){alert('No data.');return;}
  const h='Timestamp,T1,T2,T3,T4,F1,F2,kW,Eff%,PipeLoss_kW,Power,Solenoid,Pump,Lamp\n';
  const b=logRows.map(r=>`${r.ts},${r.T1},${r.T2},${r.T3},${r.T4},${r.F1},${r.F2},${r.kW},${r.eff},${r.ploss},${r.power},${r.sol},${r.pump},${r.lamp}`).join('\n');
  Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([h+b],{type:'text/csv'})),download:`solar_${new Date().toISOString().slice(0,10)}.csv`}).click();
};
window.printReport=()=>ANALYTICS.printReport();

/* ═══════════════════════════════════════════════════════════════
   FIREBASE INSPECTOR
   ═══════════════════════════════════════════════════════════════ */
const SC_COL={T1:'#f7b731',T2:'#26de81',T3:'#ff5e57',T4:'#45aaf2',F1:'#a55eea',F2:'#fd9644'};
function renderInspector(raw,st) {
  const set=(id,v)=>{const e=$(id);if(e)e.textContent=v;};
  const rl=$('fbi-ring-large'),se=$('fbi-conn-state'),de=$('fbi-conn-detail'),uc=$('fbi-url-chip');
  if(st.state==='connected'){if(rl)rl.className='fbi-conn-ring-large connected';if(se){se.textContent='✔ CONNECTED';se.style.color='var(--on)';}if(de)de.textContent=`Firebase RTDB responding · ${st.ms}ms · avg ${st.avgMs}ms`;if(uc)uc.className='fbi-url-chip connected';}
  else{if(rl)rl.className='fbi-conn-ring-large disconnected';if(se){se.textContent='✘ NOT CONNECTED';se.style.color='var(--al-crit)';}if(de)de.textContent=`Offline · ${st.failCount} failures · DEMO mode`;if(uc)uc.className='fbi-url-chip disconnected';}
  set('fcs-status',st.state==='connected'?'ONLINE ✔':'OFFLINE ✘');const ss=$('fcs-status');if(ss)ss.style.color=st.state==='connected'?'var(--on)':'var(--al-crit)';
  set('fcs-rt',st.ms?st.ms+'ms':'—');set('fcs-avg',st.avgMs?st.avgMs+'ms':'—');set('fcs-count',st.fetchCount);set('fcs-fails',st.failCount||0);set('fcs-mode','REST API');
  const d=new Date(); set('fbi-last',`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
  if(!raw)return;
  set('fcs-keys',Object.keys(raw).length+' keys');set('fcs-size',new Blob([JSON.stringify(raw)]).size+' B');
  const tree=$('fbi-schema-tree');
  if(tree){tree.innerHTML='';Object.entries(raw).forEach(([k,v])=>{const typ=typeof v==='object'?'object':typeof v;const col=SC_COL[k];const row=document.createElement('div');row.className='tree-row';row.innerHTML=`<div class="tree-sensor-dot" style="background:${col||'var(--pbi-muted)'}"></div><span class="tree-key">${k}</span><span class="tree-sep">:</span><span class="tree-val">${typ==='object'?JSON.stringify(v).slice(0,40):String(v)}</span><span class="tree-type">${typ}</span>`;tree.appendChild(row);});}
  const rw=$('fbi-raw');if(rw)rw.innerHTML=syntaxHL(JSON.stringify(raw,null,2));
}
function syntaxHL(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"([^"]+)":/g,'<span style="color:#45aaf2">"$1"</span>:').replace(/: "([^"]+)"/g,': <span style="color:#26de81">"$1"</span>').replace(/: (true|false)/g,': <span style="color:#f7b731">$1</span>').replace(/: (-?\d+\.?\d*)/g,': <span style="color:#fd9644">$1</span>');}
window.copyRaw=()=>{navigator.clipboard.writeText($('fbi-raw')?.innerText||'').then(()=>ALARMS.toast('ok','📋','Copied','Raw JSON copied.'));};
window.fetchNow=()=>FB.fetchNow();
window.toggleFBI=function(){const b=$('fbi-body');if(!b)return;const c=b.style.display==='none';b.style.display=c?'':'none';event.target.textContent=c?'— Collapse':'+ Expand';};
window.toggleAlertPanel=()=>{const p=$('alert-panel');if(p)p.style.display=p.style.display==='none'?'flex':'none';};
window.clearAlerts=()=>ALARMS.clearAll();

/* ═══════════════════════════════════════════════════════════════
   RIBBON
   ═══════════════════════════════════════════════════════════════ */
function setRibbon(state, note) {
  const b=$('fb-badge'),t=$('fb-txt'); if(!b||!t)return;
  b.classList.remove('connected','disconnected','checking'); b.classList.add(state);
  const label={connected:'CONNECTED',disconnected:'DISCONNECTED',checking:'CHECKING…'}[state]||'…';
  t.textContent = note ? label+' · '+note : label;
  const live = state==='connected' && isLive;      // LIVE only when real sensor data is arriving
  const pi=$('pill'),pt=$('pill-txt');
  if(pi)pi.className='live-pill '+(live?'live':'demo');
  if(pt)pt.textContent=live?'LIVE':'DEMO';
}

/* ═══════════════════════════════════════════════════════════════
   NORMALISE
   ═══════════════════════════════════════════════════════════════ */
function normalise(raw) {
  if(!raw)return null;
  const s=(raw.sensors&&typeof raw.sensors==='object')?raw.sensors:raw;
  const c=(raw.controls&&typeof raw.controls==='object')?raw.controls:raw;
  return {
    vals:{T1:+(s.T1??s.t1??0),T2:+(s.T2??s.t2??0),T3:+(s.T3??s.t3??0),T4:+(s.T4??s.t4??0),F1:+(s.F1??s.f1??0),F2:+(s.F2??s.f2??0)},
    ctrl:{power:!!(c.power??false),solenoid:!!(c.solenoid??false),pump:!!(c.pump??false),lamp:!!(c.lamp??false)},
    pressure:raw.pressure??s.pressure??null,
    updated_at:s.updated_at??raw.updated_at??null
  };
}

/* ═══════════════════════════════════════════════════════════════
   APPLY SNAPSHOT
   ═══════════════════════════════════════════════════════════════ */
let lastValsStr = '';
let lastValChangeTime = Date.now();

function applySnapshot(raw) {
  const n=normalise(raw); if(!n)return;
  markFirstData();
  const {vals:v,ctrl,pressure:rawP,updated_at}=n;
  const calc=thermalCalc(v);
  const health=healthScore(v,calc,ctrl);
  const pres=rawP!==null?+rawP:ctrl.pump?Math.min(100,((v.F1+v.F2)/2)*20):0;

  // Stale check
  const now = Date.now();
  let isStale = false;
  if (updated_at) {
    isStale = (now - updated_at) > 30000;
  } else {
    const valStr = JSON.stringify(v);
    if (valStr !== lastValsStr) { lastValsStr = valStr; lastValChangeTime = now; }
    isStale = (now - lastValChangeTime) > 30000;
  }
  if (isStale && isLive) {
    const pi=$('pill'),pt=$('pill-txt');
    if (pi) pi.className='live-pill demo'; // Reuse demo color (orange/grey) for stale
    if (pt) pt.textContent='STALE';
    setRibbon('disconnected', 'DEVICE OFFLINE');
  } else if (isLive && $('pill-txt')?.textContent === 'STALE') {
    const pi=$('pill'),pt=$('pill-txt');
    if (pi) pi.className='live-pill live';
    if (pt) pt.textContent='LIVE';
    setRibbon('connected');
  }

  SOLAR.tick(IRRAD_G);
  const dc=ROI.differentialCheck(v.T3,v.T1,ctrl.pump);
  ROI.renderController(dc);
  const uptime=ROI.trackUptime(ctrl.pump, calc.kW*(POLL_SEC/3600));

  updateSensor('T1',v.T1,true,$('v-T1'),$('d-T1'),$('mm-T1'));
  updateSensor('T2',v.T2,true,$('v-T2'),$('d-T2'),$('mm-T2'));
  updateSensor('T3',v.T3,true,$('v-T3'),$('d-T3'),$('mm-T3'));
  updateSensor('T4',v.T4,true,$('v-T4'),$('d-T4'),$('mm-T4'));
  updateSensor('F1',v.F1,false,$('v-F1'),$('d-F1'),$('mm-F1'));
  updateSensor('F2',v.F2,false,$('v-F2'),$('d-F2'),$('mm-F2'));

  ['c-power','c-sol','c-pump','c-lamp'].forEach((id)=>{
    const keys={'c-power':'power','c-sol':'solenoid','c-pump':'pump','c-lamp':'lamp'};
    const card=$(id); if(!card)return;
    setControl(card,$(id.replace('c-','s-')),ctrl[keys[id]],id==='c-pump');
  });
  prevCtrl={...ctrl};

  setPressure(pres);
  const totals=ANALYTICS.record(v,calc,ctrl,POLL_SEC);
  updateKPI(calc,health,totals);
  updateROI(totals,uptime);
  ALARMS.check(v,calc,ctrl);
  CHARTS.push(v,calc.kW,calc.dT,calc.eff);
  addLogRow(v,ctrl,calc);

  document.querySelectorAll('.sh-unit[data-temp]').forEach(e=>e.textContent=UNIT_F?'°F':'°C');
  document.querySelectorAll('.s-unit[data-temp]').forEach(e=>e.textContent=UNIT_F?'°F':'°C');
}

/* ═══════════════════════════════════════════════════════════════
   DEMO MODE
   ═══════════════════════════════════════════════════════════════ */
const DEMO={T1:42,T2:35,T3:68,T4:55,F1:2.5,F2:2.3,power:false,solenoid:true,pump:true,lamp:false,pressure:40};
const walk=(v,mn,mx,s)=>Math.min(mx,Math.max(mn,v+(Math.random()-.5)*s));
function demoTick(){DEMO.T1=walk(DEMO.T1,25,65,.9);DEMO.T2=walk(DEMO.T2,20,55,.7);DEMO.T3=walk(DEMO.T3,40,95,1.4);DEMO.T4=walk(DEMO.T4,30,80,1.0);DEMO.F1=walk(DEMO.F1,.3,5,.12);DEMO.F2=walk(DEMO.F2,.3,5,.12);DEMO.pressure=walk(DEMO.pressure,0,100,5);applySnapshot({...DEMO});}
function startDemo(){if(demoTimer)return;demoTick();demoTimer=setInterval(demoTick,POLL_SEC*1000);}
function stopDemo(){if(demoTimer){clearInterval(demoTimer);demoTimer=null;}}

/* ═══════════════════════════════════════════════════════════════
   FIREBASE HOOKS
   ═══════════════════════════════════════════════════════════════ */
FB.onData((raw,ms)=>{
  if (isDemoOnly) return; // In demo-only mode, ignore Firebase data entirely
  // Check if data has actual sensor values (not just empty objects)
  const n = normalise(raw);
  const hasRealData = n && (n.vals.T1 !== 0 || n.vals.T2 !== 0 || n.vals.T3 !== 0 || n.vals.T4 !== 0 || n.vals.F1 !== 0 || n.vals.F2 !== 0);
  if (!hasRealData) {
    // Firebase is reachable but has no real sensor data — start demo
    if (!demoTimer) startDemo();
    setRibbon('connected', 'NO DATA');
    return;
  }
  stopDemo(); if(!isLive){isLive=true;ALARMS.playConn();ALARMS.toast('ok','🔥','Firebase Connected',`Live · ${ms}ms`);}
  setRibbon('connected'); applySnapshot(raw);
});
FB.onStatus(st=>{
  if (isDemoOnly) return; // In demo-only mode, skip Firebase status updates
  renderInspector(FB.getLastRaw(),st);
  if(st.state==='disconnected'){setRibbon('disconnected');if(!isLive)startDemo();}
  else if(st.state==='connected')setRibbon('connected', st.hasData===false ? 'NO DATA' : '');
  else setRibbon('checking');
});

/* ═══════════════════════════════════════════════════════════════
   POLL
   ═══════════════════════════════════════════════════════════════ */
function restartPoll(){FB.setPoll(POLL_SEC*1000);window.APP_POLL_SEC=POLL_SEC;if(demoTimer){clearInterval(demoTimer);demoTimer=setInterval(demoTick,POLL_SEC*1000);}}

/* ═══════════════════════════════════════════════════════════════
   BOOT — after auth resolves
   ═══════════════════════════════════════════════════════════════ */
async function boot() {
  if (appStarted) return;
  appStarted = true;
  loadSettings();
  setRibbon('checking');
  try { SOLAR.setLocation(LAT,LON); SOLAR.start(IRRAD_G); } catch(e) { console.warn('[BOOT] Solar physics init failed:', e); }
  try { CHARTS.init(); } catch(e) { console.warn('[BOOT] Charts init failed:', e); }
  try { setupClicks(); } catch(e) { console.warn('[BOOT] Control click handlers failed:', e); }
  try { window.UX?.initMobileNav(); } catch(e) { console.warn('[BOOT] Mobile nav init failed:', e); }
  try { window.UX?.showConnectingOverlay(); window.UX?.showSkeleton(); } catch(e) { console.warn('[BOOT] Loading overlay failed:', e); }

  try {
    if (!isDemoOnly && AUTH.isSignedIn()) {
      const emailEl=$('user-email-display'); if(emailEl) emailEl.textContent=AUTH.getEmail();
      await initSites();
      if (_justSignedUp) {
        window.UX?.showWelcome(AUTH.getEmail());
        _justSignedUp = false;
      }
    } else {
      const switcherWrap=$('site-switcher-wrap'); if(switcherWrap) switcherWrap.style.display='none';
      const emailEl=$('user-email-display'); if(emailEl) emailEl.textContent='Demo Mode (not signed in)';
    }
  } catch(e) {
    console.warn('[BOOT] Site/auth init failed, falling back to demo display:', e);
    const switcherWrap=$('site-switcher-wrap'); if(switcherWrap) switcherWrap.style.display='none';
  }

  FB.start(POLL_SEC*1000);
  // In demo-only mode, start demo immediately instead of waiting 6 seconds
  if (isDemoOnly) {
    startDemo();
    setRibbon('disconnected');
    const pi=$('pill'),pt=$('pill-txt');
    if(pi) pi.className='live-pill demo';
    if(pt) pt.textContent='DEMO';
  } else {
    setTimeout(()=>{ if(!isLive&&!demoTimer) startDemo(); },6000);
  }
}

/* First real data point clears the loading overlay/skeleton */
let _firstDataReceived = false;
function markFirstData() {
  if (_firstDataReceived) return;
  _firstDataReceived = true;
  window.UX?.hideConnectingOverlay();
  window.UX?.hideSkeleton();
}

/* ═══════════════════════════════════════════════════════════════
   INIT — check auth state before showing anything
   ═══════════════════════════════════════════════════════════════ */
loadAuthConfig();
AUTH.onChange(session => {
  if (session) { isDemoOnly=false; hideLoginScreen(); boot(); }
  else if (!isDemoOnly) { showLoginScreen(); }
});
if (WEB_API_KEY) AUTH.configure(WEB_API_KEY);   // restores a saved session if present
else showLoginScreen();
const savedKeyEl = $('auth-apikey');
if (savedKeyEl && WEB_API_KEY) savedKeyEl.value = WEB_API_KEY;
