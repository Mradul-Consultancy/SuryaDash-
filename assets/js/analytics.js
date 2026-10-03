/* ═══════════════════════════════════════════════════════════════
   analytics.js v5  ·  Session analytics + IEC 12975 η-curve
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const MAX = 500;
  let history    = [];
  let sessionStart = Date.now();
  let peakT3=-Infinity, peakKW=-Infinity;
  let totalKWh=0, dailyKWh=0;
  let lastMidnight=midnight();
  let dtAccum=0, dtCount=0;
  let aCharts={};

  function midnight() { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }
  function pad(n)     { return String(n).padStart(2,'0'); }

  function record(vals, calc, ctrl, pollSec) {
    const now=Date.now();
    if (now-lastMidnight>=86400000) { dailyKWh=0; lastMidnight=midnight(); }
    const tick=calc.kW*(pollSec/3600);
    totalKWh+=tick; dailyKWh+=tick;
    dtAccum+=calc.dT; dtCount++;
    if (vals.T3>peakT3) peakT3=vals.T3;
    if (calc.kW>peakKW) peakKW=calc.kW;
    history.push({ ts:now, vals:{...vals}, calc:{...calc}, ctrl:{...ctrl} });
    if (history.length>MAX) history.shift();
    updateSession(vals,calc);
    return { totalKWh, dailyKWh };
  }

  function updateSession(v, c) {
    const up=Math.floor((Date.now()-sessionStart)/1000);
    const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
    set('sess-uptime',`${pad(Math.floor(up/3600))}:${pad(Math.floor((up%3600)/60))}:${pad(up%60)}`);
    set('sess-pts',    history.length);
    set('sess-peak',   peakT3>-Infinity?peakT3.toFixed(1)+'°C':'--');
    set('sess-peakkw', peakKW>-Infinity?peakKW.toFixed(2)+' kW':'--');
    set('sess-adt',    dtCount?(dtAccum/dtCount).toFixed(1)+'°C':'--');
    set('sess-kwh',    totalKWh.toFixed(3)+' kWh');
  }

  /* ── Destroy old analytics charts ───────────────────────────── */
  function destroyACharts() {
    Object.values(aCharts).forEach(c=>{ try{c.destroy();}catch(e){} });
    aCharts={};
  }

  /* ── Chart factory ──────────────────────────────────────────── */
  function mkChart(id, type, data, options) {
    const el=document.getElementById(id); if(!el) return null;
    try { return new Chart(el.getContext('2d'), { type, data, options }); } catch(e){ return null; }
  }
  const G={grid:'rgba(255,255,255,.05)', tick:'#6b6966'};
  function axes(xL,yL,xMin,xMax,yMin,yMax) {
    return { scales:{
      x:{ min:xMin, max:xMax, title:{display:!!xL,text:xL,color:G.tick,font:{size:8}}, ticks:{color:G.tick,font:{family:'IBM Plex Mono',size:8},maxRotation:0,maxTicksLimit:8}, grid:{color:G.grid}, border:{color:'transparent'} },
      y:{ min:yMin, max:yMax, title:{display:!!yL,text:yL,color:G.tick,font:{size:8}}, ticks:{color:G.tick,font:{family:'IBM Plex Mono',size:8}}, grid:{color:G.grid}, border:{color:'transparent'} }
    }};
  }
  function baseOpts(xL,yL,xMin,xMax,yMin,yMax) {
    return { responsive:true, maintainAspectRatio:false, animation:{duration:200},
      plugins:{ legend:{display:false}, tooltip:{backgroundColor:'#1b1a19',borderColor:'#333',borderWidth:1,titleColor:'#eee',bodyColor:'#777'} },
      ...axes(xL,yL,xMin,xMax,yMin,yMax) };
  }

  /* ── IEC 12975 η-curve ──────────────────────────────────────── */
  // X = (Tm - Ta) / G  where Tm=(T2+T4)/2
  // η = measured efficiency
  // Reference curve: η = η0 - a1·X - a2·G·X²  (typical: η0=0.75, a1=3.5, a2=0.02)
  function buildEtaCurve(irradG, ambient) {
    const G   = irradG  || 800;
    const Ta  = ambient || 25;
    const pts = [], refPts = [];
    history.forEach(h => {
      if (!h.calc.eff || h.vals.F1 < 0.3) return;
      const Tm = (h.vals.T2 + h.vals.T4) / 2;
      const X  = (Tm - Ta) / Math.max(1, G);
      pts.push({ x: +X.toFixed(4), y: +(h.calc.eff/100).toFixed(4) });
    });
    // Reference curve points
    for (let x=0; x<=0.1; x+=0.005) {
      const eta = Math.max(0, 0.72 - 3.5*x - 0.02*G*x*x);
      refPts.push({ x:+x.toFixed(4), y:+eta.toFixed(4) });
    }
    return { pts, refPts };
  }

  /* ── Render Analytics tab ───────────────────────────────────── */
  function renderAnalytics(irradG, ambient) {
    if (!history.length) return;
    destroyACharts();

    const avgEff = history.reduce((s,h)=>s+h.calc.eff,0)/history.length;
    const avgDt  = dtCount ? dtAccum/dtCount : 0;
    const opHrs  = ((Date.now()-sessionStart)/3.6e6).toFixed(2);
    const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
    set('an-energy', totalKWh.toFixed(3));
    set('an-daily',  dailyKWh.toFixed(3));
    set('an-peakkw', peakKW>-Infinity?peakKW.toFixed(2):'--');
    set('an-peakt3', peakT3>-Infinity?peakT3.toFixed(1):'--');
    set('an-avgeff', avgEff.toFixed(0));
    set('an-avgdt',  avgDt.toFixed(1));
    set('an-ophrs',  opHrs);
    set('an-pts',    history.length);

    const step = Math.max(1, Math.floor(history.length/60));
    const s    = history.filter((_,i)=>i%step===0).slice(-60);
    const lbls = s.map(h=>{ const d=new Date(h.ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; });

    // Power trend
    aCharts.pw = mkChart('a-energy-chart','line',
      { labels:lbls, datasets:[{ label:'kW', data:s.map(h=>+h.calc.kW.toFixed(3)), borderColor:'#01b8d9', backgroundColor:'#01b8d922', borderWidth:2, pointRadius:0, tension:.4, fill:true }] },
      baseOpts('Time','kW',undefined,undefined,0,undefined));

    // Efficiency trend
    aCharts.ef = mkChart('a-eff-chart','line',
      { labels:lbls, datasets:[{ label:'%', data:s.map(h=>+h.calc.eff.toFixed(1)), borderColor:'#26de81', backgroundColor:'#26de8118', borderWidth:2, pointRadius:0, tension:.4, fill:true }] },
      baseOpts('Time','%',undefined,undefined,0,100));

    // T2 vs T4 scatter
    aCharts.sc = mkChart('a-scatter-chart','scatter',
      { datasets:[{ label:'T2→T4', data:s.map(h=>({x:+h.vals.T2.toFixed(1),y:+h.vals.T4.toFixed(1)})), backgroundColor:'#45aaf299', borderColor:'#45aaf2', pointRadius:3 }] },
      {...baseOpts('T2 Inlet °C','T4 Outlet °C',0,100,0,100), plugins:{legend:{display:false}, tooltip:{backgroundColor:'#1b1a19',callbacks:{label:c=>`T2:${c.parsed.x.toFixed(1)} T4:${c.parsed.y.toFixed(1)}`}}} });

    // 7-day energy bar
    if (window.ROI) {
      const days7 = ROI.getLast7Days();
      aCharts.d7 = mkChart('a-daily-chart','bar',
        { labels:days7.map(d=>d.day), datasets:[{ label:'kWh', data:days7.map(d=>d.kWh), backgroundColor:'#01b8d988', borderColor:'#01b8d9', borderWidth:1.5, borderRadius:4 }] },
        baseOpts('Day','kWh',undefined,undefined,0,undefined));
    }

    // ── IEC 12975 η-curve (new in v5) ──
    if (irradG > 0) {
      const { pts, refPts } = buildEtaCurve(irradG, ambient);
      if (pts.length > 3) {
        aCharts.eta = mkChart('a-eta-chart','scatter',
          { datasets:[
              { label:'Measured η', data:pts, backgroundColor:'#f7b73199', borderColor:'#f7b731', pointRadius:4 },
              { label:'IEC 12975 ref', data:refPts, type:'line', borderColor:'#45aaf2', borderWidth:1.5, pointRadius:0, tension:.4, fill:false }
            ]
          },
          {...baseOpts('(Tm−Ta)/G  [m²K/W]','Efficiency η',0,0.12,0,1),
            plugins:{ legend:{display:true, labels:{color:'#72706d',font:{size:9},boxWidth:12}}, tooltip:{backgroundColor:'#1b1a19',callbacks:{label:c=>`X:${c.parsed.x.toFixed(4)}  η:${(c.parsed.y*100).toFixed(1)}%`}} }}
        );
      }
    }

    // ROI over time
    aCharts.roi = mkChart('a-roi-chart','line',
      { labels:lbls, datasets:[{ label:'$ saved', data:s.map(h=>{
          const kw=h.calc.kW; const r=window.ROI?ROI.calc(kw*(2/3600)):{}; return +(r.money||0).toFixed(6);
        }), borderColor:'#26de81', backgroundColor:'transparent', borderWidth:1.5, pointRadius:0, tension:.4 }] },
      baseOpts('Time','$/tick'));
  }

  /* ── Build printable report ─────────────────────────────────── */
  function buildReport() {
    const rp=document.getElementById('report-content'); if(!rp||!history.length) return;
    const last=history[history.length-1];
    const avgEff=history.reduce((s,h)=>s+h.calc.eff,0)/history.length;
    const avgKW =history.reduce((s,h)=>s+h.calc.kW,0)/history.length;
    const d=new Date();
    const roi=window.ROI?ROI.calc(totalKWh):{money:0,co2:0,trees:0};
    const alarms=window.ALARMS?ALARMS.getHistory():[];
    const days7=window.ROI?ROI.getLast7Days():[];

    rp.innerHTML=`
<div class="rpt-section">
  <div class="rpt-head">
    <div><div class="rpt-logo">☀ SuryaDash v5</div><div class="rpt-sub">Thermal &amp; Flow Acquisition Report — Real-time Firebase RTDB</div></div>
    <div class="rpt-date">${d.toLocaleDateString()} ${pad(d.getHours())}:${pad(d.getMinutes())}</div>
  </div>
</div>
<div class="rpt-section">
  <div class="rpt-sec-title">📊 Session KPIs</div>
  <div class="rpt-kpi-grid">
    <div class="rpt-kpi"><div class="rpt-kpi-val">${totalKWh.toFixed(3)}</div><div class="rpt-kpi-lbl">Total Energy (kWh)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${avgKW.toFixed(2)}</div><div class="rpt-kpi-lbl">Avg Power (kW)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${peakKW>-Infinity?peakKW.toFixed(2):'-'}</div><div class="rpt-kpi-lbl">Peak Power (kW)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${avgEff.toFixed(0)}%</div><div class="rpt-kpi-lbl">Avg Efficiency</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${peakT3>-Infinity?peakT3.toFixed(1):'-'}°C</div><div class="rpt-kpi-lbl">Peak T3 Absorber</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${history.length}</div><div class="rpt-kpi-lbl">Data Points</div></div>
  </div>
</div>
<div class="rpt-section">
  <div class="rpt-sec-title">💰 Economic &amp; Environmental Impact</div>
  <div class="rpt-kpi-grid">
    <div class="rpt-kpi"><div class="rpt-kpi-val">${roi.money.toFixed(3)}</div><div class="rpt-kpi-lbl">Money Saved ($)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${roi.co2.toFixed(3)}</div><div class="rpt-kpi-lbl">CO₂ Avoided (kg)</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${roi.trees.toFixed(4)}</div><div class="rpt-kpi-lbl">Trees Equivalent</div></div>
    <div class="rpt-kpi"><div class="rpt-kpi-val">${roi.liters?.toFixed(2)||'-'}</div><div class="rpt-kpi-lbl">Petrol Saved (L)</div></div>
  </div>
</div>
<div class="rpt-section">
  <div class="rpt-sec-title">📅 7-Day Energy History</div>
  <table class="rpt-table"><thead><tr><th>Day</th><th>Date</th><th>Energy (kWh)</th></tr></thead>
  <tbody>${days7.map(d=>`<tr><td>${d.day}</td><td>${d.date}</td><td>${d.kWh}</td></tr>`).join('')}</tbody></table>
</div>
<div class="rpt-section">
  <div class="rpt-sec-title">🌡 Latest Sensor Readings</div>
  <table class="rpt-table"><thead><tr><th>ID</th><th>Name</th><th>Value</th><th>Unit</th></tr></thead>
  <tbody>
    <tr><td>T1</td><td>Storage Temperature</td><td>${last.vals.T1.toFixed(1)}</td><td>°C</td></tr>
    <tr><td>T2</td><td>Inlet Temperature</td><td>${last.vals.T2.toFixed(1)}</td><td>°C</td></tr>
    <tr><td>T3</td><td>Absorber Plate</td><td>${last.vals.T3.toFixed(1)}</td><td>°C</td></tr>
    <tr><td>T4</td><td>Outlet Temperature</td><td>${last.vals.T4.toFixed(1)}</td><td>°C</td></tr>
    <tr><td>F1</td><td>Inlet Flow Rate</td><td>${last.vals.F1.toFixed(2)}</td><td>L/min</td></tr>
    <tr><td>F2</td><td>Outlet Flow Rate</td><td>${last.vals.F2.toFixed(2)}</td><td>L/min</td></tr>
  </tbody></table>
</div>
<div class="rpt-section">
  <div class="rpt-sec-title">🔔 Alarm Summary (${alarms.length} events)</div>
  ${alarms.length?`<table class="rpt-table"><thead><tr><th>Time</th><th>Level</th><th>Description</th></tr></thead>
  <tbody>${alarms.slice(0,20).map(a=>`<tr><td>${a.ts}</td><td>${a.lvl.toUpperCase()}</td><td>${a.msg}</td></tr>`).join('')}</tbody></table>`
  :'<div class="rpt-ok">✔ No alarms during this session</div>'}
</div>
<div class="rpt-section rpt-footer">SuryaDash v5.0 · ${d.toISOString()}</div>`;
  }

  global.ANALYTICS = {
    record, renderAnalytics, buildReport,
    printReport: () => { buildReport(); setTimeout(()=>window.print(),300); },
    getTotals: ()=>({totalKWh,dailyKWh,peakT3,peakKW}),
    reset: ()=>{ history=[]; totalKWh=0; dailyKWh=0; peakT3=-Infinity; peakKW=-Infinity; dtAccum=0; dtCount=0; sessionStart=Date.now(); }
  };

})(window);
