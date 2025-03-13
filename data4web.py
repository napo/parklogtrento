import numpy as np
import pandas as pd
import os
import json
import pytz
import geopandas as gpd
PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_GEOPARQUET = "data" + os.sep + "zones.geoparquet"

parks = gpd.read_parquet(PARKS_GEOPARQUET)
zones = gpd.read_parquet(ZONES_GEOPARQUET)

def month2mese(s):
    return s.replace('January','Gennaio').replace('February','Febbraio').replace('March','Marzo').replace('April','Aprile').replace('May','Maggio').replace('June','Giugno').replace('July','Luglio').replace('August','Agosto').replace('September','Settembre').replace('October','Ottobre').replace('November','Novembre').replace('December','Dicembre')  

timestamp_parks = parks.currentTimestamp.max()
timestamp_parks_to_print = parks.currentTimestamp.max()
if timestamp_parks_to_print.tzinfo is None:
    timestamp_parks_to_print = timestamp_parks_to_print.tz_localize('UTC')  
rome_tz = pytz.timezone('Europe/Rome')
timestamp_parks_to_print = timestamp_parks_to_print.astimezone(rome_tz)
lastime_parks_to_print = timestamp_parks_to_print.strftime('%d %B %Y ore %H:%M')
lastime_parks_to_print = month2mese(lastime_parks_to_print)
timestamp_zones = zones.ts.max()
total_carparkspaces = parks[(parks['type'] == 'park') & (parks.currentTimestamp == timestamp_parks)].capacity.sum()
total_carparkspaces_free = parks[(parks['type'] == 'park') & (parks.currentTimestamp == timestamp_parks)].freeslots.sum()
total_bikeparkspaces = parks[(parks['type'] == 'bike') & (parks.currentTimestamp == timestamp_parks)].capacity.sum()
total_bikeparkspaces_free = parks[(parks['type'] == 'bike') & (parks.currentTimestamp == timestamp_parks)].freeslots.sum()
to_int = ['stall_blu_capacity','stall_blu_freeslots',
          'stall_carico-scarico_capacity','stall_carico-scarico_freeslots',
          'stall_disabili_capacity','stall_disabili_freeslots']
zones[to_int] = zones[to_int].astype(int)
total_zonespaces = zones[zones.ts == timestamp_zones].capacity.sum()
total_zonespaces_free = zones[zones.ts == timestamp_zones].freeslots.sum()
total_zonespaces_blu = zones[zones.ts == timestamp_zones].stall_blu_capacity.sum()
total_zonespaces_blu_free = zones[zones.ts == timestamp_zones].stall_blu_freeslots.sum()
total_zonespaces_carico_scarico = zones[zones.ts == timestamp_zones]['stall_carico-scarico_capacity'].sum()
total_zonespaces_carico_scarico_free = zones[zones.ts == timestamp_zones]['stall_carico-scarico_freeslots'].sum()
total_zonespaces_disabili = zones[zones.ts == timestamp_zones].stall_disabili_capacity.sum()
total_zonespaces_disabili_free = zones[zones.ts == timestamp_zones].stall_disabili_freeslots.sum()
total_parks = len(parks[parks['type'] == 'park'].name.unique())
total_ciclobox = len(parks[parks['type'] == 'bike'].name.unique())
total_zones = len(zones.name.unique())

# Variabili con i nomi delle strutture e i valori
structures_names = list(parks[(parks['type'] == 'park')].name.unique())

carparkspaces_pro_structures_capacity = list(parks[(parks['type'] == 'park') & (parks.currentTimestamp == timestamp_parks)].capacity)
carparkspaces_pro_structures_free = list(parks[(parks['type'] == 'park') & (parks.currentTimestamp == timestamp_parks)].freeslots)
carparkspaces_pro_structures_busy = [c - f for c, f in zip(carparkspaces_pro_structures_capacity, carparkspaces_pro_structures_free)]

percentage_structures_busy = round((sum(carparkspaces_pro_structures_busy) / sum(carparkspaces_pro_structures_capacity))*100)
filtered_parks = parks[(parks['type'] == 'park')][['name','freeslots','capacity','currentTimestamp']]

# Filtra i dati per le ultime 3 ore
end_time = timestamp_parks
start_time = end_time - pd.Timedelta(hours=24)
filtered_parks3h = filtered_parks[(filtered_parks['currentTimestamp'] >= start_time) & (filtered_parks['currentTimestamp'] <= end_time)]
# Imposta 'currentTimestamp' come indice
filtered_parks3h.set_index('currentTimestamp', inplace=True)
# Resample ogni 15 minuti e calcola la media per ciascun 'name'
resampled_parks3h = filtered_parks3h.groupby('name').resample('5T').mean().reset_index()
resampled_parks3h[['freeslots', 'capacity']] = resampled_parks3h.groupby('name')[['freeslots', 'capacity']].fillna(method='ffill')
resampled_parks3h[['freeslots', 'capacity']] = resampled_parks3h[['freeslots', 'capacity']].astype(int)
#resampled_parks3h['timestamp'] = resampled_parks3h['currentTimestamp'].dt.tz_localize('UTC').dt.tz_convert('Europe/Rome')

#resampled_parks3h['timestamp'] = resampled_parks3h['currentTimestamp'].dt.tz_localize('UTC').dt.tz_convert('Europe/Rome')
resampled_parks3h['diffhour'] = resampled_parks3h['currentTimestamp'].apply(lambda x: (x.tz_localize('UTC').astimezone(rome_tz).utcoffset().total_seconds() / 3600))
resampled_parks3h['timestamp'] = resampled_parks3h['currentTimestamp'] + pd.to_timedelta(resampled_parks3h['diffhour'], unit='h')
resampled_parks3h['timestamp'] = resampled_parks3h['timestamp'].dt.strftime('%Y-%m-%d %H:%M')
del resampled_parks3h['currentTimestamp']
del resampled_parks3h['diffhour']
resampled_parks3h['occupied'] = resampled_parks3h['capacity'] - resampled_parks3h['freeslots']
# Creare la stringa JavaScript
js_data = "var riverdatastrutture = [\n"

for _, row in resampled_parks3h.iterrows():
    #js_data += f"  {{ name: '{row['name']}', freeslots: {row['freeslots']}, capacity: {row['capacity']}, time: '{row['timestamp']}' }},\n"
    js_data += f"  ['{row['timestamp']}', {row['occupied']}, '{row['name']}'],\n"
js_data += "];"

filename = "docs" + os.sep + "data" + os.sep + "data.js"

# Creazione del contenuto
content = f"""
const lastime_parks="{lastime_parks_to_print}";
const total_carparkspaces={total_carparkspaces};
const total_carparkspaces_free={total_carparkspaces_free};
const total_bikeparkspaces={total_bikeparkspaces};
const total_bikeparkspaces_free={total_bikeparkspaces_free};
const total_zonespaces={total_zonespaces};
const total_zonespaces_free={total_zonespaces_free};
const total_zonespaces_blu={total_zonespaces_blu};
const total_zonespaces_blu_free={total_zonespaces_blu_free};
const total_zonespaces_carico_scarico={total_zonespaces_carico_scarico};
const total_zonespaces_carico_scarico_free={total_zonespaces_carico_scarico_free};
const total_zonespaces_disabili={total_zonespaces_disabili};
const total_zonespaces_disabili_free={total_zonespaces_disabili_free};
const total_parks={total_parks};
const total_ciclobox={total_ciclobox};
const total_zones={total_zones};
const structures_names={structures_names};
const total_structures_occupied={carparkspaces_pro_structures_busy};
const total_structures_free={carparkspaces_pro_structures_free};
const percentage_structures_busy={percentage_structures_busy};
\n{js_data}
"""

with open(filename, "w") as file:
    file.write(content.strip())

print(f"File '{filename}' generated")

