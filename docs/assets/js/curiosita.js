/*
 * Pagina curiosità: fatti sintetici calcolati dai dati (in dashboard_data.py),
 * per quattro fasce di calendario e per le tre categorie separate.
 * Aggiornamento giornaliero (dato a ieri).
 */
const PERIODS = [
  { key: 'globale', tab: 'Tutto lo storico' },
  { key: 'anno', tab: 'Anno scorso' },
  { key: 'mese', tab: 'Mese scorso' },
  { key: 'settimana', tab: 'Settimana scorsa' },
  { key: 'ieri', tab: 'Ieri' }
];
const CAT_BADGE = { parcheggi: 'auto', ciclobox: 'bici', stalli: 'storico' };

let DATA = null;
let current = 'globale';

async function boot() {
  try {
    const res = await fetch('../data/curiosita.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
  } catch (err) {
    document.getElementById('curio-content').innerHTML =
      '<p class="text-muted">Curiosità non disponibili al momento.</p>';
    console.error('Curiosità: errore nel caricamento', err);
    const pl0 = document.getElementById('preloader'); if (pl0) pl0.remove();
    return;
  }
  const gen = document.getElementById('curio-generated');
  if (gen && DATA.generated) gen.textContent = 'Dati aggiornati al ' + itDate(DATA.generated) + '.';

  buildTabs();
  render();
  const pl = document.getElementById('preloader'); if (pl) pl.remove();
}

function buildTabs() {
  const box = document.getElementById('curio-tabs');
  PERIODS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'curio-tab' + (p.key === current ? ' active' : '');
    b.textContent = p.tab;
    b.addEventListener('click', () => {
      current = p.key;
      document.querySelectorAll('.curio-tab').forEach(t => t.classList.remove('active'));
      b.classList.add('active');
      render();
    });
    box.appendChild(b);
  });
}

function render() {
  const root = document.getElementById('curio-content');
  root.innerHTML = '';

  DATA.categories.forEach(cat => {
    const period = cat.periods.find(p => p.key === current);
    const section = document.createElement('section');
    section.className = 'curio-cat';

    const badge = CAT_BADGE[cat.category] || '';
    const h = document.createElement('h2');
    h.innerHTML = '<span class="dash-badge ' + cat.category + '">' + badge + '</span> ' + cat.label +
      ' <span class="curio-period">· ' + (period ? period.label : '') + '</span>';
    section.appendChild(h);

    if (!period || period.empty || !period.facts.length) {
      const p = document.createElement('p');
      p.className = 'curio-empty';
      p.textContent = 'Nessun dato per questa categoria in questo periodo.';
      section.appendChild(p);
    } else {
      if (period.n_days && period.n_days < 5) {
        const w = document.createElement('p');
        w.className = 'curio-few';
        w.textContent = '⚠️ Solo ' + period.n_days + ' giorni di dati: le curiosità di questo periodo sono poco robuste.';
        section.appendChild(w);
      }
      const grid = document.createElement('div');
      grid.className = 'curio-grid';
      period.facts.forEach(f => {
        const card = document.createElement('div');
        card.className = 'curio-card';
        card.innerHTML =
          '<div class="curio-label">' + f.label + '</div>' +
          '<div class="curio-value">' + f.value + '</div>' +
          '<div class="curio-detail">' + (f.detail || '') + '</div>';
        grid.appendChild(card);
      });
      section.appendChild(grid);
    }
    root.appendChild(section);
  });
}

function itDate(iso) {
  const M = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + M[m - 1] + ' ' + y;
}

window.addEventListener('load', boot);
