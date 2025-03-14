// Calcola la percentuale (free/totals)
carparkspace_rate = 100- Math.round((total_carparkspaces_free / total_carparkspaces) * 100);
zonespaces_rate = 100- Math.round((total_zonespaces_free / total_zonespaces) * 100);
bikespaces_rate = 100 - Math.round((total_bikeparkspaces_free / total_bikeparkspaces) * 100);

// Aggiorna dinamicamente i testi
document.querySelectorAll('span.extractiontime').forEach(el => {
  el.textContent = lastime_parks;
});
document.querySelector('span#total_carparkspaces').textContent = total_carparkspaces;
document.querySelector('span#total_bikespaces').textContent = total_bikeparkspaces;        
document.querySelectorAll('span.total_parks').forEach(el => {
    el.textContent = total_parks;
});
document.querySelector('span#total_zonespaces').textContent = total_zonespaces;
document.querySelector('span#total_zones').textContent = total_zones;
document.querySelector('span#total_ciclobox').textContent = total_ciclobox;
document.querySelector('span#carparkspaces_rate').textContent = carparkspace_rate + '%';

document.querySelector('span#zonespaces_rate').textContent = zonespaces_rate + '%';
document.querySelector('span#bikespaces_rate').textContent = bikespaces_rate + '%';
document.querySelector('span#total_zonespaces_free').textContent = total_zonespaces_free + '%';
// aggiorna i contatori
document.getElementById('total_carparkspaces_free').setAttribute('data-purecounter-end', total_carparkspaces_free);
document.getElementById('total_bikespaces_free').setAttribute('data-purecounter-end', total_bikeparkspaces_free);
document.getElementById('total_zonespaces_free').setAttribute('data-purecounter-end', total_zonespaces_free);

// inizializza PureCounter dopo aver impostato i dati
new PureCounter();

// Calcolo dei valori percentuali
const total_structures_sum = total_structures_occupied.map((val, index) => val + total_structures_free[index]);
const occupied_structures_percent = total_structures_occupied.map((val, index) => Math.round((val / total_structures_sum[index]) * 100));
const free_structures_percent = total_structures_free.map((val, index) => Math.round((val / total_structures_sum[index]) * 100));

const optionstackedbarchart = {
  title: {
    text: 'Distribuzione strutture al ' + lastime_parks, 
    left: 'center', 
    top: 'top'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'line' 
    },
    formatter: function (params) {
      let tooltipText = `${params[0].name} <br/>`;
      params.forEach(param => {
        const absoluteValue = param.seriesName === 'occupati' 
          ? total_structures_occupied[param.dataIndex] 
          : total_structures_free[param.dataIndex];
        tooltipText += `${param.marker} ${param.seriesName}: ${absoluteValue} (${param.value.toFixed(1)}%)<br/>`;
      });
      return tooltipText;
    }
  },
  legend: {
    bottom: 0,
    left: 'center' 
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '20%',
    containLabel: true
  },
  xAxis: {
    type: 'value',
    max: 100, // Poiché ora i dati sono percentuali
    axisLabel: {
      formatter: '{value}%' 
    }
  },
  yAxis: {
    type: 'category',
    data: structures_names,
  },
  series: [
    {
      name: 'occupati',
      type: 'bar',
      stack: 'total',
      label: {
        show: true,
        formatter: '{c}%' 
      },
      emphasis: {
        focus: 'series'
      },
      itemStyle: {
        color: '#58D9F9' 
      },
      data: occupied_structures_percent
    },
    {
      name: 'liberi',
      type: 'bar',
      stack: 'total',
      label: {
        show: true,
        formatter: '{c}%'
      },
      emphasis: {
        focus: 'series'
      },
      itemStyle: {
        color: '#50737a' 
      },
      data: free_structures_percent
    }
  ]
};

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
        color: '#58D9F9'
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
          value: percentage_structures_busy
        }
      ]
    }
  ]
};

// Funzione per generare una gradazione di colori scuri partendo da un colore base
function generateGradientColors(baseColor, numSteps) {
  const colors = [];
  let [r, g, b] = [
      parseInt(baseColor.substring(1, 3), 16),
      parseInt(baseColor.substring(3, 5), 16),
      parseInt(baseColor.substring(5, 7), 16)
  ];

  for (let i = 0; i < numSteps; i++) {
      // Rende il colore più scuro diminuendo la luminosità
      r = Math.max(0, r - 15);
      g = Math.max(0, g - 15);
      b = Math.max(0, b - 15);
      colors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
  }

  return colors;
}

// Genera una palette di colori scuri partendo da #199eb8
const colors = generateGradientColors("#199eb8", 10);

// Organizza i dati per il grafico a barre impilate
const seriesData = {};
const categories = new Set();

riverdatastrutture.forEach(([time, value, structure]) => {
// Estrai solo HH:MM
const dateObj = new Date(time);
const formattedTime = dateObj.toLocaleTimeString('it-IT', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

if (!seriesData[structure]) {
  seriesData[structure] = [];
}
seriesData[structure].push([formattedTime, value]);
categories.add(formattedTime);
});

// Mantiene tutti i dati, ma filtra le etichette da mostrare solo per le ore e le mezz'ore
const allCategories = Array.from(categories);
const labelFormatter = (value) => {
const minutes = parseInt(value.split(':')[1], 10);
return (minutes === 0 || minutes === 30) ? value : '';
};

// Converte i dati in un formato compatibile con ECharts
const series = Object.keys(seriesData).map((name, index) => ({
  name,
  type: 'line',
  stack: 'occupied',
  areaStyle: {},
  symbol: 'none',
  color: colors[index % colors.length], // Assegna un colore scuro progressivo a ogni parcheggio
  emphasis: {
    focus: 'series'
  },
  data: allCategories.map(time => {
    const entry = seriesData[name].find(d => d[0] === time);
    return entry ? entry[1] : 0;
    })
  }));

// Configurazione del grafico a barre impilate
optionriverstrutture = {
  title: {
    text: 'Veicoli parcheggiati ultime 24h',
    left: 'center'
  },
  dataZoom: [{
    type: 'inside',
    start: 0,
    end: 100
  },{
    start: 0,
    end: 100
  }],
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  legend: {
    data: Object.keys(seriesData),
    bottom: '15%', // Posiziona la legenda in basso senza sovrapposizione
    itemGap: 10,  // Distanza tra gli elementi della legenda
    textStyle: {
    fontSize: 12
  }
  },
  grid: {
    left: '10%',
    right: '10%',
    bottom: '35%' // Aggiunge spazio per evitare sovrapposizione della legenda con l'asse X
  },
  xAxis: {
    type: 'category',
    data: allCategories,
    axisLabel: {
      formatter: labelFormatter, // Mostra solo le etichette delle ore e delle mezz'ore
      rotate: 45 // Ruota le etichette per maggiore leggibilità
   }
  },
  yAxis: {
    type: 'value'
  },
    series
  };


document.addEventListener("DOMContentLoaded", function () {
  const sections = document.querySelectorAll(".echart");

  const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
          if (entry.isIntersecting) {
              loadChart(entry.target);
              observer.unobserve(entry.target); // Una volta caricato, non osservarlo più
          }
      });
  }, { threshold: 0.3 });

  sections.forEach(section => observer.observe(section));

  function loadChart(element) {
      const chartId = element.id;
      if (!chartId) return;

      let option;
      if (chartId === "stackedbarchartparcheggi") {
          option = optionstackedbarchart; // Usa l'opzione del grafico a barre impilate
      } else if (chartId === "riverstrutture") {
          option = optionriverstrutture; // Sostituiscilo con l'opzione del tuo terzo grafico
      } else if (chartId == 'gauge_structures') {
          option = optiongauge_structures
      }

      if (option) {
          const chart = echarts.init(element);
          chart.setOption(option);
      }
  }
});
