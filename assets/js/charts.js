/* ═══════════════════════════════════════════════════
   charts.js  ·  Chart.js management module
   ═══════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const MAX = 60;
  const CLR = {
    t1:'#f7b731', t2:'#26de81', t3:'#ff5e57', t4:'#45aaf2',
    f1:'#a55eea', f2:'#fd9644',
    pwr:'#01b8d9', dt:'#f7b731', eff:'#26de81',
    grid:'rgba(255,255,255,.05)', tick:'#6b6966'
  };

  const charts = {};

  function base(yLabel, yMin, yMax, yMax2) {
    const scales = {
      x: { ticks:{color:CLR.tick, font:{family:'IBM Plex Mono',size:8}, maxRotation:0, maxTicksLimit:8}, grid:{color:CLR.grid}, border:{color:'transparent'} },
      y: { min:yMin, max:yMax, ticks:{color:CLR.tick, font:{family:'IBM Plex Mono',size:8}}, grid:{color:CLR.grid}, border:{color:'transparent'}, title:{display:!!yLabel, text:yLabel, color:CLR.tick, font:{size:8}} }
    };
    if (yMax2 !== undefined) {
      scales.y2 = { min:0, max:yMax2, position:'right', ticks:{color:CLR.tick, font:{family:'IBM Plex Mono',size:8}}, grid:{drawOnChartArea:false}, border:{color:'transparent'} };
    }
    return {
      responsive:true, maintainAspectRatio:false, animation:{duration:180},
      plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#1b1a19', borderColor:'#333130', borderWidth:1, titleColor:'#eeece9', bodyColor:'#72706d',
        callbacks:{ label: c => ` ${c.dataset.label}: ${c.parsed.y !== null ? c.parsed.y.toFixed(2) : '--'}` }
      }},
      scales
    };
  }

  function ds(label, color, yAxisID) {
    const d = { label, data:Array(MAX).fill(null), borderColor:color, backgroundColor:'transparent', borderWidth:1.5, pointRadius:0, pointHoverRadius:3, tension:0.35, fill:false };
    if (yAxisID) d.yAxisID = yAxisID;
    return d;
  }

  const lbl = Array(MAX).fill('');

  function init() {
    if (typeof Chart === 'undefined') {
      console.warn('[CHARTS] Chart.js failed to load (blocked by network/ad-blocker?) — charts will be unavailable, rest of app continues normally.');
      document.querySelectorAll('.chart-body').forEach(el => {
        el.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;height:100%;color:var(--pbi-muted);font-size:11px;text-align:center;padding:20px">📉 Charts unavailable<br><span style="font-size:9px">Chart.js could not load — check network or ad-blocker</span></div>';
      });
      return;
    }
    const pc = document.getElementById('pc');
    const tc = document.getElementById('tc');
    const fc = document.getElementById('fc');
    const ec = document.getElementById('ec');
    if (!pc||!tc||!fc) return;

    charts.pc = new Chart(pc.getContext('2d'), {
      type:'line',
      data:{ labels:[...lbl], datasets:[ds('Power kW',CLR.pwr,'y'), ds('ΔT °C',CLR.dt,'y2')] },
      options: base('kW', 0, 15, 60)
    });
    charts.tc = new Chart(tc.getContext('2d'), {
      type:'line',
      data:{ labels:[...lbl], datasets:[ds('T1',CLR.t1), ds('T2',CLR.t2), ds('T3',CLR.t3), ds('T4',CLR.t4)] },
      options: base('°C', 0, 100)
    });
    charts.fc = new Chart(fc.getContext('2d'), {
      type:'line',
      data:{ labels:[...lbl], datasets:[ds('F1',CLR.f1), ds('F2',CLR.f2)] },
      options: base('L/min', 0, 10)
    });
    if (ec) {
      charts.ec = new Chart(ec.getContext('2d'), {
        type:'line',
        data:{ labels:[...lbl], datasets:[ds('Efficiency %',CLR.eff)] },
        options: base('%', 0, 100)
      });
    }
  }

  function push(v, kW, dT, eff) {
    if (typeof Chart === 'undefined' || !charts.pc) return;
    const d   = new Date();
    const lbl = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;

    function pushDs(chart, idx, val) {
      chart.data.datasets[idx].data.push(val);
      if (idx === 0) { chart.data.labels.push(lbl); if (chart.data.labels.length > MAX) chart.data.labels.shift(); }
      if (chart.data.datasets[idx].data.length > MAX) chart.data.datasets[idx].data.shift();
    }

    if (charts.pc) { pushDs(charts.pc,0,+kW.toFixed(3)); pushDs(charts.pc,1,+dT.toFixed(1)); charts.pc.update('none'); }
    if (charts.tc) { pushDs(charts.tc,0,v.T1); pushDs(charts.tc,1,v.T2); pushDs(charts.tc,2,v.T3); pushDs(charts.tc,3,v.T4); charts.tc.update('none'); }
    if (charts.fc) { pushDs(charts.fc,0,v.F1); pushDs(charts.fc,1,v.F2); charts.fc.update('none'); }
    if (charts.ec) { pushDs(charts.ec,0,+eff.toFixed(1)); charts.ec.update('none'); }
  }

  /* Analytics charts */
  let aCharts = {};

  function initAnalyticsCharts(energyData, effData, t2t4Data, dailyData) {
    destroyAnalyticsCharts();

    const ae = document.getElementById('a-energy-chart');
    const af = document.getElementById('a-eff-chart');
    const as = document.getElementById('a-scatter-chart');
    const ad = document.getElementById('a-daily-chart');

    if (ae && energyData.labels.length) {
      aCharts.energy = new Chart(ae.getContext('2d'), {
        type:'line',
        data:{ labels:energyData.labels, datasets:[{ label:'Thermal Power kW', data:energyData.data, borderColor:CLR.pwr, backgroundColor:CLR.pwr+'22', borderWidth:2, pointRadius:0, tension:0.4, fill:true }] },
        options: base('kW', 0, Math.max(5,...energyData.data.filter(Boolean))+1)
      });
    }
    if (af && effData.labels.length) {
      aCharts.eff = new Chart(af.getContext('2d'), {
        type:'line',
        data:{ labels:effData.labels, datasets:[{ label:'Efficiency %', data:effData.data, borderColor:CLR.eff, backgroundColor:CLR.eff+'18', borderWidth:2, pointRadius:0, tension:0.4, fill:true }] },
        options: base('%', 0, 100)
      });
    }
    if (as && t2t4Data.length) {
      aCharts.scatter = new Chart(as.getContext('2d'), {
        type:'scatter',
        data:{ datasets:[{ label:'T2 vs T4', data:t2t4Data, backgroundColor:CLR.t4+'99', borderColor:CLR.t4, pointRadius:3 }] },
        options:{ ...base('T4 °C',0,100), plugins:{...base().plugins, tooltip:{ callbacks:{ label: c=>`T2:${c.parsed.x.toFixed(1)} T4:${c.parsed.y.toFixed(1)}` } } }, scales:{ x:{ title:{display:true, text:'T2 Inlet °C', color:CLR.tick, font:{size:8}}, ticks:{color:CLR.tick,font:{family:'IBM Plex Mono',size:8}}, grid:{color:CLR.grid} }, y:{ title:{display:true, text:'T4 Outlet °C', color:CLR.tick, font:{size:8}}, ticks:{color:CLR.tick,font:{family:'IBM Plex Mono',size:8}}, grid:{color:CLR.grid} } } }
      });
    }
    if (ad && dailyData.labels.length) {
      aCharts.daily = new Chart(ad.getContext('2d'), {
        type:'bar',
        data:{ labels:dailyData.labels, datasets:[{ label:'Energy kWh', data:dailyData.data, backgroundColor:CLR.pwr+'88', borderColor:CLR.pwr, borderWidth:1.5, borderRadius:3 }] },
        options: base('kWh', 0, Math.max(1,...dailyData.data.filter(Boolean))*1.2)
      });
    }
  }

  function destroyAnalyticsCharts() {
    Object.values(aCharts).forEach(c => { try { c.destroy(); } catch(e){} });
    aCharts = {};
  }

  global.CHARTS = { init, push, initAnalytics: initAnalyticsCharts };

})(window);
