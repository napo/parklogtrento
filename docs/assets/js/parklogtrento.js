const summary = {
  bike: { total: 0, freeslots: 0, spacerate: 0, latestdate: '', totalspaces:0 },
  park: { total: 0, freeslots: 0, spacerate: 0, latestdate: '', totalspaces:0 },
  zone: { total: 0, freeslots: 0, spacerate: 0, latestdate: '', totalspaces:0 }
};
var total_zones = 0;

async function fetchParkingData(timeout = 5000) {
  const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://parcheggi.comune.trento.it/static/services/registry_parks.json");

  const controller = new AbortController();
  const signal = controller.signal;

  // Timeout manuale
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(proxyUrl, { signal });
    clearTimeout(timer); // Se la fetch va a buon fine, annullo il timer
    if (!response.ok) throw new Error("Errore nel fetch");
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("Errore nel caricamento dei dati:", err.message || err);
    // Qui puoi mostrare un messaggio all'utente o offrire un refresh
    showErrorAndRefreshOption();
    return null;
  }
}

function showErrorAndRefreshOption() {
  const errorBox = document.getElementById("error-box");
  if (errorBox) {
    errorBox.innerHTML = `
      <p>⚠️ Errore nel caricamento dei parcheggi. <button onclick="retryFetch()">Riprova</button></p>
    `;
  }
}

function retryFetch() {
  document.getElementById("error-box").innerHTML = "⏳ Ricarico dati...";
  fetchParkingData();
}



async function fetchZonesData() {
  const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://parcheggi.comune.trento.it/static/services/registry_zones.json");
  const response = await fetch(proxyUrl);
  const data = await response.json();
  return data;
}

async function render() {
  //const structureContainer = document.getElementById('parking-structure');
  //const bikeContainer = document.getElementById('bike-parking');
  const data = await fetchParkingData();
  const datazones = await fetchZonesData();
  total_zones = 0;
  datazones.forEach(item => {
    if (Array.isArray(item.stalls)) {
      item.stalls.forEach(stall => {
        if (stall.type === "blu") {
          total_zones += 1;
          summary.zone.total += stall.capacity || 0;
          summary.zone.freeslots += stall.freeslots || 0;
        }
      });
    }
  });
  summary['zone'].spacerate = summary['zone'].total > 0
    ? 100 - Math.round((summary['zone'].freeslots / summary['zone'].total) * 100)
    : 0;

  const parks = data.filter(item => item.type === "park");
  summary.park.totalspaces = parks.length;
  const latestTimestamp = Math.max(...parks.map(p => p.lastReceivedTimestamp || 0));
  const latestDate = new Date(latestTimestamp * 1000);
  const formattedDate = latestDate.toLocaleDateString('it-IT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const formattedTime = latestDate.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit'
  });
  summary.park.latestdate =  `${formattedDate} ore ${formattedTime}`;

  const filtered = data.filter(item => item.type === "bike" || item.type === "park");
  summary.bike.totalspaces = 0;
  filtered.forEach(item => {
    const key = item.type; // "bike" o "park"
    summary[key].total += item.capacity || 0;
    summary[key].freeslots += item.freeslots || 0;
    summary[key].totalspaces +=1 || 0;
  });

  ['bike', 'park'].forEach(type => {
    const total = summary[type].total;
    const free = summary[type].freeslots;
    summary[type].spacerate = total > 0 ? 100 - Math.round((free / total) * 100) : 0;
  });

  updatehero();  
  observeGaugeAnimation(summary.park.spacerate); 
  observeGaugeBike(summary.bike.spacerate);
  observeGaugeZone(summary.zone.spacerate);
  
  document.querySelector('.total_zones').innerText = total_zones;
  const zoneContainer = document.getElementById('zoneContainer');
  datazones.forEach((zone, index) => {
    let total = 0, freeslots = 0;
    (zone.stalls || []).forEach(stall => {
      if (stall.type === "blu") {
        total += stall.capacity || 0;
        freeslots += stall.freeslots || 0;
      }
    });
  
    
    const cardHtml = createCardZone(zone, index);
    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 mb-4 parking-card';
    col.innerHTML = cardHtml;
    zoneContainer.appendChild(col);
  
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateNumbers({ capacity: total, freeslots: freeslots }, index, 'zone');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
  
    observer.observe(col);
  });

  
  let indexStructure = 0;
  let indexBike = 0;
  data.forEach((park) => {
    const prefix = park.type === 'bike' ? 'bike' : 'structure';
    const index = park.type === 'bike' ? indexBike++ : indexStructure++;
    /* card */
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
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}


async function startApp() {
  const preloader = document.getElementById('preloader');

  try {
    await render(); // Chiama tutto il flusso
  } catch (error) {
    console.error("Errore nel caricamento dei dati:", error);
    if (preloader) {
      preloader.innerText = "Errore nel caricamento dei dati.";
      return;
    }
  }

  // Una volta che tutto è pronto, rimuove il preloader
  if (preloader) {
    preloader.remove();
  }
}

// Avvia tutto quando la finestra è caricata
window.addEventListener('load', startApp);


function updatehero() {

  // Aggiorna dinamicamente i testi
  document.querySelectorAll('.extractiontime').forEach(el => {
    el.textContent = summary.park.latestdate;
  });
  document.querySelector('span#total_carparkspaces').textContent = summary.park.total;
  document.querySelector('span#total_bikespaces').textContent = summary.bike.total;
  document.querySelectorAll('.total_parks').forEach(el => el.textContent = summary.park.totalspaces);


  document.querySelector('span#total_zonespaces').textContent = summary.zone.total;
  document.querySelector('span#total_zones').textContent = total_zones;
  document.querySelector('span#total_ciclobox').textContent = summary.bike.totalspaces
  
  document.querySelector('span#carparkspaces_rate').textContent = summary.park.spacerate + '%';
  document.querySelector('span#zonespaces_rate').textContent = summary.zone.spacerate + '%';
  document.querySelector('span#bikespaces_rate').textContent = summary.bike.spacerate  + '%';
  //document.querySelector('span#total_zonespaces_free').textContent = total_zonespaces_free + '%';
  // aggiorna i contatori
  document.getElementById('total_carparkspaces_free').setAttribute('data-purecounter-end', summary.park.freeslots);
  document.getElementById('total_bikespaces_free').setAttribute('data-purecounter-end', summary.bike.freeslots);
  document.getElementById('total_zonespaces_free').setAttribute('data-purecounter-end', summary.zone.freeslots);

  // inizializza PureCounter dopo aver impostato i dati
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
  const myChart = echarts.init(chartDom);

  const optiongauge_structures = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        splitNumber: 4,
        itemStyle: {
          color: '#199eb8'
        },
        progress: {
          show: true,
          roundCap: true,
          width: 18
        },
        pointer: {
          show: true,
          icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',          length: '75%',
          width: 16,
          offsetCenter: [0, '5%']
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 18
          }
        },
        axisTick: {
          splitNumber: 2,
          lineStyle: {
            width: 2,
            color: '#999'
          }
        },
        splitLine: {
          length: 12,
          lineStyle: {
            width: 3,
            color: '#999'
          }
        },
        axisLabel: {
          distance: 30,
          color: '#999',
          fontSize: 20
        },
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
            value: {
              fontSize: 50,
              fontWeight: 'bolder',
              color: '#777'
            },
            unit: {
              fontSize: 20,
              color: '#999',
              padding: [0, 0, -20, 10]
            }
          }
        },
        data: [
          {
            value: spacerate
          }
        ]
      }
    ]
  };

  myChart.setOption(optiongauge_structures);
    window.addEventListener('resize', () => {
      myChart.resize();
    });
}

function drawGaugeBike(spacerate) {
  const chartDom = document.getElementById('gauge_bike');
  if (!chartDom) return;

  const myChart = echarts.init(chartDom);

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
          icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',          length: '75%',
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

function createCardZone(zone, index) {
  let total = 0, freeslots = 0;

  (zone.stalls || []).forEach(stall => {
    if (stall.type === "blu") {
      total += stall.capacity || 0;
      freeslots += stall.freeslots || 0;
    }
  });

  const occupied = total - freeslots;
  const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const html = [];

  html.push(`<div class="card h-100 d-flex flex-column"><div class="card-body d-flex flex-column">`);
  html.push(`<h5 class="card-title">${zone.name}</h5>`);
  html.push(`<p class="card-text"><strong>Capacità:</strong> ${total}</p>`);
  html.push(`<p class="card-text"><strong>Spazi liberi:</strong> <span id="free-zone-${index}">${freeslots}</span></p>`);
  html.push(`<p class="card-text"><strong>Spazi occupati:</strong> <span id="occupied-zone-${index}">${occupied}</span></p>`);

  if (Array.isArray(zone.rates) && zone.rates.length > 0) {
    html.push(`<p class="card-text"><strong>Tariffe:</strong><br>`);
  zone.rates.forEach(rate => {
    const from = rate.from || '';
    const to = rate.to || '';
    const cost = rate.cost !== undefined ? `€${rate.cost.toFixed(2)}` : 'gratis';
    const unitMap = {
      'hour': 'ora',
      'day': 'giorno'
  };
  const unit = unitMap[rate.unit] || rate.unit || '';

  if (rate.cost === 0) {
    html.push(`${from}–${to}: <span class="badge bg-success">gratis</span><br>`);
  } else {
    html.push(`${from}–${to}: ${cost}/${unit}<br>`);
  }
});
html.push(`</p>`);
  }

  html.push(`<div class="bar-label" id="percent-zone-${index}">${percentage}% di posti occupati</div>`);
  html.push(`<div class="bar-container mt-auto">
    <div class="bar-occupied" id="bar-occupied-zone-${index}" style="width: 0%"></div>
    <div class="bar-free" id="bar-free-zone-${index}" style="width: 0%"></div>
  </div>`);
  html.push(`<div class="bar-abs">
    <div class="bar-abs-left" id="abs-occupied-zone-${index}">${occupied} occupati</div>
    <div class="bar-abs-right" id="abs-free-zone-${index}">${freeslots} liberi</div>
  </div>`);
  html.push(`</div></div>`);

  return html.join('\n');
}

function drawGaugeZone(spacerate) {
  console.log('Drawing gauge zone with spacerate:', spacerate);
  const chartDom = document.getElementById('gauge_zone');
  if (!chartDom) return;

  const myChart = echarts.init(chartDom);

  const option = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: 0,
        max: 100,
        splitNumber: 4,
        itemStyle: {
          color: '#3498db'  // colore principale del gauge
        },
        progress: {
          show: true,
          roundCap: true,
          width: 18
        },
        pointer: {
          icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z',
          length: '75%',
          width: 16,
          offsetCenter: [0, '5%']
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 18
          }
        },
        axisTick: {
          splitNumber: 2,
          lineStyle: {
            width: 2,
            color: '#999'
          }
        },
        splitLine: {
          length: 12,
          lineStyle: {
            width: 3,
            color: '#999'
          }
        },
        axisLabel: {
          distance: 30,
          color: '#999',
          fontSize: 20
        },
        detail: {
          valueAnimation: true,
          formatter: function (value) {
            return '{value|' + value.toFixed(0) + '%}{unit|occupati}';
          },
          rich: {
            value: {
              fontSize: 50,
              fontWeight: 'bolder',
              color: '#777'
            },
            unit: {
              fontSize: 20,
              color: '#999',
              padding: [0, 0, -20, 10]
            }
          },
          backgroundColor: '#fff',
          borderWidth: 0,
          width: '100%',
          lineHeight: 0,
          height: 0,
          borderRadius: 8,
          offsetCenter: [0, '35%']
        },
        data: [
          {
            value: spacerate
          }
        ]
      }
    ]
  };

  myChart.setOption(option, true);
  window.addEventListener('resize', () => myChart.resize());
}


function observeGaugeZone(spacerate) {
  const chartContainer = document.getElementById('gauge_zone');
  if (!chartContainer) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        drawGaugeZone(spacerate);
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  observer.observe(chartContainer);
}


function createCard(park, index, prefix) {
  const capacity = park.capacity;
  const free = park.freeslots;
  const occupied = capacity - free;
  const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
  const [lng, lat] = park.geom.replace('POINT(', '').replace(')', '').split(' ');
  const date = new Date(park.lastReceivedTimestamp * 1000);
  const giorno = date.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const ora = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const apertura = park.opening || {};
  const lunven = (apertura.lunven || []).join(', ');
  const sab = (apertura.sab || []).join(', ');
  const fes = (apertura.fes || []).join(', ');

  const html = [];
  // Card container with full height and flex column
  html.push(`<div class="card h-100">`);
  html.push(`  <div class="card-body d-flex flex-column">`);
  // Contenuto testuale della card
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
    if (fes) {
      html.push(`<strong>festivi:</strong> ${fes}`);
    } else {
      html.push(`<strong>festivi:</strong> chiuso`);
    }
    html.push(`</p>`);
  }
  if (Array.isArray(park.rates) && park.rates.length > 0) {
    html.push(`<p class="card-text"><strong>Tariffe:</strong><br>`);
    park.rates.forEach(rate => {
      const from = rate.from || '';
      const to = rate.to || '';
      const cost = rate.cost !== undefined ? `€${rate.cost.toFixed(2)}` : '';
      const unit = rate.unit === 'hour' ? 'ora' : rate.unit || '';
  
      html.push(`${from}–${to}: ${cost}/${unit}<br>`);
    });
    html.push(`</p>`);
  }
  // Inizio sezione barra (allineata in fondo con mt-auto)
  html.push(`    <div class="bar-section mt-auto">`);
  //if (park.offline !== false) {
  //  html.push(`<div class="bar-label text-danger">parcheggio non disponibile</div>`);
  //} else {
    html.push(`<div class="bar-label" id="percent-${prefix}-${index}">${percentage}% di posti occupati</div>`);
  //}
  
  html.push(`      <div class="bar-container">` +
            `        <div class="bar-occupied" id="bar-occupied-${prefix}-${index}" style="width: 0%"></div>` +
            `        <div class="bar-free" id="bar-free-${prefix}-${index}" style="width: 0%"></div>` +
            `      </div>`);
  html.push(`<div class="bar-abs">
              <div class="bar-abs-left" id="abs-occupied-${prefix}-${index}">${occupied} occupati</div>
              <div class="bar-abs-right" id="abs-free-${prefix}-${index}">${free} liberi</div>
            </div>`);
  html.push(`    </div> <!-- /.bar-section -->`);
  // Chiusura card-body e card
  html.push(`  </div><!-- /.card-body -->`);
  html.push(`</div><!-- /.card -->`);

  return html.join('\n');
}

function formatAddress(address) {
  return address
    .toLowerCase()
    .split(' ')
    .map(word => {
      if (word.startsWith('via') || word.startsWith('piaz')) {
        return word.toLowerCase(); // via, piazza, piazzale ecc.
      } else {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
    })
    .join(' ');
}

function animateNumbers(park, index, prefix) {
  const capacity = park.capacity;
  const free = park.freeslots;
  const occupied = capacity - free;
  const percentage = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
  const freePercentage = 100 - percentage;

  const freeEl = document.getElementById(`free-${prefix}-${index}`);
  const occupiedEl = document.getElementById(`occupied-${prefix}-${index}`);
  const percentEl = document.getElementById(`percent-${prefix}-${index}`);

  
  // Barre
  const barOccupied = document.getElementById(`bar-occupied-${prefix}-${index}`);
  const barFree = document.getElementById(`bar-free-${prefix}-${index}`);
  if (barOccupied) barOccupied.style.width = `${percentage}%`;
  if (barFree) barFree.style.width = `${freePercentage}%`;

  // Assoluti sotto la barra
  const absOcc = document.getElementById(`abs-occupied-${prefix}-${index}`);
  const absFree = document.getElementById(`abs-free-${prefix}-${index}`);
  animateValue(absOcc, 0, occupied, 1000, ' occupati');
  animateValue(absFree, 0, free, 1000, ' liberi');
}

// Lazy loading streamgraph al momento della visibilità
let streamgraphLoaded = false;

function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.bottom >= 0
  );
}

function loadStreamgraph() {
  const chartDom = document.getElementById('streamgraphContainer');
  if (!chartDom || streamgraphLoaded) return;

  if (isInViewport(chartDom)) {
    streamgraphLoaded = true;
    const myChart = echarts.init(chartDom);

    fetch('data/streamgraph_parcheggi_park.json')
      .then(response => response.json())
      .then(rawData => {
        const dataMap = new Map();
        const allNames = new Set();

        rawData.forEach(([time, value, name]) => {
          if (!dataMap.has(time)) dataMap.set(time, {});
          dataMap.get(time)[name] = value;
          allNames.add(name);
        });

        const timestamps = Array.from(dataMap.keys()).sort();
        const names = Array.from(allNames);

        const series = names.map(name => ({
          name,
          type: 'line',
          stack: 'occupazione',
          areaStyle: { opacity: 0.8 },
          symbol: 'none',
          lineStyle: { width: 0 },
          itemStyle: { color: '#199eb8' },
          emphasis: { focus: 'series' },
          data: timestamps.map(t => dataMap.get(t)[name] || 0)
        }));

        const option = {
          title: {
            //text: 'Occupazione parcheggi nelle ultime 24 ore',
            //left: 'center'
          },
          tooltip: { trigger: 'axis' },
          legend: { top: 'bottom', data: names },
          xAxis: { type: 'category', 
                  boundaryGap: false, 
                  axisLabel: {
                    formatter: function (value) {
                      const date = new Date(value);
                      return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                    }
                  },
                  data: timestamps },
          yAxis: { type: 'value' },
          series
        };

        myChart.setOption(option);
      });
  }
}

window.addEventListener('scroll', loadStreamgraph);
window.addEventListener('DOMContentLoaded', loadStreamgraph);
