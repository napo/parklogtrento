const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const target = entry.target;
            target.classList.add("chart-visible");
            obs.unobserve(target);
            if (target.dataset.render && typeof window[target.dataset.render] === 'function') {
                window[target.dataset.render](target);
            }
        }
    });
}, {
    rootMargin: '0px 0px -10% 0px',
    threshold: 0.1
});

function createChartTotal(pathJson, idSezione) {
    fetch(pathJson.replace('occupazione_', 'timestamp_'))
        .then(res => res.json())
        .then(range => {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const inizio = new Date(range.start);
            const fine = new Date(range.end);
            document.getElementById("range-" + idSezione).textContent =
                `da ${inizio.toLocaleDateString('it-IT', options)} a ${fine.toLocaleDateString('it-IT', options)}`;
        });

    Promise.all([
        fetch(pathJson).then(res => res.json()),
        fetch(`data\\max_capacity_${idSezione}.json`).then(res => res.json())
    ]).then(([data, capacitaData]) => {
        const giorni = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const giorniLabel = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
        const ore = Array.from({ length: 24 }, (_, i) => i);
        let idx = 0;
        const [nome, dati] = Object.entries(data)[0];
        divTotale = document.getElementById("totale_" + idSezione);
        divTotale.dataset.render = "totale_" + idSezione;
        const maxCapienzaTotale = Object.values(capacitaData).reduce((somma, posti) => somma + posti, 0) || "-";
        document.getElementById(idSezione + "-totali").textContent = maxCapienzaTotale;
        window["totale_" + idSezione] = (el) => {
            const chart = echarts.init(el);
            const series = giorni.map((giorno, i) => {
                const values = dati[giorno];
                return {
                    name: giorniLabel[i],
                    type: 'line',
                    data: values.map(v => v.media),
                    showSymbol: false,
                    lineStyle: { width: 2 }
                };
            });

            chart.setOption({
                backgroundColor: '#ffffff',
                tooltip: {
                    trigger: 'axis',
                    formatter: function (params) {
                        const rows = params.map(p => {
                            const giorno = p.seriesName;
                            const index = giorniLabel.indexOf(giorno);
                            const hour = p.dataIndex;
                            const info = dati[giorni[index]][hour];
                            const abbrevGiorno = giorno.substring(0, 3);
                            return `<tr>
                                        <td>${abbrevGiorno}</td>
                                        <td>${hour}</td>
                                        <td>${info.media}</td>
                                        <td>${info.min}</td>
                                        <td>${info.max}</td>
                                        <td>${info.percentuale_media.toFixed(1)}%</td>
                                    </tr>`;
                        }).join('');
                        
                        return `
                            <table class="table table-sm table-bordered table-striped mb-0">
                                <thead class="thead-light">
                                    <tr>
                                        <th>Giorno</th>
                                        <th>Ora</th>
                                        <th>Media</th>
                                        <th>Min</th>
                                        <th>Max</th>
                                        <th>%Media</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>`;
                    }                    
                },
                legend: { bottom: 0 },
                xAxis: { type: 'category', data: ore, name: "Ora" },
                yAxis: { type: 'value', name: 'Posti occupati' },
                series: series,
                grid: { bottom: 80 }
            });
        };

        observer.observe(divTotale);
        idx++;
    });
}

function createChartIndividuals(pathJson, idSezione) {
    Promise.all([
        fetch(pathJson).then(res => res.json()),
        fetch(`data\\max_capacity_${idSezione}.json`).then(res => res.json())
    ]).then(([data, capacitaData]) => {
        const giorni = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        const giorniLabel = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
        const ore = Array.from({ length: 24 }, (_, i) => i);
        let idx = 0;

        row = document.getElementById("singoli_" + idSezione)

        Object.entries(data).slice(1).forEach(([nome, serieDati]) => {
            const col = document.createElement("div");
            col.classList.add("col-md-6", "mb-5");
            row.appendChild(col);

            const div = document.createElement("div");
            div.classList.add("chart-observer");
            div.style.height = "400px";
            div.id = `${idSezione}-chart-${idx}`;
            div.dataset.render = `renderChart_${idSezione}_${idx}`;

            const titolo = document.createElement("h5");
            titolo.innerText = nome;
            col.appendChild(titolo);

            const sottotitolo = document.createElement("p");
            const maxCapienza = capacitaData[nome] || '-';
            sottotitolo.innerHTML = `<em>Capienza massima: ${maxCapienza}</em>`;
            col.appendChild(sottotitolo);
            col.appendChild(div);

            window[`renderChart_${idSezione}_${idx}`] = (el) => {
                const chart = echarts.init(el);
                const series = giorni.map((giorno, i) => {
                    const values = serieDati[giorno];
                    return {
                        name: giorniLabel[i],
                        type: 'line',
                        data: values.map(v => v.media),
                        showSymbol: false,
                        lineStyle: { width: 2 }
                    };
                });

                chart.setOption({
                    backgroundColor: '#ffffff',
                    tooltip: {
                        trigger: 'axis',
                        formatter: function (params) {
                            const rows = params.map(p => {
                                const giorno = p.seriesName;
                                const index = giorniLabel.indexOf(giorno);
                                const hour = p.dataIndex;
                                const info = serieDati[giorni[index]][hour];
                                const abbrevGiorno = giorno.substring(0, 3);
                                return `<tr>
                                            <td>${abbrevGiorno}</td>
                                            <td>${hour}</td>
                                            <td>${info.media}</td>
                                            <td>${info.min}</td>
                                            <td>${info.max}</td>
                                            <td>${info.percentuale_media.toFixed(1)}%</td>
                                        </tr>`;
                            }).join('');

                            return `
                                <table class="table table-sm table-bordered table-striped mb-0">
                                    <thead class="thead-light">
                                        <tr>
                                            <th>giorno</th>
                                            <th>ora</th>
                                            <th>media</th>
                                            <th>min</th>
                                            <th>max</th>
                                            <th>media %</th>
                                        </tr>
                                    </thead>
                                    <tbody>${rows}</tbody>
                                </table>`;
                        }
                    },
                    legend: { bottom: 0 },
                    xAxis: { type: 'category', data: ore, name: "Ora" },
                    yAxis: { type: 'value', name: 'posti occupati' },
                    series: series,
                    grid: { bottom: 80 }
                });
            };

            observer.observe(div);
            idx++;
        });
    });
}


createChartTotal("data/occupazione_park_totale.json", "park");
createChartIndividuals("data/occupazione_park.json", "park");
createChartTotal("data/occupazione_zones_totale.json", "zone");
createChartIndividuals("data/occupazione_zones.json", "zone");
createChartTotal("data/occupazione_bike_totale.json", "bike");
createChartIndividuals("data/occupazione_bike.json", "bike");

function resizeAllCharts() {
    ['totale_park', 'totale_zone', 'totale_bike'].forEach(id => {
      echarts.getInstanceByDom(document.getElementById(id))?.resize();
    });
    document.querySelectorAll('#singoli_park > div, #singoli_zone > div, #singoli_bike > div').forEach(div => {
      echarts.getInstanceByDom(div)?.resize();
    });
  }
  
  window.addEventListener('resize', resizeAllCharts);