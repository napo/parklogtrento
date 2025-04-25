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
