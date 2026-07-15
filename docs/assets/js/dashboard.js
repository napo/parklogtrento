/*
 * Pagina statistiche / andamenti dei parcheggi.
 *
 * Tre categorie separate (parcheggi in struttura, ciclobox, stalli blu),
 * ciascuna dal proprio JSON e con il PROPRIO pannello filtri. Ogni parcheggio
 * ha una matrice GIORNO x ORA di occupazione media; da questa la pagina
 * ricostruisce heatmap, andamento, giornata tipica, classifica e copertura,
 * applicando i filtri del blocco (intervallo di date, giorni della settimana,
 * mesi, fascia oraria) lato browser.
 *
 * - la tendina di ogni blocco ha "Tutti" (aggregato di categoria, default) e poi
 *   i singoli parcheggi in ordine alfabetico;
 * - il blocco stalli (deprecato) ha una toolbar dedicata limitata al periodo di
 *   raccolta dei dati (niente mesi);
 * - ogni grafico può essere aperto a schermo intero.
 */

const CATEGORIES = [
  { key: 'parcheggi', file: '../data/dashboard_struttura.json', color: '#185FA5' },
  { key: 'ciclobox', file: '../data/dashboard_ciclobox.json', color: '#0F6E56' },
  { key: 'stalli', file: '../data/dashboard_stalliblu.json', color: '#993C1D' }
];

const WD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MO = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MO_FULL = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const PALETTE = ['#185FA5', '#E24B4A', '#0F6E56', '#EF9F27', '#7F77DD', '#993C1D', '#2AA9A0', '#B0568A'];

const registry = {};
const allCharts = [];

async function boot() {
  const preloader = document.getElementById('preloader');
  try {
    await Promise.all(CATEGORIES.map(async cfg => {
      const section = document.getElementById(cfg.key);
      if (!section) return;
      try {
        const res = await fetch(cfg.file);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        prepare(cfg, await res.json(), section);
      } catch (err) {
        console.error('Statistiche: errore nel caricamento di ' + cfg.file, err);
        const st = section.querySelector('[data-role="status"]');
        if (st) st.textContent = 'Dati non disponibili per questa categoria.';
      }
    }));
    Object.keys(registry).forEach(renderCategory);
    setupFullscreen();
  } finally {
    if (preloader) preloader.remove();
    requestAnimationFrame(() => allCharts.forEach(c => c.resize()));
    setTimeout(() => allCharts.forEach(c => c.resize()), 120);
  }
}

function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function hoursInBand(flt) { const out = []; for (let h = flt.hFrom; h <= flt.hTo; h++) out.push(h); return out; }
function itLabelDate(d) { return d.getUTCDate() + ' ' + MO_FULL[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
function itIso(iso) { const [y,m,d]=iso.split('-').map(Number); return d + ' ' + MO_FULL[m-1] + ' ' + y; }

function fillSelect(sel, structures, withAll) {
  sel.innerHTML = '';
  if (withAll) { const o = document.createElement('option'); o.value = '__all__'; o.textContent = 'Tutti'; sel.appendChild(o); }
  structures.map((s, i) => ({ i, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .forEach(({ i, name }) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; sel.appendChild(o); });
}

function prepare(cfg, data, section) {
  const meta = data.meta;
  section.querySelector('[data-role="label"]').textContent = meta.label;
  const banner = section.querySelector('[data-role="banner"]');
  if (!meta.updated) { banner.textContent = '\u26A0\uFE0F ' + (meta.note || 'Dati non piu aggiornati.'); banner.style.display = ''; }
  else banner.style.display = 'none';
  const st = section.querySelector('[data-role="status"]'); if (st) st.style.display = 'none';

  data.structures.forEach(s => {
    const start = parseDate(s.start);
    s._dates = s.matrix.map((_, i) => { const dt = new Date(start.getTime()); dt.setUTCDate(dt.getUTCDate() + i); return dt; });
  });

  const select = section.querySelector('[data-role="select"]');
  const select2 = section.querySelector('[data-role="select2"]');
  fillSelect(select, data.structures, true);
  select.value = '__all__';
  if (select2) { fillSelect(select2, data.structures, false); }

  const mode = section.querySelector('[data-role="mode"]');
  const sec2wrap = section.querySelector('[data-role="select2-wrap"]');
  const syncMode = () => { if (sec2wrap) sec2wrap.style.display = (mode && mode.value === 'due' && select.value !== '__all__') ? '' : 'none'; };
  if (mode) { mode.addEventListener('change', () => { syncMode(); renderCategory(cfg.key); }); }
  select.addEventListener('change', () => { syncMode(); renderCategory(cfg.key); });
  if (select2) select2.addEventListener('change', () => renderCategory(cfg.key));
  syncMode();

  const compEl = section.querySelector('[data-role="composition"]');
  if (compEl) {
    if (data.composition) {
      compEl.style.display = '';
      const c = echarts.init(compEl.querySelector('[data-role="comp-chart"]')); allCharts.push(c);
      c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} stalli ({d}%)' },
        legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '44%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { formatter: '{b}\n{c}', fontSize: 11 },
          data: [
            { name: 'Stalli blu', value: data.composition.blu, itemStyle: { color: '#378ADD' } },
            { name: 'Carico/scarico', value: data.composition.carico_scarico, itemStyle: { color: '#EF9F27' } },
            { name: 'Disabili', value: data.composition.disabili, itemStyle: { color: '#7F77DD' } }
          ] }]
      });
    } else compEl.style.display = 'none';
  }

  const charts = {
    trend: echarts.init(section.querySelector('[data-role="trend"]')),
    heatmap: echarts.init(section.querySelector('[data-role="heatmap"]')),
    hourly: echarts.init(section.querySelector('[data-role="hourly"]')),
    ranking: echarts.init(section.querySelector('[data-role="ranking"]')),
    coverage: echarts.init(section.querySelector('[data-role="coverage"]'))
  };
  Object.values(charts).forEach(c => allCharts.push(c));

  const filter = { from: null, to: null, weekdays: new Set(), months: new Set(), hFrom: 0, hTo: 23, regole: new Set() };
  const R = { cfg, data, section, select, select2, mode, charts, filter };
  registry[cfg.key] = R;
  setupBlockFilter(R);
}

/* ------- filtro DEL BLOCCO (tollerante ai controlli mancanti) ------- */
function setupBlockFilter(R) {
  const section = R.section, flt = R.filter;
  let min = null, max = null;
  R.data.structures.forEach(s => {
    const a = s._dates[0], b = s._dates[s._dates.length - 1];
    if (!min || a < min) min = a; if (!max || b > max) max = b;
  });
  if (!min) return;
  const iso = d => d.toISOString().slice(0, 10);
  const rerender = () => renderCategory(R.cfg.key);

  // etichetta del periodo di raccolta (toolbar dedicata stalli)
  const periodEl = section.querySelector('[data-role="flt-period"]');
  if (periodEl) periodEl.textContent = itLabelDate(min) + ' – ' + itLabelDate(max);

  const fromEl = section.querySelector('[data-role="flt-from"]');
  const toEl = section.querySelector('[data-role="flt-to"]');
  if (fromEl && toEl) {
    fromEl.min = toEl.min = iso(min); fromEl.max = toEl.max = iso(max);
    fromEl.value = iso(min); toEl.value = iso(max);
    flt.from = min; flt.to = max;
    const clamp = (d) => d < min ? min : (d > max ? max : d);
    fromEl.addEventListener('change', () => { let d = fromEl.value ? parseDate(fromEl.value) : min; d = clamp(d); fromEl.value = iso(d); flt.from = d; rerender(); });
    toEl.addEventListener('change', () => { let d = toEl.value ? parseDate(toEl.value) : max; d = clamp(d); toEl.value = iso(d); flt.to = d; rerender(); });
  } else { flt.from = min; flt.to = max; }

  const hFrom = section.querySelector('[data-role="flt-hfrom"]');
  const hTo = section.querySelector('[data-role="flt-hto"]');
  if (hFrom && hTo) {
    for (let h = 0; h < 24; h++) { hFrom.appendChild(new Option(h + ':00', h)); hTo.appendChild(new Option(h + ':00', h)); }
    hFrom.value = '0'; hTo.value = '23';
    const onBand = () => {
      let a = parseInt(hFrom.value, 10), b = parseInt(hTo.value, 10);
      if (a > b) { const t = a; a = b; b = t; hFrom.value = a; hTo.value = b; }
      flt.hFrom = a; flt.hTo = b; rerender();
    };
    hFrom.addEventListener('change', onBand); hTo.addEventListener('change', onBand);
  }

  const wdBox = section.querySelector('[data-role="flt-weekdays"]');
  if (wdBox) WD.forEach((lbl, i) => wdBox.appendChild(makeChip(lbl, () => { toggle(flt.weekdays, i); rerender(); })));
  const moBox = section.querySelector('[data-role="flt-months"]');
  if (moBox) MO.forEach((lbl, i) => moBox.appendChild(makeChip(lbl, () => { toggle(flt.months, i); rerender(); })));

  // regola di sosta (solo dove l'API la espone: i ciclobox non ce l'hanno)
  const regBox = section.querySelector('[data-role="flt-regole"]');
  const regWrap = section.querySelector('[data-role="flt-regole-wrap"]');
  const regole = (R.data.meta && R.data.meta.regolamenti) || [];
  if (regBox && regole.length > 1) {
    if (regWrap) regWrap.style.display = '';
    regole.forEach(r => regBox.appendChild(makeChip(r, () => { toggle(flt.regole, r); rerender(); })));
  } else if (regWrap) {
    regWrap.style.display = 'none';
  }

  const reset = section.querySelector('[data-role="flt-reset"]');
  if (reset) reset.addEventListener('click', () => {
    flt.from = min; flt.to = max; flt.weekdays.clear(); flt.months.clear(); flt.regole.clear(); flt.hFrom = 0; flt.hTo = 23;
    if (fromEl) fromEl.value = iso(min); if (toEl) toEl.value = iso(max);
    if (hFrom) hFrom.value = '0'; if (hTo) hTo.value = '23';
    section.querySelectorAll('.flt-chip.active').forEach(c => c.classList.remove('active'));
    rerender();
  });
}

function selectedIndices(structure, flt) {
  const out = [], wd = flt.weekdays, mo = flt.months;
  for (let i = 0; i < structure._dates.length; i++) {
    const d = structure._dates[i];
    if (flt.from && d < flt.from) continue;
    if (flt.to && d > flt.to) continue;
    if (wd.size && !wd.has((d.getUTCDay() + 6) % 7)) continue;
    if (mo.size && !mo.has(d.getUTCMonth())) continue;
    out.push(i);
  }
  return out;
}

function aggregate(structs, flt) {
  const band = hoursInBand(flt);
  const hourSum = {}, hourCnt = {}, hmSum = {}, hmCnt = {}, trendMap = {};
  let cellSum = 0, cellCnt = 0, cellTot = 0, daySet = new Set();
  for (const structure of structs) {
    const orario = structure.orario || null;
    for (const i of selectedIndices(structure, flt)) {
      const row = structure.matrix[i], d = structure._dates[i];
      const dow = (d.getUTCDay() + 6) % 7, isoD = d.toISOString().slice(0, 10);
      // struttura con orari propri: nei giorni di chiusura non c'e' nulla da misurare
      if (orario && orario.giorni.indexOf(dow) === -1) continue;
      daySet.add(isoD);
      for (const h of band) {
        // fuori orario di apertura il dato non esiste: non entra nemmeno nel
        // denominatore della copertura, altrimenti un cancello chiuso
        // sembrerebbe un sensore guasto
        if (orario && (h < orario.apertura || h >= orario.chiusura)) continue;
        cellTot++;
        const v = row[h];
        if (v == null) continue;
        hourSum[h] = (hourSum[h] || 0) + v; hourCnt[h] = (hourCnt[h] || 0) + 1;
        const k = dow * 24 + h; hmSum[k] = (hmSum[k] || 0) + v; hmCnt[k] = (hmCnt[k] || 0) + 1;
        if (!trendMap[isoD]) trendMap[isoD] = [0, 0];
        trendMap[isoD][0] += v; trendMap[isoD][1]++;
        cellSum += v; cellCnt++;
      }
    }
  }
  const hourly = band.map(h => hourCnt[h] ? Math.round(hourSum[h] / hourCnt[h]) : null);
  const heatmap = [];
  for (let dow = 0; dow < 7; dow++) for (const h of band) { const k = dow * 24 + h; heatmap.push([h, dow, hmCnt[k] ? Math.round(hmSum[k] / hmCnt[k]) : '-']); }
  const trend = Object.keys(trendMap).sort().map(x => [x, Math.round(trendMap[x][0] / trendMap[x][1])]);
  const giorni = Array.from(daySet).sort();
  let satH = -1, satV = -1;
  band.forEach((h, i) => { if (hourly[i] != null && hourly[i] > satV) { satV = hourly[i]; satH = h; } });
  return { nDays: daySet.size, band, hourly, heatmap, trend,
    primoGiorno: giorni.length ? giorni[0] : null, ultimoGiorno: giorni.length ? giorni[giorni.length-1] : null,
    mean: cellCnt ? Math.round((cellSum / cellCnt) * 10) / 10 : null,
    coverage: cellTot ? Math.round((cellCnt / cellTot) * 1000) / 10 : 0, saturationHour: satH };
}

// strutture della categoria che passano il filtro per regola di sosta
function structsFiltrate(R) {
  const flt = R.filter;
  if (!flt.regole.size) return R.data.structures;
  return R.data.structures.filter(s => flt.regole.has(s.regulation));
}

function seriesForMode(R) {
  const structs = structsFiltrate(R), val = R.select.value;
  const modeVal = R.mode ? R.mode.value : 'single';
  if (val === '__all__') {
    if (modeVal === 'tutti') return structs.map(s => ({ name: s.name, list: [s] }));
    return [{ name: 'Tutti (media categoria)', list: structs }];
  }
  const primary = structs[Number(val)];
  if (modeVal === 'media') return [{ name: primary.name, list: [primary] }, { name: 'Media categoria', list: structs }];
  if (modeVal === 'due') { const b = structs[Number(R.select2.value)]; return [{ name: primary.name, list: [primary] }, { name: b.name, list: [b] }]; }
  if (modeVal === 'tutti') return structs.map(s => ({ name: s.name, list: [s] }));
  return [{ name: primary.name, list: [primary] }];
}

function renderCategory(key) {
  const R = registry[key]; if (!R) return;
  const color = R.cfg.color, flt = R.filter;
  const isAll = R.select.value === '__all__';
  const elencoFiltrato = structsFiltrate(R);
  const primaryList = isAll ? elencoFiltrato : [R.data.structures[Number(R.select.value)]];
  const primAgg = aggregate(primaryList, flt);

  // periodo effettivamente preso in considerazione da questo blocco
  const periodEl = R.section.querySelector('[data-role="periodo"]');
  if (periodEl) {
    if (primAgg.primoGiorno) {
      const banda = (primAgg.band.length < 24)
        ? ', solo dalle ' + primAgg.band[0] + ':00 alle ' + primAgg.band[primAgg.band.length-1] + ':59'
        : '';
      periodEl.textContent = 'Periodo considerato: dal ' + itIso(primAgg.primoGiorno) +
        ' al ' + itIso(primAgg.ultimoGiorno) + ' \u00B7 ' + primAgg.nDays +
        (primAgg.nDays === 1 ? ' giorno con dati' : ' giorni con dati') + banda;
    } else {
      periodEl.textContent = 'Periodo considerato: nessun giorno rientra nei filtri scelti.';
    }
  }

  // nota per le strutture con regole proprie (es. parcheggio universitario)
  const notaEl = R.section.querySelector('[data-role="nota"]');
  if (notaEl) {
    const st = isAll ? null : R.data.structures[Number(R.select.value)];
    if (st && st.nota) {
      notaEl.innerHTML = '\u2139\uFE0F ' + st.nota +
        (st.nota_link ? ' <a href="' + st.nota_link + '" target="_blank" rel="noopener">' +
          (st.nota_link_testo || 'regole ufficiali') + '</a>.' : '');
      notaEl.style.display = '';
    } else {
      notaEl.style.display = 'none';
    }
  }

  const info = R.section.querySelector('[data-role="struct-info"]');
  if (info) {
    const stSel = isAll ? null : R.data.structures[Number(R.select.value)];
    const regTxt = (flt.regole.size && isAll) ? ' [' + Array.from(flt.regole).join(', ') + ']' : '';
    const who = isAll ? ('Tutti (media categoria)' + regTxt)
                      : stSel.name + (stSel.regulation ? ' \u00B7 ' + stSel.regulation : '');
    if (primAgg.nDays === 0) info.innerHTML = '<span class="dash-warn">Nessun dato nel periodo selezionato.</span>';
    else info.textContent = who + ' \u00B7 occupazione media ' +
      (primAgg.mean == null ? 'n/d' : primAgg.mean + '%') +
      (primAgg.saturationHour >= 0 ? ' \u00B7 ora di punta ~' + primAgg.saturationHour + ':00' : '') +
      ' \u00B7 copertura ' + primAgg.coverage + '%';
  }

  const series = seriesForMode(R).map((s, i) => ({ name: s.name, agg: aggregate(s.list, flt), color: i === 0 ? color : PALETTE[(i + 1) % PALETTE.length] }));
  drawTrend(R.charts.trend, series);
  drawHourly(R.charts.hourly, series);
  drawHeatmap(R.charts.heatmap, primAgg);

  const inizioCategoria = R.data.meta.period_start;
  const rows = elencoFiltrato.map(st => {
    const a = aggregate([st], flt);
    // una struttura nata dopo l'inizio della categoria non e' "scoperta":
    // semplicemente prima non esisteva, e va detto
    const nata = st.first_seen && st.first_seen > inizioCategoria;
    return {
      name: st.name,
      etichetta: nata ? st.name + ' (dal ' + itIso(st.first_seen) + ')' : st.name,
      mean: a.mean, coverage: a.coverage, nDays: a.nDays
    };
  }).filter(r => r.nDays > 0);
  drawRanking(R.charts.ranking, rows, color);
  drawCoverage(R.charts.coverage, rows);
}

function drawTrend(chart, series) {
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: series.length > 1 ? { top: 0, type: 'scroll', textStyle: { fontSize: 10 } } : undefined,
    grid: { top: series.length > 1 ? 32 : 15, bottom: 30, left: 45, right: 15 },
    xAxis: { type: 'time', axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    series: series.map(s => ({ name: s.name, type: 'line', showSymbol: false, data: s.agg.trend, lineStyle: { color: s.color, width: 1.5 }, itemStyle: { color: s.color }, areaStyle: series.length === 1 ? { color: s.color, opacity: 0.1 } : undefined }))
  }, true);
}

function drawHourly(chart, series) {
  const band = series[0].agg.band, hours = band.map(h => h + ':00');
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: series.length > 1 ? { top: 0, type: 'scroll', textStyle: { fontSize: 10 } } : undefined,
    grid: { top: series.length > 1 ? 32 : 20, bottom: 40, left: 45, right: 15 },
    xAxis: { type: 'category', data: hours, boundaryGap: false, axisLabel: { interval: band.length > 12 ? 2 : 0, fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    series: series.map(s => ({ name: s.name, type: 'line', smooth: true, connectNulls: true, showSymbol: false, data: s.agg.hourly, lineStyle: { color: s.color, width: 2.2 }, areaStyle: series.length === 1 ? { color: s.color, opacity: 0.12 } : undefined }))
  }, true);
}

function drawHeatmap(chart, agg) {
  const hours = agg.band.map(h => h + ':00');
  chart.setOption({
    tooltip: { position: 'top', formatter: p => WD[p.value[1]] + ' ' + p.value[0] + ':00 \u2192 ' + (p.value[2] === '-' ? 'n/d' : p.value[2] + '% occupato') },
    grid: { top: 10, bottom: 60, left: 45, right: 10 },
    xAxis: { type: 'category', data: hours, splitArea: { show: true }, axisLabel: { interval: agg.band.length > 12 ? 2 : 0, fontSize: 10 } },
    yAxis: { type: 'category', data: WD, splitArea: { show: true } },
    visualMap: { min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', bottom: 5, inRange: { color: ['#E1F5EE', '#F9E79F', '#E24B4A'] }, text: ['pieno', 'libero'], textStyle: { fontSize: 10 } },
    series: [{ type: 'heatmap', data: agg.heatmap, emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.3)' } } }]
  }, true);
}

function drawRanking(chart, rows, color) {
  const items = rows.slice().sort((a, b) => a.mean - b.mean);
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => items[p[0].dataIndex].name + '<br/>occupazione media ' + p[0].data + '%' },
    grid: { top: 10, bottom: 30, left: 5, right: 40, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: items.map(r => r.etichetta || r.name), axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: items.map(r => r.mean), itemStyle: { color: color, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 } }]
  }, true);
}

function drawCoverage(chart, rows) {
  const items = rows.slice().sort((a, b) => a.coverage - b.coverage);
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => items[p[0].dataIndex].name + '<br/>copertura ' + p[0].data + '%' },
    grid: { top: 10, bottom: 30, left: 5, right: 40, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: items.map(r => r.etichetta || r.name), axisLabel: { fontSize: 10, width: 150, overflow: 'truncate' } },
    series: [{ type: 'bar', data: items.map(r => r.coverage), itemStyle: { borderRadius: [0, 4, 4, 0], color: p => p.value >= 75 ? '#1D9E75' : (p.value >= 50 ? '#EF9F27' : '#E24B4A') }, label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10 } }]
  }, true);
}

/* ------- schermo intero per ogni grafico ------- */
function setupFullscreen() {
  document.querySelectorAll('.dash-chart').forEach(div => {
    const inst = echarts.getInstanceByDom(div);
    if (!inst) return;
    const card = div.closest('.dash-card');
    if (!card || card.querySelector('.chart-expand-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'chart-expand-btn'; btn.type = 'button';
    btn.title = 'Schermo intero'; btn.setAttribute('aria-label', 'Schermo intero');
    btn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
    btn.addEventListener('click', () => openFullscreen(inst));
    card.appendChild(btn);
  });
}

function openFullscreen(sourceInst) {
  const overlay = document.createElement('div');
  overlay.className = 'chart-fs-overlay';
  const inner = document.createElement('div'); inner.className = 'chart-fs-inner';
  const closeBtn = document.createElement('button'); closeBtn.className = 'chart-fs-close'; closeBtn.type = 'button';
  closeBtn.innerHTML = '<i class="bi bi-x-lg"></i> Chiudi';
  const chartDiv = document.createElement('div'); chartDiv.className = 'chart-fs-chart';
  inner.appendChild(closeBtn); inner.appendChild(chartDiv); overlay.appendChild(inner);
  document.body.appendChild(overlay);

  const fs = echarts.init(chartDiv);
  fs.setOption(sourceInst.getOption());
  const onResize = () => fs.resize();
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    fs.dispose(); overlay.remove();
  }
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => fs.resize(), 50);
}

function makeChip(label, onToggle) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'flt-chip'; b.textContent = label;
  b.addEventListener('click', () => { b.classList.toggle('active'); onToggle(); });
  return b;
}
function toggle(set, val) { if (set.has(val)) set.delete(val); else set.add(val); }

window.addEventListener('resize', () => allCharts.forEach(c => c.resize()));
window.addEventListener('load', boot);
