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

  /* ============================================================
     CONEXÃO COM O ESP32 / BACKEND
     ============================================================
     Hoje o SkySense roda 100% simulado. Quando o ESP32 (e o
     backend com banco de dados) estiverem prontos, é só mexer
     aqui — nenhuma outra parte do código precisa mudar.

     PASSO 1 — mude USE_SIMULATION para false.
     PASSO 2 — coloque em API_URL o endereço que devolve a
     leitura mais recente em JSON, no formato:
       {
         "temperature": 24.6,          // °C  - DHT22
         "humidity": 58,               // %   - DHT22
         "pressure": 1013,             // hPa - BMP280
         "air_quality": 620,           // ppm CO2eq - MQ135
         "ldr": 72,                    // %   - LDR
         "lux": 18000,                 // lux - BH1750
         "rain_rate": 0,               // mm/h - Davis Rain Collector
         "rain_accumulated": 3.2,      // mm acumulados no dia
         "timestamp": 1732400000000    // opcional, epoch em ms
       }
     Esse é exatamente o formato que o firmware do ESP32 (ou o
     backend que recebe dele) deve responder — se o seu backend
     usa outros nomes de campo, ajuste só dentro de fetchLiveStep.

     PASSO 3 (opcional) — se o seu backend também guarda
     histórico no banco, preencha HISTORY_URL com um endpoint que
     devolva um array de leituras passadas nesse mesmo formato.
     Sem isso, os gráficos começam com um histórico simulado só
     para não ficarem vazios, e vão se preenchendo com dados reais
     conforme o tempo passa.
  ============================================================ */
  const CONFIG = {
    USE_SIMULATION: true,                        // false = busca dados reais em vez de simular
    API_URL: 'http://192.168.0.100/leituras',     // endpoint com a leitura mais recente
    HISTORY_URL: '',                              // endpoint opcional com leituras passadas
    POLL_INTERVAL_MS: 4000,                       // frequência de atualização
  };

  /* ---------------- funções utilitárias ---------------- */
  // clamp: prende um número entre um mínimo e um máximo (ex.: umidade nunca passa de 100%)
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const rand=(a,b)=>a+Math.random()*(b-a); // número aleatório entre "a" e "b", usado na simulação

  // nomes dos meses/dias em português, usados no relógio do topo

  const monthsPt=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const daysPt=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

  // Atualiza a data e a hora mostradas no cabeçalho
  function updateClock(){
    const now=new Date();
    document.getElementById('heroDate').textContent = daysPt[now.getDay()]+", "+now.getDate()+" de "+monthsPt[now.getMonth()];
    document.getElementById('heroTime').textContent = now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  }
  updateClock();
  setInterval(updateClock,15000); // atualiza o relógio a cada 15 segundos

  /* ====================================================================
     HISTÓRICO SIMULADO
     Gera 7 dias de leituras "falsas" (uma por hora) para os gráficos
     não começarem vazios. Isso é só um placeholder: quando o ESP32
     estiver conectado (ver CONFIG acima), o histórico real vai
     substituindo esses dados aos poucos.
  ==================================================================== */
  const HOURS=168; // 7 dias × 24 horas = 168 pontos de histórico
  const now=Date.now();

  // Gera uma série de 168 pontos aplicando uma fórmula (fn) + um ruído aleatório,
  // para simular uma curva realista de sobe-e-desce ao longo do dia
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

  // Uma série de dados para cada sensor. Cada valor de "h" (hora do dia) passa
  // por uma função seno para imitar o ciclo natural (ex.: mais calor ao meio-dia)
  const series = {
    temp: genSeries(h => 21 + 6*Math.sin((h-9)/24*2*Math.PI), 0.4),
    hum:  genSeries(h => 60 - 18*Math.sin((h-9)/24*2*Math.PI), 1.5),
    press:genSeries((h,i) => 1013 + 3*Math.sin(i/17) , 0.3),
    air:  genSeries(h => 520 + 220*Math.max(0,Math.sin((h-8)/24*2*Math.PI)) , 25),
    ldr:  genSeries(h => clamp(90*Math.max(0,Math.sin((h-6)/12*Math.PI)),0,100), 3),
    lux:  genSeries(h => clamp(45000*Math.max(0,Math.sin((h-6)/12*Math.PI)),0,60000), 800),
    rainRate: genSeries((h,i) => (i%37<2 ? rand(1,9) : 0), 0.1),
  };
  // Chuva acumulada: soma a intensidade (rainRate) ao longo do dia e zera à meia-noite
  series.rainAcc = (()=>{
    const arr=[]; let acc=0; let lastDay=null;
    series.rainRate.forEach(p=>{
      const d=new Date(p.t).toDateString();
      if(d!==lastDay){acc=0; lastDay=d;}
      acc += Math.max(0,p.v)/12; // rough mm contribution
      arr.push({t:p.t, v:acc});
    });
    return arr;
  })();

  // Pega o valor mais recente de um sensor (o último item da série)
  function latest(key){ const s=series[key]; return s[s.length-1].v; }
  // Adiciona uma nova leitura ao final da série de um sensor, removendo a mais antiga
  // se a lista ficar grande demais (mantém só o histórico necessário)
  function pushLive(key, nextVal, t){
    if(nextVal===undefined || nextVal===null || Number.isNaN(nextVal)) return; // ignora campo ausente no JSON
    const s=series[key];
    s.push({t: t||Date.now(), v:nextVal});
    if(s.length>HOURS+40) s.shift();
  }

  /* ---------------- aparência dos gráficos (Chart.js) ---------------- */
  const CHART_LINE = '#0B5FA5';
  const CHART_FILL = 'rgba(47,155,219,.14)';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = '#547089';

  // Recorta a série de dados de acordo com o período escolhido (6h / 24h / 7 dias)
  function sliceRange(s, range){
    const count = range==='6h'?6:range==='24h'?24:168;
    return s.slice(Math.max(0,s.length-count));
  }

  // Formata a data/hora de cada ponto do gráfico (ex.: "14:30" ou "seg" para 7 dias)
  function fmtLabel(t, range){
    const d=new Date(t);
    if(range==='7d') return d.toLocaleDateString('pt-BR',{weekday:'short'});
    return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  }

  // Cria um mini-gráfico (sparkline) sem eixos, usado dentro dos cartões da visão geral
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

  // Cria o gráfico grande de uma aba detalhada, com eixos e legendas
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

  /* ---------------- cria os mini-gráficos dos cartões da visão geral ---------------- */
  const sparks = {
    temp: makeSpark('spark-temp','temp'),
    press: makeSpark('spark-press','press'),
    air: makeSpark('spark-air','air'),
    ldr: makeSpark('spark-ldr','ldr'),
    lux: makeSpark('spark-lux','lux'),
    rain: makeSpark('spark-rain','rainAcc'),
  };

  /* ====================================================================
     GRÁFICOS DAS ABAS DETALHADAS
     São criados sob demanda (só quando o usuário abre a aba pela
     primeira vez), para não desperdiçar processamento à toa
  ==================================================================== */
  const detailChartDefs = {
    temp:{id:'chart-temp', key:'temp', unit:'°C'},
    pressure:{id:'chart-pressure', key:'press', unit:'hPa'},
    air:{id:'chart-air', key:'air', unit:'ppm'},
    ldr:{id:'chart-ldr', key:'ldr', unit:'%'},
    lux:{id:'chart-lux', key:'lux', unit:'lux'},
    rain:{id:'chart-rain', key:'rainAcc', unit:'mm'},
  };
  const detailCharts = {};

  // Cria o gráfico de uma aba na primeira vez que ela é aberta (e só uma vez)
  function ensureDetailChart(tabName){
    const def=detailChartDefs[tabName];
    if(!def) return;
    if(!detailCharts[tabName]){
      detailCharts[tabName]=makeDetailChart(def.id, def.key, def.unit);
    }
  }

  /* ---------------- botões de período (6h / 24h / 7 dias) ---------------- */
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

  /* ====================================================================
     NAVEGAÇÃO ENTRE ABAS
     Controla qual painel (<section>) aparece na tela
  ==================================================================== */
  const tabs=document.querySelectorAll('.tab');
  const panels=document.querySelectorAll('.tab-panel');

  // Mostra o painel escolhido e esconde os outros; cria o gráfico da aba se ainda não existir
  function activateTab(name){
    tabs.forEach(t=>t.setAttribute('aria-selected', t.dataset.tab===name));
    panels.forEach(p=>p.classList.toggle('active', p.id==='panel-'+name));
    if(name!=='overview') ensureDetailChart(name);
  }
  // Clique nos botões do menu de abas
  tabs.forEach(t=>t.addEventListener('click',()=>activateTab(t.dataset.tab)));
  // Clique (ou Enter/Espaço) em um cartão da visão geral também leva à aba detalhada dele
  document.querySelectorAll('[data-goto]').forEach(card=>{
    card.addEventListener('click',()=>activateTab(card.dataset.goto));
    card.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activateTab(card.dataset.goto); }});
  });

  /* ====================================================================
     REGRAS DE CLASSIFICAÇÃO E TEXTO NA TELA
  ==================================================================== */
  // Classifica a qualidade do ar em Bom / Moderado / Ruim conforme o valor do MQ135
  function airClass(v){
    if(v<700) return {label:'Bom', cls:'ok'};
    if(v<1000) return {label:'Moderado', cls:'warn'};
    return {label:'Ruim', cls:'warn'};
  }
  // Descreve a condição do tempo em uma frase, usando luz e chuva atuais
  function condFromLux(luxV, rainRate){
    if(rainRate>0.5) return 'Chovendo agora';
    if(luxV<5) return 'Céu limpo à noite';
    if(luxV<15000) return 'Parcialmente nublado';
    return 'Céu limpo';
  }

  // Escreve todos os valores atuais na tela: hero, cartões da visão geral e painéis de detalhe
  function render(){
    const t=latest('temp'), h=latest('hum'), p=latest('press'), a=latest('air'),
          ldrV=latest('ldr'), luxV=latest('lux'), rateV=Math.max(0,latest('rainRate')),
          accV=latest('rainAcc');

    // hero
    document.getElementById('heroTemp').innerHTML = t.toFixed(1)+"<sup>°C</sup>";
    document.getElementById('heroHum').textContent = h.toFixed(0)+"%";
    document.getElementById('heroPress').textContent = p.toFixed(0)+" hPa";
    const ac=airClass(a);
    document.getElementById('heroAir').textContent = ac.label;
    document.getElementById('heroRain').textContent = accV.toFixed(1)+" mm";
    document.getElementById('heroCond').textContent = condFromLux(luxV, rateV);

    // overview cards
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

    // detail panels
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

  render(); // primeira renderização, assim que a página carrega

  /* ---------------- funções usadas tanto pela simulação quanto pelos dados reais ---------------- */
  // Registra uma leitura completa (todos os sensores de uma vez) no histórico
  function pushAll(vals, t){
    pushLive('temp',vals.temp,t); pushLive('hum',vals.hum,t);
    pushLive('press',vals.press,t); pushLive('air',vals.air,t);
    pushLive('ldr',vals.ldr,t); pushLive('lux',vals.lux,t);
    pushLive('rainRate',vals.rainRate,t); pushLive('rainAcc',vals.rainAcc,t);
  }

  // Atualiza os mini-gráficos dos cartões com os dados mais recentes
  function refreshSparks(){
    Object.entries({temp:'temp',press:'press',air:'air',ldr:'ldr',lux:'lux',rain:'rainAcc'}).forEach(([sk,key])=>{
      const c=sparks[sk];
      c.data.datasets[0].data = series[key].slice(-24).map(pt=>pt.v);
      c.update('none');
    });
  }

  // Atualiza o gráfico grande, mas só da aba que estiver aberta no momento (economiza processamento)
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

  // Roda sempre que chegam novos dados (simulados ou reais): atualiza gráficos e textos
  function afterNewData(){
    refreshSparks();
    refreshVisibleDetailChart();
    render();
  }

  /* ====================================================================
     MODO SIMULADO (ativo enquanto CONFIG.USE_SIMULATION for true)
     Inventa uma nova leitura a cada intervalo, variando um pouco o
     valor anterior de cada sensor (um "passeio aleatório")
  ==================================================================== */
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
     MODO REAL (ativo quando CONFIG.USE_SIMULATION = false)
     Busca a leitura mais recente na API do ESP32/backend. Se der
     erro (ex.: ESP32 desligado), cai de volta para o modo simulado
     só naquele ciclo, sem travar o site
  ==================================================================== */
  async function fetchLiveStep(){
    try{
      const res = await fetch(CONFIG.API_URL, {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const d = await res.json();

      // acumulado de chuva: usa o valor do backend se vier, senão soma a intensidade
      const accV = (d.rain_accumulated!==undefined) ? d.rain_accumulated
                    : latest('rainAcc') + Math.max(0,(d.rain_rate||0))/720;

      pushAll({
        temp: d.temperature,
        hum: d.humidity,
        press: d.pressure,
        air: d.air_quality,
        ldr: d.ldr,
        lux: d.lux,
        rainRate: d.rain_rate,
        rainAcc: accV,
      }, d.timestamp);

      afterNewData();
    }catch(err){
      console.warn('SkySense: não consegui buscar dados reais em', CONFIG.API_URL, '— usando simulação como reserva.', err);
      simulateStep();
    }
  }

  /* ====================================================================
     HISTÓRICO REAL (opcional)
     Roda uma vez, ao abrir a página, se CONFIG.HISTORY_URL estiver
     preenchido — troca o histórico simulado pelo histórico real
  ==================================================================== */
  async function loadHistory(){
    if(CONFIG.USE_SIMULATION || !CONFIG.HISTORY_URL) return; // mantém o histórico simulado como placeholder
    try{
      const res = await fetch(CONFIG.HISTORY_URL, {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const rows = await res.json(); // espera um array, mesmo formato de API_URL + timestamp

      if(Array.isArray(rows) && rows.length){
        ['temp','hum','press','air','ldr','lux','rainRate','rainAcc'].forEach(k=>series[k]=[]);
        rows.forEach(r=>{
          const t = r.timestamp || Date.now();
          series.temp.push({t, v:r.temperature});
          series.hum.push({t, v:r.humidity});
          series.press.push({t, v:r.pressure});
          series.air.push({t, v:r.air_quality});
          series.ldr.push({t, v:r.ldr});
          series.lux.push({t, v:r.lux});
          series.rainRate.push({t, v:r.rain_rate});
          series.rainAcc.push({t, v:r.rain_accumulated});
        });
        refreshSparks();
        render();
      }
    }catch(err){
      console.warn('SkySense: não consegui carregar o histórico real de', CONFIG.HISTORY_URL, '— mantendo o histórico simulado.', err);
    }
  }

  /* ---------------- mostra no rodapé se os dados são simulados ou reais ---------------- */
  document.getElementById('sourceNote').innerHTML = CONFIG.USE_SIMULATION
    ? 'SkySense <span class="dot">·</span> dados simulados nesta demonstração, prontos para receber leituras reais do ESP32'
    : 'SkySense <span class="dot">·</span> conectado ao ESP32 em '+CONFIG.API_URL;

  /* ====================================================================
     LOOP PRINCIPAL: decide, a cada intervalo, se busca dados reais
     ou gera um passo da simulação — é o "coração" do site
  ==================================================================== */
  loadHistory(); // tenta carregar histórico real (só faz algo se configurado)
  function tick(){
    CONFIG.USE_SIMULATION ? simulateStep() : fetchLiveStep();
  }
  setInterval(tick, CONFIG.POLL_INTERVAL_MS); // repete o tick() a cada POLL_INTERVAL_MS

})();
