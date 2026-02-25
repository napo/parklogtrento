```js
// =======================
// PARCHEGGI TRENTO - APP
// (fix timestamp 1970 + retry + robustezza)
// =======================

const summary = {
  bike: { total: 0, freeslots: 0, spacerate: 0, latestdate: '', totalspaces: 0 },
  park: { total: 0, freeslots: 0, spacerate: 0, latestdate: '', totalspaces: 0 }
};

var total_zones = 0; // se non serve puoi rimuoverla

const TIMEZONE = 'Europe/Rome';

function getTsSeconds(item) {
  // dal JSON: currentTimestamp (secondi). fallback se in futuro cambia.
  let ts = item?.currentTimestamp ?? item?.lastReceivedTimestamp ?? null;

  // se è in millisecondi (euristica), converti
  if (typeof ts === "number" && ts > 1e12) ts = Math.floor(ts / 1000);

  // se stringa ISO
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    ts = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  return (typeof ts === "number" && Number.isFinite(ts) && ts > 0) ? ts : null;
}

async function fetchParkingData(timeout = 5000) {
  const proxyUrl =
    "https://corsproxy.io?url=" +
    encodeURIComponent("https://parcheggi.comune.trento.it/static/services/registry_parks.json");

  const controller = new AbortController();
  const signal = controller.signal;

  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(proxyUrl, { signal });
    clearTimeout(timer);

    if (!response.ok) throw new Error("Errore HTTP: " + response.status);

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Formato JSON inatteso: non è un array");

    return data;
  } catch (err) {
    clearTimeout(timer);
    console.error("Errore nel caricamento dei dati:", err?.message || err);
    showErrorAndRefreshOption();
    return null;
  }
}

function showErrorAndRefreshOption() {
  const errorBox = document.getElementById("error-box");
  if (errorBox) {
    errorBox.innerHTML = `
      <p>⚠️ Errore nel caricamento dei parcheggi.
        <button type="button" onclick="retryFetch()">Riprova</button>
      </p>
    `;
  }
}

function retryFetch() {
  const errorBox = document.getElementById("error-box");
  if (errorBox) errorBox.innerHTML = "⏳ Ricarico dati...";
  startApp(); // rilancia davvero tutto
}

async function render() {
  const data = await fetchParkingData();
  if (!data) return; // evita crash

  // Pulisci container per evitare duplicati ad ogni retry/refresh
  if (typeof bikeContainer !== "undefined" && bikeContainer) bikeContainer.innerHTML = "";
  if (typeof structureContainer !== "undefined" && structureContainer) structureContainer.innerHTML = "";

  // Reset summary
  summary.bike.total = 0;
  summary.bike.freeslots = 0;
  summary.bike.totalspaces = 0;

  summary.park.total = 0;
  summary.park.freeslots = 0;
  summary.park.totalspaces = 0;

  // ---- Latest extraction time (solo PARK) ----
  const parks = data.filter(item => item.type === "park");
  const tsList = parks.map(getTsSeconds).filter(ts => ts !== null);
  const latestTimestamp = tsList.length ? Math.max(...tsList) : null;

  if (latestTimestamp) {
    const latestDate = new Date(latestTimestamp * 1000);

    const formattedDate = latestDate.toLocaleDateString('it-IT', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: TIMEZONE
    });

    const formattedTime = latestDate.toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TIMEZONE
    });

    summary.park.latestdate = `${formattedDate} ore ${formattedTime}`;
  } else {
    summary.park.latestdate = "Data non disponibile";
    console.warn("Nessun timestamp valido trovato nei park: controlla currentTimestamp.");
  }

  // ---- Aggregazione bike + park ----
  const filtered = data.filter(item => item.type === "bike" || item.type === "park");
  filtered.forEach(item => {
    const key = item.type; // "bike" o "park"
    summary[key].total += item.capacity || 0;
    summary[key].freeslots += item.freeslots || 0;
    summary[key].totalspaces += 1;
  });

  ['bike', 'park'].forEach(type => {
    const total = summary[type].total;
    const free = summary[type].freeslots;
    summary[type].spacerate = total > 0 ? 100 - Math.round((free / total) * 100) : 0;
  });

  updatehero();
  observeGaugeAnimation(summary.park.spacerate);
  observeGaugeBike(summary.bike.spacerate);

  // ---- Cards + animazioni ----
  let indexStructure = 0;
  let indexBike = 0;

  data.forEach((park) => {
    const prefix = park.type === 'bike' ? 'bike' : 'structure';
    const index = park.type === 'bike' ? indexBike++ : indexStructure++;

    const cardHtml = createCard(park, index, prefix);
    const col = document.createElement('div');
    col.className = 'col-md-4 mb-4 parking-card';
    col.innerHTML = cardHtml;

    const container = park.type === 'bike' ? bikeContainer : structureContainer;
    container.appendChild(col);

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateNumbers(park, index, prefix);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    observer.observe(col);
  });
}

function animateValue(el, start, end, duration = 1000, suffix = '') {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    el.innerText = `${value}${suffix}`;
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

async function startApp() {
  const preloader = document.getElementById('preloader');

  try {
    await render();
  } catch (error) {
    console.error("Errore nel caricamento dei dati:", error);
    if (preloader) preloader.innerText = "Errore nel caricamento dei dati.";
    return;
  }

  if (preloader) preloader.remove();
}

window.addEventListener('load', startApp);

function updatehero() {
  document.querySelectorAll('.extractiontime').forEach(el => {
    el.textContent = summary.park.latestdate;
  });

  const totalCar = document.querySelector('span#total_carparkspaces');
  const totalBike = document.querySelector('span#total_bikespaces');
  if (totalCar) totalCar.textContent = summary.park.total;
  if (totalBike) totalBike.textContent = summary.bike.total;

  document.querySelectorAll('.total_parks').forEach(el => el.textContent = summary.park.totalspaces);

  const totalCiclo = document.querySelector('span#total_ciclobox');
  if (totalCiclo) totalCiclo.textContent = summary.bike.totalspaces;

  const carRate = document.querySelector('span#carparkspaces_rate');
  const bikeRate = document.querySelector('span#bikespaces_rate');
  if (carRate) carRate.textContent = summary.park.spacerate + '%';
  if (bikeRate) bikeRate.textContent = summary.bike.spacerate + '%';

  const carFree = document.getElementById('total_carparkspaces_free');
  const bikeFree = document.getElementById('total_bikespaces_free');
  if (carFree) carFree.setAttribute('data-purecounter-end', summary.park.freeslots);
  if (bikeFree) bikeFree.setAttribute('data-purecounter-end', summary.bike.freeslots);

  new PureCounter();
}

function observeGaugeAnimation(spacerate) {
  const target = document.getElementById('gauge_structures');
  if (!target) return;

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        drawGaugeStructures(spacerate);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.4 });

  observer.observe(target);
}

function drawGaugeStructures(spacerate) {
  const chartDom = document.getElementById('gauge_structures');
  if (!chartDom) return;

  // riusa istanza se già presente
  const existing = echarts.getInstanceByDom(chartDom);
  const myChart = existing ? existing : echarts.init(chartDom);

  const optiongauge_structures = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        splitNumber: 4,
        itemStyle: { color: '#199eb8' },
        progress: { show: true, roundCap: true, width: 18 },
        pointer: {
          show: true,
          icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',
          length: '75%',
          width: 16,
          offsetCenter: [0, '5%']
        },
        axisLine: { roundCap: true, lineStyle: { width: 18 } },
        axisTick: { splitNumber: 2, lineStyle: { width: 2, color: '#999' } },
        splitLine: { length: 12, lineStyle: { width: 3, color: '#999' } },
        axisLabel: { distance: 30, color: '#999', fontSize: 20 },
        detail: {
          backgroundColor: '#fff',
          borderWidth: 0,
          width: '100%',
          lineHeight: 0,
          height: 0,
          borderRadius: 8,
          offsetCenter: [0, '35%'],
          valueAnimation: true,
          formatter: function (value) {
            return '{value|' + value.toFixed(0) + '%}{unit|posti occupati}';
          },
          rich: {
            value: { fontSize: 50, fontWeight: 'bolder', color: '#777' },
            unit: { fontSize: 20, color: '#999', padding: [0, 0, -20, 10] }
          }
        },
        data: [{ value: spacerate }]
      }
    ]
  };

  myChart.setOption(optiongauge_structures);
  window.addEventListener('resize', () => myChart.resize());
}

function drawGaugeBike(spacerate) {
  const chartDom = document.getElementById('gauge_bike');
  if (!chartDom) return;

  const existing = echarts.getInstanceByDom(chartDom);
  const myChart = existing ? existing : echarts.init(chartDom);

  const option = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        splitNumber: 4,
        itemStyle: { color: '#199eb8' },
        progress: { show: true, roundCap: true, width: 18 },
        pointer: {
          show: true,
          icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',
          length: '75%',
          width: 16,
          offsetCenter: [0, '5%']
        },
        axisLine: { roundCap: true, lineStyle: { width: 18 } },
        axisTick: { splitNumber: 2, lineStyle: { width: 2, color: '#999' } },
        splitLine: { length: 12, lineStyle: { width: 3, color: '#999' } },
        axisLabel: { distance: 30, color: '#999', fontSize: 16 },
        detail: {
          valueAnimation: true,
          formatter: v => `${v.toFixed(0)}% occupati`,
          fontSize: 24,
          color: '#555',
          offsetCenter: [0, '35%']
        },
        data: [{ value: spacerate }]
      }
    ]
  };

  myChart.setOption(option);
  window.addEventListener('resize', () => myChart.resize());
}

function observeGaugeBike(spacerate) {
  const chartContainer = document.getElementById('gauge_bike');
  if (!chartContainer) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        drawGaugeBike(spacerate);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  observer.observe(chartContainer);
}

function createCard(park, index, prefix) {
  const capacity = park.capacity || 0;
  const free = park.freeslots || 0;
  const occupied = capacity - free;
  const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;

  let lat = null, lng = null;
  if (park.geom && park.geom.startsWith('POINT(')) {
    const [lng0, lat0] = park.geom.replace('POINT(', '').replace(')', '').trim().split(/\s+/);
    lng = lng0;
    lat = lat0;
  }

  const ts = getTsSeconds(park);
  const date = ts ? new Date(ts * 1000) : null;

  const giorno = date
    ? date.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TIMEZONE })
    : 'data non disponibile';

  const ora = date
    ? date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })
    : '--:--';

  const apertura = park.opening || {};
  const lunven = (apertura.lunven || []).join(', ');
  const sab = (apertura.sab || []).join(', ');
  const fes = (apertura.fes || []).join(', ');

  const html = [];
  html.push(`<div class="card h-100">`);
  html.push(`  <div class="card-body d-flex flex-column">`);
  html.push(`    <h5 class="card-title"><a href="${park.link}" target="_blank">${park.name}</a></h5>`);

  if (lat && lng) {
    const geoUrl = `geo:${lat},${lng}?z=19`;
    if (park.address) {
      const formattedAddress = formatAddress(park.address);
      html.push(`<p class="card-text mb-1"><a href="${geoUrl}">${formattedAddress}</a></p>`);
    } else {
      html.push(`<p class="card-text mb-1"><a href="${geoUrl}">dove si trova</a></p>`);
    }
  }

  html.push(`    <p class="card-text"><em>${giorno} - ${ora}</em></p>`);
  html.push(`    <p class="card-text"><strong>Capacità:</strong> ${capacity}<br/>`);
  html.push(`    <strong>Spazi liberi:</strong> <span id="free-${prefix}-${index}">${free}</span><br/>`);
  html.push(`    <strong>Spazi occupati:</strong> <span id="occupied-${prefix}-${index}">${occupied}</span><br/>`);

  if (lunven || sab || fes) {
    html.push(`<p class="card-text"><strong>Apertura:</strong><br>`);
    if (lunven) html.push(`<strong>lun-ven:</strong> ${lunven}<br>`);
    if (sab) html.push(`<strong>sabato:</strong> ${sab}<br>`);
    html.push(fes ? `<strong>festivi:</strong> ${fes}` : `<strong>festivi:</strong> chiuso`);
    html.push(`</p>`);
  }

  if (Array.isArray(park.rates) && park.rates.length > 0) {
    html.push(`<p class="card-text"><strong>Tariffe:</strong><br>`);
    park.rates.forEach(rate => {
      const from = rate.from || '';
      const to = rate.to || '';
      const cost = rate.cost !== undefined ? `€${rate.cost.toFixed(2)}` : '';
      const unit = rate.unit === 'hour' ? 'ora' : (rate.unit || '');
      html.push(`${from}–${to}: ${cost}/${unit}<br>`);
    });
    html.push(`</p>`);
  }

  html.push(`    <div class="bar-section mt-auto">`);
  html.push(`      <div class="bar-label" id="percent-${prefix}-${index}">${percentage}% di posti occupati</div>`);
  html.push(`      <div class="bar-container">
                <div class="bar-occupied" id="bar-occupied-${prefix}-${index}" style="width: 0%"></div>
                <div class="bar-free" id="bar-free-${prefix}-${index}" style="width: 0%"></div>
              </div>`);
  html.push(`<div class="bar-abs">
              <div class="bar-abs-left" id="abs-occupied-${prefix}-${index}">${occupied} occupati</div>
              <div class="bar-abs-right" id="abs-free-${prefix}-${index}">${free} liberi</div>
            </div>`);
  html.push(`    </div> <!-- /.bar-section -->`);
  html.push(`  </div><!-- /.card-body -->`);
  html.push(`</div><!-- /.card -->`);

  return html.join('\n');
}

function formatAddress(address) {
  return address
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (word.startsWith('via') || word.startsWith('piaz')) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function animateNumbers(park, index, prefix) {
  const capacity = park.capacity || 0;
  const free = park.freeslots || 0;
  const occupied = capacity - free;
  const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
  const freePercentage = 100 - percentage;

  const barOccupied = document.getElementById(`bar-occupied-${prefix}-${index}`);
  const barFree = document.getElementById(`bar-free-${prefix}-${index}`);
  if (barOccupied) barOccupied.style.width = `${percentage}%`;
  if (barFree) barFree.style.width = `${freePercentage}%`;

  const absOcc = document.getElementById(`abs-occupied-${prefix}-${index}`);
  const absFree = document.getElementById(`abs-free-${prefix}-${index}`);
  if (absOcc) animateValue(absOcc, 0, occupied, 1000, ' occupati');
  if (absFree) animateValue(absFree, 0, free, 1000, ' liberi');
}
```
