/*
 * Dashboard andamento parcheggi.
 * Tre categorie tenute rigorosamente separate, ciascuna dal proprio JSON:
 *   struttura  -> parcheggi in struttura (auto)
 *   ciclobox   -> parcheggi ciclobox (bici)
 *   stalliblu  -> stalli blu (dato storico, non più aggiornato)
 * Nessun dato viene mai mescolato tra categorie: ogni sezione carica ed
 * elabora esclusivamente il file della propria categoria.
 */

const CATEGORIES = [
  { key: 'struttura', file: 'data/dashboard_struttura.json', color: '#185FA5' },
  { key: 'ciclobox', file: 'data/dashboard_ciclobox.json', color: '#0F6E56' },
  { key: 'stalliblu', file: 'data/dashboard_stalliblu.json', color: '#993C1D' }
];

const charts = []; // per il resize globale

async function loadCategory(cfg) {
  const section = document.getElementById('dash-' + cfg.key);
  if (!section) return;

  let payload;
  try {
    const res = await fetch(cfg.file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    payload = await res.json();
  } catch (err) {
    console.error('Dashboard: impossibile caricare ' + cfg.file, err);
    section.querySelector('[data-role="status"]').textContent =
      'Dati non disponibili per questa categoria.';
    return;
  }

  renderCategory(cfg, payload, section);
}

function renderCategory(cfg, data, section) {
  const meta = data.meta;

  // intestazione: etichetta + periodo + eventuale banner "non aggiornato"
  section.querySelector('[data-role="label"]').textContent = meta.label;
  const period = 'Periodo dei dati: dal ' + itDate(meta.period_start) +
    ' al ' + itDate(meta.period_end) + ' · ' + meta.n_structures + ' parcheggi';
  section.querySelector('[data-role="period"]').textContent = period;

  const banner = section.querySelector('[data-role="banner"]');
  if (!meta.updated) {
    banner.textContent = '⚠️ ' + (meta.note || 'Dati non più aggiornati.');
    banner.style.display = '';
  } else {
    banner.style.display = 'none';
  }

  const status = section.querySelector('[data-role="status"]');
  if (status) status.style.display = 'none';

  // composizione stalli (solo stalli blu)
  const compEl = section.querySelector('[data-role="composition"]');
  if (compEl) {
    if (data.composition) {
      compEl.style.display = '';
      renderComposition(compEl.querySelector('[data-role="comp-chart"]'), data.composition);
    } else {
      compEl.style.display = 'none';
    }
  }

  // selettore parcheggio -> pilota heatmap + profilo orario
  const select = section.querySelector('[data-role="select"]');
  select.innerHTML = '';
  data.structures.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = s.name;
    select.appendChild(opt);
  });

  const heatEl = section.querySelector('[data-role="heatmap"]');
  const hourEl = section.querySelector('[data-role="hourly"]');
  const heatChart = echarts.init(heatEl);
  const hourChart = echarts.init(hourEl);
  charts.push(heatChart, hourChart);

  const drawSelected = () => {
    const s = data.structures[Number(select.value)];
    drawHeatmap(heatChart, s, data.weekdays);
    drawHourly(hourChart, s, cfg.color);
    const info = section.querySelector('[data-role="struct-info"]');
    if (info) {
      info.textContent =
        'Capacità ' + s.capacity + ' · occupazione media ' + s.occ_mean + '%' +
        (s.saturation_hour !== null ? ' · ora di punta ~' + s.saturation_hour + ':00' : '') +
        ' · sensore attivo ' + s.uptime_pct + '% del tempo';
    }
  };
  select.addEventListener('change', drawSelected);
  drawSelected();

  // ranking occupazione media (tutte le strutture)
  const rankEl = section.querySelector('[data-role="ranking"]');
  const rankChart = echarts.init(rankEl);
  charts.push(rankChart);
  drawRanking(rankChart, data.ranking, cfg.color);

  // qualità del dato: uptime per sensore
  const upEl = section.querySelector('[data-role="uptime"]');
  const upChart = echarts.init(upEl);
  charts.push(upChart);
  drawUptime(upChart, data.ranking);
}

function drawHeatmap(chart, s, weekdays) {
  const hours = Array.from({ length: 24 }, (_, h) => h + ':00');
  chart.setOption({
    tooltip: {
      position: 'top',
      formatter: p => weekdays[p.value[1]] + ' ' + p.value[0] + ':00 → ' +
        (p.value[2] == null ? 'n/d' : p.value[2] + '% occupato')
    },
    grid: { top: 10, bottom: 60, left: 45, right: 10 },
    xAxis: { type: 'category', data: hours, splitArea: { show: true },
      axisLabel: { interval: 2, fontSize: 10 } },
    yAxis: { type: 'category', data: weekdays, splitArea: { show: true } },
    visualMap: {
      min: 0, max: 100, calculable: true, orient: 'horizontal',
      left: 'center', bottom: 5,
      inRange: { color: ['#E1F5EE', '#F9E79F', '#E24B4A'] },
      text: ['pieno', 'libero'], textStyle: { fontSize: 10 }
    },
    series: [{
      name: 'occupazione', type: 'heatmap',
      data: s.heatmap.map(d => [d[0], d[1], d[2] == null ? '-' : d[2]]),
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } }
    }]
  });
}

function drawHourly(chart, s, color) {
  const hours = Array.from({ length: 24 }, (_, h) => h + ':00');
  chart.setOption({
    tooltip: { trigger: 'axis',
      formatter: p => p[0].axisValue + ' → ' +
        (p[0].data == null ? 'n/d' : p[0].data + '% occupato') },
    grid: { top: 20, bottom: 40, left: 45, right: 15 },
    xAxis: { type: 'category', data: hours, boundaryGap: false,
      axisLabel: { interval: 2, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'line', smooth: true, data: s.hourly, connectNulls: true,
      showSymbol: false, lineStyle: { color: color, width: 2.5 },
      areaStyle: { color: color, opacity: 0.12 },
      markLine: s.saturation_hour !== null ? {
        symbol: 'none', silent: true,
        data: [{ xAxis: s.saturation_hour + ':00', label: { formatter: 'punta' } }],
        lineStyle: { color: color, type: 'dashed', opacity: 0.6 }
      } : undefined
    }]
  });
}

function drawRanking(chart, ranking, color) {
  const items = ranking.slice().reverse(); // barre orizzontali: più alto in cima
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: p => {
        const r = items[p[0].dataIndex];
        return r.name + '<br/>occupazione media ' + r.occ_mean + '%' +
          (r.saturation_hour !== null ? '<br/>ora di punta ~' + r.saturation_hour + ':00' : '');
      } },
    grid: { top: 10, bottom: 30, left: 5, right: 40, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: items.map(r => r.name),
      axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' } },
    series: [{
      type: 'bar', data: items.map(r => r.occ_mean),
      itemStyle: { color: color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 }
    }]
  });
}

function drawUptime(chart, ranking) {
  const items = ranking.slice().sort((a, b) => a.uptime_pct - b.uptime_pct);
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: p => items[p[0].dataIndex].name + '<br/>sensore attivo ' +
        p[0].data + '% del tempo (offline ' + (100 - p[0].data).toFixed(1) + '%)' },
    grid: { top: 10, bottom: 30, left: 5, right: 40, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: items.map(r => r.name),
      axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' } },
    series: [{
      type: 'bar', data: items.map(r => r.uptime_pct),
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: p => p.value >= 95 ? '#1D9E75' : (p.value >= 85 ? '#EF9F27' : '#E24B4A')
      },
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 }
    }]
  });
}

function renderComposition(el, comp) {
  const chart = echarts.init(el);
  charts.push(chart);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} stalli ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['40%', '68%'], center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{c}', fontSize: 11 },
      data: [
        { name: 'Stalli blu', value: comp.blu, itemStyle: { color: '#378ADD' } },
        { name: 'Carico/scarico', value: comp.carico_scarico, itemStyle: { color: '#EF9F27' } },
        { name: 'Disabili', value: comp.disabili, itemStyle: { color: '#7F77DD' } }
      ]
    }]
  });
}

function itDate(iso) {
  const M = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + M[m - 1] + ' ' + y;
}

window.addEventListener('resize', () => charts.forEach(c => c.resize()));
window.addEventListener('load', () => CATEGORIES.forEach(loadCategory));
