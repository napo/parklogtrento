/*
 * Pagina previsioni.
 *
 * Si prevedono SOLO parcheggi in struttura e ciclobox, sempre separati.
 * Gli stalli blu non compaiono: la raccolta si e' interrotta ad aprile 2025 e
 * prevederli sarebbe inventare.
 *
 * Accanto alla previsione viene mostrata la sua valutazione: le previsioni
 * emesse nei giorni scorsi vengono confrontate con quello che e' davvero
 * successo. Una previsione senza il suo errore non vale niente.
 */

const CATEGORIE = [
  { key: 'parcheggi', file: '../data/forecast_parcheggi.json', color: '#185FA5' },
  { key: 'ciclobox', file: '../data/forecast_ciclobox.json', color: '#0F6E56' }
];
const WD_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const MO_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const grafici = [];
const reg = {};
let punteggi = null;

async function boot() {
  const preloader = document.getElementById('preloader');
  try {
    try {
      const r = await fetch('../data/forecast_score.json');
      if (r.ok) punteggi = await r.json();
    } catch (e) { console.warn('valutazione non disponibile', e); }

    await Promise.all(CATEGORIE.map(async cfg => {
      const sez = document.getElementById(cfg.key);
      if (!sez) return;
      try {
        const r = await fetch(cfg.file);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        prepara(cfg, await r.json(), sez);
      } catch (err) {
        console.error('Previsioni: errore nel caricamento di ' + cfg.file, err);
        const st = sez.querySelector('[data-role="status"]');
        if (st) st.textContent = 'Previsioni non disponibili per questa categoria.';
      }
    }));
  } finally {
    if (preloader) preloader.remove();
    requestAnimationFrame(() => grafici.forEach(c => c.resize()));
    setTimeout(() => grafici.forEach(c => c.resize()), 120);
  }
}

// Data nel formato breve italiano: "ven 17 lug 26"
function dataIt(iso) {
  const d = new Date(iso);
  return WD_BREVI[(d.getDay() + 6) % 7] + ' ' + String(d.getDate()).padStart(2, '0') + ' ' +
    MO_BREVI[d.getMonth()] + ' ' + String(d.getFullYear() % 100).padStart(2, '0');
}

function prepara(cfg, dati, sez) {
  sez.querySelector('[data-role="label"]').textContent = dati.meta.label;
  const st = sez.querySelector('[data-role="status"]');
  if (st) st.style.display = 'none';

  sez.querySelector('[data-role="emessa"]').textContent =
    'Ultimo dato: ' + dataIt(dati.meta.ultimo_dato) + ' ore ' + dati.meta.ultimo_dato.slice(11, 16) +
    ' · previsione fino a ' + dati.meta.orizzonte_ore + " ore avanti · modello: " + dati.meta.modello;

  const sel = sez.querySelector('[data-role="select"]');
  sel.innerHTML = '';
  dati.structures.slice().sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .forEach(s => {
      const i = dati.structures.indexOf(s);
      const o = document.createElement('option');
      o.value = i; o.textContent = s.name;
      sel.appendChild(o);
    });
  sel.addEventListener('change', () => disegna(cfg.key));

  const chart = echarts.init(sez.querySelector('[data-role="chart"]'));
  grafici.push(chart);
  reg[cfg.key] = { cfg, dati, sez, sel, chart };
  disegna(cfg.key);
  mostraValutazione(cfg.key);
}

function disegna(key) {
  const R = reg[key];
  const s = R.dati.structures[Number(R.sel.value)];
  const info = R.sez.querySelector('[data-role="info"]');

  if (!s.punti.length) {
    info.innerHTML = '<span class="prev-warn">Nessuna previsione disponibile per questo parcheggio.</span>';
    R.chart.clear();
    return;
  }

  const p0 = s.punti[0];
  info.innerHTML = '<strong>' + s.name + '</strong> · capienza ' + s.capacity +
    ' · fra un\'ora: <strong>' + p0.occ + '%</strong> occupato' +
    (p0.liberi !== null ? ' (' + p0.liberi + ' posti liberi)' : '') +
    ' <span class="prev-banda">tra ' + p0.min + '% e ' + p0.max + '%</span>' +
    ' · errore tipico di questo parcheggio: ±' + s.mae_storico + ' punti';

  const asse = s.punti.map(p => p.ts);
  R.chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: ps => {
        const i = ps[0].dataIndex, p = s.punti[i];
        return dataIt(p.ts) + ' ore ' + p.ts.slice(11, 16) + '<br/><strong>' + p.occ + '%</strong> occupato' +
          (p.liberi !== null ? ' (~' + p.liberi + ' posti liberi)' : '') +
          '<br/>probabile fra ' + p.min + '% e ' + p.max + '%';
      }
    },
    grid: { top: 30, bottom: 60, left: 45, right: 15 },
    xAxis: {
      type: 'category', data: asse, boundaryGap: false,
      axisLabel: {
        fontSize: 10, interval: 5,
        formatter: v => {
          const d = new Date(v);
          return WD_BREVI[(d.getDay() + 6) % 7] + ' ' + String(d.getDate()).padStart(2, '0') + ' ' +
            MO_BREVI[d.getMonth()] + '\n' + v.slice(11, 16);
        }
      }
    },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { // banda di incertezza: dal minimo, poi lo spessore
        name: 'min', type: 'line', data: s.punti.map(p => p.min), lineStyle: { opacity: 0 },
        stack: 'banda', symbol: 'none', silent: true
      },
      {
        name: 'incertezza', type: 'line', data: s.punti.map(p => +(p.max - p.min).toFixed(1)),
        lineStyle: { opacity: 0 }, areaStyle: { color: R.cfg.color, opacity: 0.15 },
        stack: 'banda', symbol: 'none', silent: true
      },
      {
        name: 'previsione', type: 'line', data: s.punti.map(p => p.occ), smooth: true,
        showSymbol: false, lineStyle: { color: R.cfg.color, width: 2.5 }, z: 3
      }
    ]
  }, true);
}

function mostraValutazione(key) {
  const R = reg[key];
  const box = R.sez.querySelector('[data-role="valutazione"]');
  if (!box) return;
  const cat = punteggi && punteggi.categorie ? punteggi.categorie.find(c => c.meta.category === key) : null;

  if (!cat || !cat.meta.verificabili) {
    box.innerHTML = '<p class="prev-nota">La valutazione comparirà quando le previsioni emesse oggi ' +
      'potranno essere confrontate con quello che sarà davvero successo: serve almeno un giorno.</p>';
    return;
  }
  const m = cat.meta;
  let html = '<p class="prev-nota">Confronto fra le previsioni emesse nei giorni scorsi e la realtà, dal ' +
    dataIt(m.periodo_da) + ' al ' + dataIt(m.periodo_a) + ' (' + m.verificabili + ' ore verificate).<br/>' +
    'Errore medio <strong>' + m.mae_medio + ' punti</strong>, contro i ' + m.mae_riferimento +
    ' di un riferimento banale: <strong>' + m.skill + '%</strong> di errore in meno.</p>';
  html += '<table class="prev-tab"><thead><tr><th>Parcheggio</th><th>Errore medio</th><th>Meglio del riferimento</th></tr></thead><tbody>';
  cat.per_struttura.forEach(s => {
    const cls = s.skill > 0 ? 'ok' : 'ko';
    html += '<tr><td>' + s.name + '</td><td>±' + s.mae + ' punti</td><td class="' + cls + '">' + s.skill + '%</td></tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
}

window.addEventListener('resize', () => grafici.forEach(c => c.resize()));
window.addEventListener('load', boot);
