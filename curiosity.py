import pandas as pd
import numpy as np
import os
import geopandas as gpd
import json
from datetime import datetime
PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_GEOPARQUET = "data" + os.sep + "zones.geoparquet"
# Salvataggio dei file JSON
DEST = "docs" + os.sep + "curiosity" + os.sep + "data" + os.sep
if not os.path.exists(DEST):
    os.makedirs(DEST)
HOLIDAYS = [
    (1, 1),   # Capodanno
    (1, 6),   # Epifania
    (4, 25),  # Festa della Liberazione
    (5, 1),   # Festa dei Lavoratori
    (6, 2),   # Festa della Repubblica
    (6,26),  # San Vigilio
    (8, 15),  # Ferragosto
    (11, 1),  # Ognissanti
    (12, 8),  # Immacolata Concezione
    (12, 25), # Natale
    (12, 26)  # Santo Stefano
]
# Funzione per calcolare le date mobili (Pasqua e Lunedì dell'Angelo)
def calculate_easter(year):
    """Calcolo della data di Pasqua (algoritmo di Oudin 1940)"""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return datetime(year, month, day).date()

def get_holiday_dates(year):
    dates = [datetime(year, month, day).date() for month, day in HOLIDAYS]
    easter = calculate_easter(year)
    easter_monday = easter.replace(day=easter.day + 1)
    dates.append(easter)
    dates.append(easter_monday)
    return dates
def save_json(data, filename):
    path = os.path.join(DEST, filename)
    with open(path, 'w') as f:
        f.write(data)
parks = gpd.read_parquet(PARKS_GEOPARQUET)
zones = gpd.read_parquet(ZONES_GEOPARQUET)
def fill_data(df_originale, tolleranza_minuti=5, limit_fill=1, timezone="Europe/Rome"):
    # Copia iniziale
    df = df_originale.copy()
    df = df.drop(columns=[col for col in ['hour', 'minute'] if col in df.columns], errors='ignore')

    # Parsing timestamp e localizzazione timezone
    df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True).dt.tz_convert(timezone)

    # Calcolo colonne
    df['occupied'] = df['capacity'] - df['freeslots']
    df['percent_occupied'] = df['occupied'] / df['capacity']

    # Impostiamo l'indice
    df = df.set_index('timestamp')

    # Tutti i timestamp unici
    timestamps = df.index.unique()
    names = df['name'].unique()

    # Costruzione combinazioni timestamp x name
    full_index = pd.MultiIndex.from_product([timestamps, names], names=["timestamp", "name"])
    full_df = pd.DataFrame(index=full_index).reset_index()

    # Merge iniziale
    df_reset = df.reset_index()
    merged = pd.merge(full_df, df_reset, on=['timestamp', 'name'], how='left')

    # Riempimento ±tolleranza_minuti per ogni name
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

        #for col in ['capacity', 'freeslots', 'occupied', 'percent_occupied']:
        #    merged_asof[col] = merged_asof[f"{col}_filled"].combine_first(merged_asof[col])
        for col in ['capacity', 'freeslots', 'occupied', 'percent_occupied']:
            if not merged_asof[f"{col}_filled"].isna().all() or not merged_asof[col].isna().all():
                merged_asof[col] = merged_asof[f"{col}_filled"].combine_first(merged_asof[col])

        merged_asof = merged_asof[['timestamp', 'name', 'capacity', 'freeslots', 'occupied', 'percent_occupied']]
        new_dfs.append(merged_asof)
    df_filled = pd.concat(new_dfs)
    df_filled = df_filled.set_index(['timestamp', 'name']).sort_index()

    # Gestione duplicati: facciamo la media
    df_filled = df_filled.groupby(['timestamp', 'name']).mean()

    # Forward fill e backward fill limitato
    to_fill = df_filled[['capacity', 'freeslots', 'occupied', 'percent_occupied']]
    filled = (
        to_fill
        .groupby('name', group_keys=False)
        .apply(lambda g: g.ffill(limit=limit_fill).bfill(limit=limit_fill))
    )

    df_filled[['capacity', 'freeslots', 'occupied', 'percent_occupied']] = filled

    # Impostiamo i tipi finali
    df_filled['capacity'] = df_filled['capacity'].round().astype('Int64')
    df_filled['freeslots'] = df_filled['freeslots'].round().astype('Int64')
    df_filled['occupied'] = df_filled['occupied'].round().astype('Int64')
    df_filled['percent_occupied'] = df_filled['percent_occupied'].round(4)

    return df_filled

parks_park = parks[parks['type'] == 'park']
parks_park = parks_park[['timestamp', 'name', 'capacity', 'freeslots']]
parks_park_filled = fill_data(parks_park).reset_index()
parks_bike = parks[parks['type'] == 'bike']
parks_bike = parks_bike[['timestamp', 'name', 'capacity', 'freeslots']]
parks_bike_filled = fill_data(parks_bike).reset_index()
zones_blu = zones[['ts', 'name', 'stall_blu_capacity', 'stall_blu_freeslots']].copy()
zones_blu.rename(columns={'ts': 'timestamp','stall_blu_capacity': 'capacity', 'stall_blu_freeslots': 'freeslots'}, inplace=True)
max_capacity_per_name = zones_blu.groupby('name')['capacity'].max()
zones_blu['capacity'] = zones_blu['name'].map(max_capacity_per_name)
zones_blu_filled = fill_data(zones_blu).reset_index()
def generate_top_bottom_occupancy(df, category, top_n=3):
    result = []
    occupancy = df.groupby('name')['percent_occupied'].mean().sort_values(ascending=False)
    top = occupancy.head(top_n)
    bottom = occupancy.tail(top_n)

    for name, occ in top.items():
        result.append({"name": name, "average_occupancy": round(occ, 4), "type": "top"})
    for name, occ in bottom.items():
        result.append({"name": name, "average_occupancy": round(occ, 4), "type": "bottom"})

    json_data = json.dumps(result, indent=2)
    save_json(json_data, f"top_bottom_occupancy_{category}.json")
    return json_data

def generate_weekday_occupancy(df, category):
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['weekday'] = df['timestamp'].dt.day_name()
    occupancy = df.groupby('weekday')['percent_occupied'].mean()
    occupancy = occupancy.reindex([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
    ])

    result = [{"weekday": day, "average_occupancy": round(occ, 4)} for day, occ in occupancy.items()]
    json_data = json.dumps(result, indent=2)
    save_json(json_data, f"weekday_occupancy_{category}.json")
    return json_data

def generate_hourly_occupancy(df, category):
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['hour'] = df['timestamp'].dt.hour
    occupancy = df.groupby('hour')['percent_occupied'].mean()

    result = [{"hour": int(hour), "average_occupancy": round(occ, 4)} for hour, occ in occupancy.items()]
    json_data = json.dumps(result, indent=2)
    save_json(json_data, f"hourly_occupancy_{category}.json")
    return json_data

def generate_weekend_holiday_comparison(df, category):
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['date'] = df['timestamp'].dt.date
    df['weekday'] = df['timestamp'].dt.weekday

    years = df['timestamp'].dt.year.unique()
    all_holidays = []
    for year in years:
        all_holidays.extend(get_holiday_dates(year))

    df['day_type'] = 'Weekday'
    df.loc[df['weekday'] >= 5, 'day_type'] = 'Weekend'
    df.loc[df['date'].isin(all_holidays), 'day_type'] = 'Holiday'

    occupancy = df.groupby('day_type')['percent_occupied'].mean()

    result = [{"day_type": dtype, "average_occupancy": round(occ, 4)} for dtype, occ in occupancy.items()]
    json_data = json.dumps(result, indent=2)
    save_json(json_data, f"weekend_holiday_comparison_{category}.json")
    return json_data

def generate_turnover_parks(df, category, top_n=3):
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df_sorted = df.sort_values(by=['name', 'timestamp'])

    turnover = {}
    for name, group in df_sorted.groupby('name'):
        diffs = group['occupied'].diff().abs()
        turnover[name] = diffs.sum()

    turnover_series = pd.Series(turnover).sort_values(ascending=False)
    top_turnover = turnover_series.head(top_n)

    result = [{"name": name, "total_turnover": int(turn)} for name, turn in top_turnover.items()]
    json_data = json.dumps(result, indent=2)
    save_json(json_data, f"turnover_parks_{category}.json")
    return json_data

# Funzioni per generare tutti i JSON per ogni categoria
def generate_all_json_for_category(df, category):
    generate_top_bottom_occupancy(df, category)
    generate_weekday_occupancy(df, category)
    generate_hourly_occupancy(df, category)
    generate_weekend_holiday_comparison(df, category)
    generate_turnover_parks(df, category)
generate_all_json_for_category(parks_park_filled, 'park')
generate_all_json_for_category(parks_bike_filled, 'bike')
generate_all_json_for_category(zones_blu_filled, 'zones_blu')