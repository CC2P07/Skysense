/* ====================================================================
   SKYSENSE — script.js
   Toda a lógica do painel: gera/atualiza os dados dos sensores,
   desenha os gráficos (Chart.js), controla as abas e escreve os
   valores na tela. Tudo dentro de uma IIFE (function(){ ... })()
   para não criar variáveis globais que possam conflitar com outros
   scripts.
==================================================================== */
(function(){
  "use strict"; // modo mais rígido do JS: ajuda a pegar erros comuns

  function iniciarSkySense(){
    /* ============================================================
       CONEXÃO COM O ESP32 / BACKEND
    ============================================================ */
    const CONFIG = {
      USE_SIMULATION: false,                                              // false = busca dados reais em vez de simular
      API_URL: 'http://127.0.0.1:8000/api/clima/historico?limite=1',      // endpoint com a leitura mais recente
      HISTORY_URL: 'http://127.0.0.1:8000/api/clima/historico?limite=168',// endpoint com leituras passadas
      POLL_INTERVAL_MS: 4000,                                             // frequência de atualização
    };

    /* ---------------- funções utilitárias ---------------- */
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const rand=(a,b)=>a+Math.random()*(b-a);

    const monthsPt=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    const daysPt=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

    function updateClock(){
      const now=new Date();
      document.getElementById('heroDate').textContent = daysPt[now.getDay()]+", "+now.getDate()+" de "+monthsPt[now.getMonth()];
      document.getElementById('heroTime').textContent = now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    }
    updateClock();
    setInterval(updateClock,15000);

    /* ====================================================================
       HISTÓRICO INICIAL (Placeholder substituído pelo loadHistory)
    ==================================================================== */
    const HOURS=168;
    const now=Date.now();

    function genSeries(fn, noise){
      const arr=[];
      for(let i=HOURS;i>=0;i--){
        const t = now - i*3600*1000;
        const hourOfDay = new Date(t).getHours() + new Date(t).getMinutes()/60;
        let v = fn(hourOfDay, i);
        v += rand(-noise, noise);
        arr.push({t, v});
      }
      return arr;
    }

    const series = {
      temp: genSeries(h => 21 + 6*Math.sin((h-9)/24*2*Math.PI), 0.4),
      hum:  genSeries(h => 60 - 18*Math.sin((h-9)/24*2*Math.PI), 1.5),
      press:genSeries((h,i) => 1013 + 3*Math.sin(i/17) , 0.3),
      air:  genSeries(h => 520 + 220*Math.max(0,Math.sin((h-8)/24*2*Math.PI)) , 25),
      ldr:  genSeries(h => clamp(90*Math.max(0,Math.sin((h-6)/12*Math.PI)),0,100), 3),
      lux:  genSeries(h => clamp(45000*Math.max(0,Math.sin((h-6)/12*Math.PI)),0,60000), 800),
      rainRate: genSeries((h,i) => (i%37<2 ? rand(1,9) : 0), 0.1),
    };
    series.rainAcc = (()=>{
      const arr=[]; let acc=0; let lastDay=null;
      series.rainRate.forEach(p=>{
        const d=new Date(p.t).toDateString();
        if(d!==lastDay){acc=0; lastDay=d;}
        acc += Math.max(0,p.v)/12;
        arr.push({t:p.t, v:acc});
      });
      return arr;
    })();

    function latest(key){ const s=series[key]; return s[s.length-1].v; }
    function pushLive(key, nextVal, t){
      if(nextVal===undefined || nextVal===null || Number.isNaN(nextVal)) return;
      const s=series[key];
      s.push({t: t||Date.now(), v:nextVal});
      if(s.length>HOURS+40) s.shift();
    }

    /* ---------------- aparência dos gráficos (Chart.js) ---------------- */
    const CHART_LINE = '#0B5FA5';
    const CHART_FILL = 'rgba(47,155,219,.14)';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#547089';

    function sliceRange(s, range){
      const count = range==='6h'?6:range==='24h'?24:168;
      return s.slice(Math.max(0,s.length-count));
    }

    function fmtLabel(t, range){
      const d=new Date(t);
      if(range==='7d') return d.toLocaleDateString('pt-BR',{weekday:'short'});
      return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    }

    function makeSpark(id, key){
      const ctx=document.getElementById(id);
      const data=series[key].slice(-24).map(p=>p.v);
      return new Chart(ctx,{
        type:'line',
        data:{labels:data.map((_,i)=>i), datasets:[{data, borderColor:CHART_LINE, backgroundColor:CHART_FILL, fill:true, borderWidth:2, pointRadius:0, tension:.35}]},
        options:{
          responsive:true, maintainAspectRatio:false,
          animation:false,
          plugins:{legend:{display:false}, tooltip:{enabled:false}},
          scales:{x:{display:false}, y:{display:false}}
        }
      });
    }

    function makeDetailChart(id, key, unit){
      const ctx=document.getElementById(id);
      const pts=sliceRange(series[key],'24h');
      return new Chart(ctx,{
        type:'line',
        data:{
          labels:pts.map(p=>fmtLabel(p.t,'24h')),
          datasets:[{
            label:unit, data:pts.map(p=>p.v),
            borderColor:CHART_LINE, backgroundColor:CHART_FILL, fill:true,
            borderWidth:2.4, pointRadius:0, tension:.3
          }]
        },
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{legend:{display:false}, tooltip:{mode:'index', intersect:false}},
          interaction:{mode:'index', intersect:false},
          scales:{
            x:{grid:{display:false}, ticks:{maxTicksLimit:6}},
            y:{grid:{color:'#E3F1FB'}, ticks:{maxTicksLimit:5}}
          }
        }
      });
    }

    const sparks = {
      temp: makeSpark('spark-temp','temp'),
      press: makeSpark('spark-press','press'),
      air: makeSpark('spark-air','air'),
      ldr: makeSpark('spark-ldr','ldr'),
      lux: makeSpark('spark-lux','lux'),
      rain: makeSpark('spark-rain','rainAcc'),
    };

    const detailChartDefs = {
      temp:{id:'chart-temp', key:'temp', unit:'°C'},
      pressure:{id:'chart-pressure', key:'press', unit:'hPa'},
      air:{id:'chart-air', key:'air', unit:'ppm'},
      ldr:{id:'chart-ldr', key:'ldr', unit:'%'},
      lux:{id:'chart-lux', key:'lux', unit:'lux'},
      rain:{id:'chart-rain', key:'rainAcc', unit:'mm'},
    };
    const detailCharts = {};

    function ensureDetailChart(tabName){
      const def=detailChartDefs[tabName];
      if(!def) return;
      if(!detailCharts[tabName]){
        detailCharts[tabName]=makeDetailChart(def.id, def.key, def.unit);
      }
    }

    document.querySelectorAll('.range-toggle').forEach(group=>{
      group.addEventListener('click', e=>{
        const btn=e.target.closest('button[data-range]');
        if(!btn) return;
        const tabName=group.dataset.chart;
        const def=detailChartDefs[tabName];
        group.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed', b===btn));
        const range=btn.dataset.range;
        const pts=sliceRange(series[def.key], range);
        const chart=detailCharts[tabName];
        chart.data.labels=pts.map(p=>fmtLabel(p.t,range));
        chart.data.datasets[0].data=pts.map(p=>p.v);
        chart.update();
      });
    });

    const tabs=document.querySelectorAll('.tab');
    const panels=document.querySelectorAll('.tab-panel');

    function activateTab(name){
      tabs.forEach(t=>t.setAttribute('aria-selected', t.dataset.tab===name));
      panels.forEach(p=>p.classList.toggle('active', p.id==='panel-'+name));
      if(name!=='overview') ensureDetailChart(name);
    }
    tabs.forEach(t=>t.addEventListener('click',()=>activateTab(t.dataset.tab)));
    document.querySelectorAll('[data-goto]').forEach(card=>{
      card.addEventListener('click',()=>activateTab(card.dataset.goto));
      card.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activateTab(card.dataset.goto); }});
    });

    function airClass(v){
      if(v<700) return {label:'Bom', cls:'ok'};
      if(v<1000) return {label:'Moderado', cls:'warn'};
      return {label:'Ruim', cls:'warn'};
    }
    function condFromLux(luxV, rainRate){
      if(rainRate>0.5) return 'Chovendo agora';
      if(luxV<5) return 'Céu limpo à noite';
      if(luxV<15000) return 'Parcialmente nublado';
      return 'Céu limpo';
    }

    function render(){
      const t=latest('temp'), h=latest('hum'), p=latest('press'), a=latest('air'),
            ldrV=latest('ldr'), luxV=latest('lux'), rateV=Math.max(0,latest('rainRate')),
            accV=latest('rainAcc');

      document.getElementById('heroTemp').innerHTML = t.toFixed(1)+"<sup>°C</sup>";
      document.getElementById('heroHum').textContent = h.toFixed(0)+"%";
      document.getElementById('heroPress').textContent = p.toFixed(0)+" hPa";
      const ac=airClass(a);
      document.getElementById('heroAir').textContent = ac.label;
      document.getElementById('heroRain').textContent = accV.toFixed(1)+" mm";
      document.getElementById('heroCond').textContent = condFromLux(luxV, rateV);

      document.getElementById('ov-temp').textContent = t.toFixed(1);
      document.getElementById('ov-hum').textContent = h.toFixed(0);
      document.getElementById('ov-press').textContent = p.toFixed(0);
      document.getElementById('ov-air').textContent = a.toFixed(0);
      const badge=document.getElementById('ov-air-badge');
      badge.textContent = ac.label; badge.className='badge '+ac.cls;
      document.getElementById('ov-ldr').textContent = ldrV.toFixed(0);
      document.getElementById('ov-lux').textContent = luxV.toFixed(0);
      document.getElementById('ov-rain-total').textContent = accV.toFixed(1);
      document.getElementById('ov-rain-rate').textContent = rateV.toFixed(1);

      document.getElementById('d-temp').textContent = t.toFixed(1)+"°";
      document.getElementById('d-hum').textContent = h.toFixed(0)+"%";
      document.getElementById('d-temp-status').textContent = (t>=18&&t<=28)?'Dentro da faixa ideal':'Fora da faixa ideal';

      document.getElementById('d-press').textContent = p.toFixed(0);
      document.getElementById('d-alt').textContent = Math.round((1013-p)*8.3)+" m";
      const prevP = series.press[series.press.length-6] ? series.press[series.press.length-6].v : p;
      document.getElementById('d-press-trend').textContent = p>prevP+0.3?'Subindo':p<prevP-0.3?'Caindo':'Estável';
      document.getElementById('d-press-status').textContent = (p>=1000&&p<=1025)?'Normal':'Atenção';

      document.getElementById('d-air').textContent = a.toFixed(0);
      document.getElementById('d-air-class').textContent = ac.label;

      document.getElementById('d-ldr').textContent = ldrV.toFixed(0)+"%";
      document.getElementById('d-ldr-cond').textContent = ldrV<10?'Escuro':ldrV<50?'Nublado / entardecer':'Claro';

      document.getElementById('d-lux').textContent = luxV.toFixed(0);
      document.getElementById('d-lux-status').textContent = luxV<1?'Sem luz':luxV<1000?'Luz baixa':luxV<20000?'Luz moderada':'Luz forte';

      document.getElementById('d-rain').textContent = accV.toFixed(1);
      document.getElementById('d-rain-rate').textContent = rateV.toFixed(1)+" mm/h";

      document.getElementById('lastUpdate').textContent = 'Atualizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }

    render();

    function pushAll(vals, t){
      pushLive('temp',vals.temp,t); pushLive('hum',vals.hum,t);
      pushLive('press',vals.press,t); pushLive('air',vals.air,t);
      pushLive('ldr',vals.ldr,t); pushLive('lux',vals.lux,t);
      pushLive('rainRate',vals.rainRate,t); pushLive('rainAcc',vals.rainAcc,t);
    }

    function refreshSparks(){
      Object.entries({temp:'temp',press:'press',air:'air',ldr:'ldr',lux:'lux',rain:'rainAcc'}).forEach(([sk,key])=>{
        const c=sparks[sk];
        c.data.datasets[0].data = series[key].slice(-24).map(pt=>pt.v);
        c.update('none');
      });
    }

    function refreshVisibleDetailChart(){
      Object.keys(detailCharts).forEach(tabName=>{
        const panel=document.getElementById('panel-'+tabName);
        if(!panel.classList.contains('active')) return;
        const group=document.querySelector('.range-toggle[data-chart="'+tabName+'"]');
        const activeBtn=group.querySelector('button[aria-pressed="true"]');
        const range=activeBtn ? activeBtn.dataset.range : '24h';
        const def=detailChartDefs[tabName];
        const pts=sliceRange(series[def.key], range);
        const chart=detailCharts[tabName];
        chart.data.labels=pts.map(pt=>fmtLabel(pt.t,range));
        chart.data.datasets[0].data=pts.map(pt=>pt.v);
        chart.update('none');
      });
    }

    function afterNewData(){
      refreshSparks();
      refreshVisibleDetailChart();
      render();
    }

    function simulateStep(){
      const t=latest('temp')+rand(-0.15,0.15);
      const h=clamp(latest('hum')+rand(-0.6,0.6),20,95);
      const p=latest('press')+rand(-0.08,0.08);
      const a=clamp(latest('air')+rand(-8,8),380,1400);
      const ldrV=clamp(latest('ldr')+rand(-2,2),0,100);
      const luxV=clamp(latest('lux')+rand(-300,300),0,80000);
      const rateV=Math.max(0, latest('rainRate')+rand(-0.4,0.4) - (Math.random()<0.02?0:0.05));
      const accV=latest('rainAcc') + Math.max(0,rateV)/720;

      pushAll({temp:t, hum:h, press:p, air:a, ldr:ldrV, lux:luxV, rainRate:rateV, rainAcc:accV});
      afterNewData();
    }

    /* ====================================================================
       MODO REAL — adaptado para o JSON do seu main.py
    ==================================================================== */
    async function fetchLiveStep(){
      try{
        const res = await fetch(CONFIG.API_URL, {cache:'no-store'});
        if(!res.ok) throw new Error('HTTP '+res.status);
        const json = await res.json();
        const d = Array.isArray(json.dados) ? json.dados[0] : json;
        if(!d) return;

        const ts = d.criado_em ? new Date(d.criado_em).getTime() : Date.now();
        const accV = (d.rain_accumulated!==undefined) ? d.rain_accumulated
                      : latest('rainAcc') + Math.max(0,(d.rain_rate||0))/720;

        pushAll({
          temp: d.temperatura,
          hum: d.umidade,
          press: d.pressao,
          air: d.gas,
          ldr: d.luminosidade,
          lux: d.luminosidade,
          rainRate: d.rain_rate ?? 0,
          rainAcc: accV,
        }, ts);

        afterNewData();
      }catch(err){
        console.warn('SkySense: não consegui buscar dados reais em', CONFIG.API_URL, err);
      }
    }

    async function loadHistory(){
      if(CONFIG.USE_SIMULATION || !CONFIG.HISTORY_URL) return;
      try{
        const res = await fetch(CONFIG.HISTORY_URL, {cache:'no-store'});
        if(!res.ok) throw new Error('HTTP '+res.status);
        const json = await res.json();
        const rows = Array.isArray(json.dados) ? [...json.dados].reverse() : [];

        if(rows.length){
          ['temp','hum','press','air','ldr','lux','rainRate','rainAcc'].forEach(k=>series[k]=[]);
          rows.forEach(r=>{
            const t = r.criado_em ? new Date(r.criado_em).getTime() : Date.now();
            series.temp.push({t, v:r.temperatura});
            series.hum.push({t, v:r.umidade});
            series.press.push({t, v:r.pressao});
            series.air.push({t, v:r.gas});
            series.ldr.push({t, v:r.luminosidade});
            series.lux.push({t, v:r.luminosidade});
            series.rainRate.push({t, v:r.rain_rate ?? 0});
            series.rainAcc.push({t, v:r.rain_accumulated ?? 0});
          });
          afterNewData();
        }
      }catch(err){
        console.warn('SkySense: não consegui carregar o histórico real de', CONFIG.HISTORY_URL, err);
      }
    }

    document.getElementById('sourceNote').innerHTML = CONFIG.USE_SIMULATION
      ? 'SkySense <span class="dot">·</span> dados simulados nesta demonstração, prontos para receber leituras reais do ESP32'
      : 'SkySense <span class="dot">·</span> conectado ao ESP32 em '+CONFIG.API_URL;

    loadHistory();
    function tick(){
      CONFIG.USE_SIMULATION ? simulateStep() : fetchLiveStep();
    }
    setInterval(tick, CONFIG.POLL_INTERVAL_MS);
  }

  // Garante o carregamento do Chart.js antes de rodar o código
  if (typeof Chart !== "undefined") {
    iniciarSkySense();
  } else {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js";
    s.onload = iniciarSkySense;
    document.head.appendChild(s);
  }

})();
