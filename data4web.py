import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import os
import geopandas as gpd
import requests
import json
PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_GEOPARQUET = "data" + os.sep + "zones.geoparquet"
# Salvataggio dei file JSON
DEST = "docs" + os.sep + "weeklystats" + os.sep + "data" + os.sep
if not os.path.exists(DEST):
    os.makedirs(DEST)
WEEKDAY_ORDER = ["lunedì", "martedì", "mercoledì", 
                 "giovedì", "venerdì", "sabato", 
                 "domenica"]
parks = gpd.read_parquet(PARKS_GEOPARQUET)
zones = gpd.read_parquet(ZONES_GEOPARQUET)
def fill_data(df_originale, tolleranza_minuti=5, limit_fill=1, timezone="Europe/Rome"):
    df = df_originale.copy()
    df = df.drop(columns=[col for col in ['hour', 'minute'] if col in df.columns], errors='ignore')
    df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True).dt.tz_convert(timezone)
    df['occupied'] = df['capacity'] - df['freeslots']
    df['percent_occupied'] = df['occupied'] / df['capacity']
    df = df.set_index('timestamp')
    timestamps = df.index.unique()
    names = df['name'].unique()
    full_index = pd.MultiIndex.from_product([timestamps, names], names=["timestamp", "name"])
    full_df = pd.DataFrame(index=full_index).reset_index()
    df_reset = df.reset_index()
    merged = pd.merge(full_df, df_reset, on=['timestamp', 'name'], how='left')
    merged['timestamp'] = pd.to_datetime(merged['timestamp'])
    new_dfs = []
    for name in names:
        df_name = df_reset[df_reset['name'] == name].sort_values('timestamp')
        target = merged[merged['name'] == name].sort_values('timestamp')
        merged_asof = pd.merge_asof(
            target,
            df_name,
            on='timestamp',
            direction='nearest',
            tolerance=pd.Timedelta(minutes=tolleranza_minuti),
            suffixes=('', '_filled')
        )
        for col in ['capacity', 'freeslots', 'occupied', 'percent_occupied']:
            if not merged_asof[f"{col}_filled"].isna().all() or not merged_asof[col].isna().all():
                merged_asof[col] = merged_asof[f"{col}_filled"].combine_first(merged_asof[col])

        merged_asof = merged_asof[['timestamp', 'name', 'capacity', 'freeslots', 'occupied', 'percent_occupied']]
        new_dfs.append(merged_asof)
    df_filled = pd.concat(new_dfs)
    df_filled = df_filled.set_index(['timestamp', 'name']).sort_index()
    df_filled = df_filled.groupby(['timestamp', 'name']).mean()
    to_fill = df_filled[['capacity', 'freeslots', 'occupied', 'percent_occupied']]
    filled = (
        to_fill
        .groupby('name', group_keys=False)
        .apply(lambda g: g.ffill(limit=limit_fill).bfill(limit=limit_fill))
    )

    df_filled[['capacity', 'freeslots', 'occupied', 'percent_occupied']] = filled
    df_filled['capacity'] = df_filled['capacity'].round().astype('Int64')
    df_filled['freeslots'] = df_filled['freeslots'].round().astype('Int64')
    df_filled['occupied'] = df_filled['occupied'].round().astype('Int64')
    df_filled['percent_occupied'] = df_filled['percent_occupied'].round(4)

    return df_filled
def weeklystats_name(df_parks):
    df = df_parks.copy()
    df = df.reset_index()
    df['weekday'] = df['timestamp'].dt.day_name()
    mappa_giorni = {
        'Monday': 'lunedì',
        'Tuesday': 'martedì',
        'Wednesday': 'mercoledì',
        'Thursday': 'giovedì',
        'Friday': 'venerdì',
        'Saturday': 'sabato',
        'Sunday': 'domenica'
    }
    df['weekday'] = df['weekday'].map(mappa_giorni)
    df['hour'] = df['timestamp'].dt.hour
    df_grouped = df.groupby(['name', 'weekday', 'hour']).agg(
        mean_occupied=('occupied', 'mean'),
        min_occupied=('occupied', 'min'),
        max_occupied=('occupied', 'max'),
        mean_percent_occupied=('percent_occupied', 'mean')
    ).reset_index()
    df_grouped['mean_occupied'] = df_grouped['mean_occupied'].fillna(0).round(1)
    df_grouped['min_occupied'] = df_grouped['min_occupied'].fillna(0).astype(int)
    df_grouped['max_occupied'] = df_grouped['max_occupied'].fillna(0).astype(int)
    df_grouped['mean_percent_occupied'] = df_grouped['mean_percent_occupied'].fillna(0).mul(100).round(1)

    giorni_ordine = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
    df_grouped['weekday'] = pd.Categorical(df_grouped['weekday'], categories=giorni_ordine, ordered=True)

    df_grouped = df_grouped.sort_values(['name', 'weekday', 'hour'])

    return df_grouped
def timestamp_aggregation(df_parks,newname="Totale"):
    df = df_parks.reset_index()

    # Aggregazione per timestamp
    df_aggregato = df.groupby('timestamp').agg({
        'capacity': 'sum',
        'freeslots': 'sum',
        'occupied': 'sum'
    }).reset_index()

    # Ricalcolo della percentuale di occupazione
    df_aggregato['percent_occupied'] = (df_aggregato['occupied'] / df_aggregato['capacity']).round(4)

    # Aggiungiamo una colonna name="Totale"
    df_aggregato['name'] = newname

    # Reimpostiamo l'indice
    df_aggregato = df_aggregato.set_index(['timestamp', 'name'])

    return df_aggregato
# Funzione per ottenere start/end in ISO
def get_timestamp_range(df, time_col):
    return {
        "start": df[time_col].min().isoformat(),
        "end": df[time_col].max().isoformat()
    }
def generateJson(dfstats, filename,titolo=None):
    weekday_translation = {
        'lunedì': 'Monday',
        'martedì': 'Tuesday',
        'mercoledì': 'Wednesday',
        'giovedì': 'Thursday',
        'venerdì': 'Friday',
        'sabato': 'Saturday',
        'domenica': 'Sunday'
    }

    if titolo is None:
        result_json = {}
        for name in dfstats['name'].unique():
            result_json[name] = {}
            subset_name = dfstats[dfstats['name'] == name]
            for weekday_it, weekday_en in weekday_translation.items():
                subset_weekday = subset_name[subset_name['weekday'] == weekday_it].sort_values('hour')
                entries = []
                for _, row in subset_weekday.iterrows():
                    entry = {
                        "media": round(row["mean_occupied"], 2) if pd.notna(row["mean_occupied"]) else 0,
                        "min": int(row["min_occupied"]),
                        "max": int(row["max_occupied"]),
                        "percentuale_media": round(row["mean_percent_occupied"], 2)
                    }
                    entries.append(entry)
                if entries:
                    result_json[name][weekday_en] = entries
    else:
        result_json = {titolo: {}}
        for weekday_it, weekday_en in weekday_translation.items():
            subset = dfstats[dfstats['weekday'] == weekday_it].sort_values('hour')
            entries = []
            for _, row in subset.iterrows():
                entry = {
                    "media": round(row["mean_occupied"], 2),
                    "min": int(row["min_occupied"]),
                    "max": int(row["max_occupied"]),
                    "percentuale_media": round(row["mean_percent_occupied"], 2)
                }
                entries.append(entry)
            if entries:
                result_json[titolo][weekday_en] = entries
    with open(DEST + filename, "w") as f:
        json.dump(result_json, f, indent=2, ensure_ascii=False)
        
parks_park = parks[parks['type'] == 'park']
parks_park = parks_park[['timestamp', 'name', 'capacity', 'freeslots']]
parks_park_filled = fill_data(parks_park)
generateJson(weeklystats_name(parks_park_filled), "occupazione_park.json")
parks_park_filled_total = timestamp_aggregation(parks_park_filled)
parks_park_filled_stats_total = weeklystats_name(parks_park_filled_total)
generateJson(parks_park_filled_stats_total, "occupazione_park_totale.json","Totale parcheggi in struttura")
range_park = get_timestamp_range(parks_park, "timestamp")
with open(DEST + "timestamp_park_totale.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)
with open(DEST + "timestamp_park.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)
    
parks_bike = parks[parks['type'] == 'bike']
parks_bike = parks_bike[['timestamp', 'name', 'capacity', 'freeslots']]
#parks_park.to_csv("/tmp/parks_park.csv",index=False)
parks_bike_filled = fill_data(parks_bike)
generateJson(weeklystats_name(parks_bike_filled), "occupazione_bike.json")
parks_bike_filled_total = timestamp_aggregation(parks_bike_filled)
parks_bike_filled_stats_total = weeklystats_name(parks_bike_filled_total)
generateJson(parks_bike_filled_stats_total, "occupazione_bike_totale.json","Totale ciclobox")
range_park = get_timestamp_range(parks_bike, "timestamp")
with open(DEST + "timestamp_bike_totale.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)
with open(DEST + "timestamp_bike.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)

zones_blu = zones[['ts', 'name', 'stall_blu_capacity', 'stall_blu_freeslots']].copy()
zones_blu.rename(columns={'ts': 'timestamp','stall_blu_capacity': 'capacity', 'stall_blu_freeslots': 'freeslots'}, inplace=True)
max_capacity_per_name = zones_blu.groupby('name')['capacity'].max()
zones_blu['capacity'] = zones_blu['name'].map(max_capacity_per_name)
zones_blu_filled = fill_data(zones_blu)
generateJson(weeklystats_name(zones_blu_filled), "occupazione_zones.json")
zones_blu_filled_total = timestamp_aggregation(zones_blu_filled)
zones_blu_filled_stats_total = weeklystats_name(zones_blu_filled_total)
generateJson(zones_blu_filled_stats_total, "occupazione_zones_totale.json","Totale stalli blu")
range_park = get_timestamp_range(zones_blu, "timestamp")
with open(DEST + "timestamp_zones_totale.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)
with open(DEST + "timestamp_zone.json", "w") as f:
    json.dump(range_park, f, indent=2, ensure_ascii=False)
max_capacity_per_park = parks_park.groupby("name")["capacity"].max().reset_index()
parks_max_capacity = max_capacity_per_park.set_index("name")["capacity"].to_dict()
max_capacity_per_bike = parks_bike.groupby("name")["capacity"].max().reset_index()
bikes_max_capacity = max_capacity_per_bike.set_index("name")["capacity"].to_dict()
max_capacity_per_zones = zones_blu.groupby("name")["capacity"].max().reset_index()
zones_max_capacity = max_capacity_per_zones.set_index("name")["capacity"].to_dict()
with open(DEST + "max_capacity_zone.json", "w") as json_file:
    json.dump(zones_max_capacity, json_file, indent=2, ensure_ascii=False)
with open(DEST + "max_capacity_park.json", "w") as json_file:
    json.dump(parks_max_capacity, json_file, indent=2, ensure_ascii=False)
with open(DEST + "max_capacity_bike.json", "w") as json_file:
    json.dump(bikes_max_capacity, json_file, indent=2, ensure_ascii=False)