import numpy as np
import pandas as pd
import os
import json
import pytz
import geopandas as gpd
from datetime import datetime, timedelta
PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_GEOPARQUET = "data" + os.sep + "zones.geoparquet"
parks = gpd.read_parquet(PARKS_GEOPARQUET)
zones = gpd.read_parquet(ZONES_GEOPARQUET)
df = parks
df["currentTimestamp"] = pd.to_datetime(df["currentTimestamp"], errors="coerce")
# Filtra solo 'park' nelle ultime 24 ore rispetto al timestamp massimo
max_ts = df["currentTimestamp"].max()
min_ts = max_ts - pd.Timedelta(hours=24)
df_filtered = df[(df["type"] == "park") & (df["currentTimestamp"] >= min_ts) & (df["currentTimestamp"] <= max_ts)].copy()
# Arrotonda ai 5 minuti
df_filtered["timestamp_5min"] = df_filtered["currentTimestamp"].dt.floor("5min")
# Calcola l'occupazione
df_filtered["occupazione"] = df_filtered["capacity"] - df_filtered["freeslots"]
# Raggruppa per timestamp e nome del parcheggio (media per fascia)
df_grouped = df_filtered.groupby(["timestamp_5min", "name"])["occupazione"].mean().reset_index()
# Converte in formato ECharts: ["timestamp", valore, "nome"]
df_grouped["timestamp_5min"] = df_grouped["timestamp_5min"].dt.strftime("%Y-%m-%d %H:%M:%S")
echarts_data = df_grouped[["timestamp_5min", "occupazione", "name"]].values.tolist()
# Esporta in JSON
with open("docs"+os.sep +"data" + os.sep + "streamgraph_parcheggi_park.json", "w", encoding="utf-8") as f:
    json.dump(echarts_data, f, ensure_ascii=False)
