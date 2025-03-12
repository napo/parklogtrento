var dom = document.getElementById('data_parks');
var myChart = echarts.init(dom, null, {
  renderer: 'canvas',
  useDirtyRect: false
});

fetch('data/descriptions.json')
    .then(response => {
        if (!response.ok) throw new Error("Errore fetch");
        return response.json();
    })
    .then(data => {
        // Calcola la percentuale (free/totals)
        carparkspace_rate = 100- Math.round((data.total_carparkspaces_free / data.total_carparkspaces) * 100);
        zonespaces_rate = 100- Math.round((data.total_zonespaces_free / data.total_zonespaces) * 100);
        bikespaces_rate = 100 - Math.round((data.total_bikespaces_free / data.total_bikespaces) * 100);
        
        // Aggiorna dinamicamente i testi
        document.getElementById('extractiontime').textContent = data.timestamp_parks;

        document.querySelector('span#total_carparkspaces').textContent = data.total_carparkspaces;
        document.querySelector('#total_carparkspaces').classList.remove('spinner-border');

        document.querySelector('span#total_bikespaces').textContent = data.total_bikespaces;        
        document.querySelectorAll('span.total_parks').forEach(el => {
            el.textContent = data.total_parks;
        });
        document.querySelector('span#total_zonespaces').textContent = data.total_zonespaces;
        document.querySelector('span#total_zones').textContent = data.total_zones;
        document.querySelector('span#total_ciclobox').textContent = data.total_ciclobox;
        document.querySelector('span#carparkspaces_rate').textContent = carparkspace_rate + '%';
        document.querySelector('#carparkspaces_rate').classList.remove('spinner-border');

        document.querySelector('span#zonespaces_rate').textContent = zonespaces_rate + '%';
        document.querySelector('span#bikespaces_rate').textContent = bikespaces_rate + '%';
        document.querySelector('span#total_zonespaces_free').textContent = total_zonespaces_free + '%';
        // aggiorna i contatori
        document.getElementById('total_carparkspaces_free').setAttribute('data-purecounter-end', data.total_carparkspaces_free);
        document.getElementById('total_bikespaces_free').setAttribute('data-purecounter-end', data.total_bikespaces_free);
        document.getElementById('total_zonespaces_free').setAttribute('data-purecounter-end', data.total_zonespaces_free);

        // inizializza PureCounter dopo aver impostato i dati
        new PureCounter();
    })
    .catch(error => console.error('Errore:', error));

  // Caricare option da un file JSON esterno
  fetch('data/data_parks.json') // Assicurati che il file sia accessibile
    .then(response => response.json()) // Converti la risposta in JSON
    .then(data => {
      myChart.setOption(data); // Imposta l'option con i dati del JSON
    })
    .catch(error => console.error('Errore nel caricamento del JSON:', error));

  // Adatta il grafico al ridimensionamento della finestra
  window.addEventListener('resize', myChart.resize);
