
import pandas as pd
import json
from collections import defaultdict

# --- Caricamento dati ---
parks_df = pd.read_csv("/mnt/data/parks.csv")
zones_df = pd.read_csv("/mnt/data/zones.csv")
weather_df = pd.read_csv("/mnt/data/weather_trento.csv")

# Parsing timestamp
parks_df["timestamp"] = pd.to_datetime(parks_df["timestamp"], utc=True).dt.tz_convert("Europe/Rome")
zones_df["ts"] = pd.to_datetime(zones_df["ts"], utc=True).dt.tz_convert("Europe/Rome")

# Filtro e calcoli
park_df = parks_df[parks_df["type"] == "park"].copy()
bike_df = parks_df[parks_df["type"] == "bike"].copy()
zones_df = zones_df[zones_df["stall_blu_capacity"] > 0].copy()

park_df["occupied"] = park_df["capacity"] - park_df["freeslots"]
park_df["occupancy_percent"] = (park_df["occupied"] / park_df["capacity"]) * 100

bike_df["occupied"] = bike_df["capacity"] - bike_df["freeslots"]
bike_df["occupancy_percent"] = (bike_df["occupied"] / bike_df["capacity"]) * 100

zones_df["occupied"] = zones_df["stall_blu_capacity"] - zones_df["stall_blu_freeslots"]
zones_df["occupancy_percent"] = (zones_df["occupied"] / zones_df["stall_blu_capacity"]) * 100

# --- Range temporale ---
all_timestamps = pd.concat([park_df["timestamp"], zones_df["ts"], bike_df["timestamp"]])
data_min = all_timestamps.min()
data_max = all_timestamps.max()

giorni_it = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
mesi_it = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
]

def format_data_it(dt):
    return f"{giorni_it[dt.weekday()]}, {dt.day} {mesi_it[dt.month - 1]} {dt.year}"

intestazione = {
    "dal": format_data_it(data_min),
    "al": format_data_it(data_max)
}

# --- Funzioni per curiosità ---
def calcola_rotazione_parcheggio(df, nome):
    df_nome = df[df["name"] == nome].copy()
    df_nome["date"] = df_nome["timestamp"].dt.date
    giorni = df_nome["date"].nunique()
    posti = df_nome["capacity"].max()
    ingressi_medi = (df_nome["occupied"].diff().clip(lower=0)).sum() / giorni
    return round(ingressi_medi / posti, 2) if posti and giorni else None

def confronto_ciclobox_meteo(bike_df, weather_df):
    df = bike_df.copy()
    weather_df["timestamp"] = pd.to_datetime(weather_df["timestamp"], utc=True).dt.tz_convert("Europe/Rome")
    df = pd.merge_asof(df.sort_values("timestamp"), weather_df.sort_values("timestamp"),
                       on="timestamp", direction="backward")
    df["rainy"] = df["precipitation"] > 0
    return round(df[~df["rainy"]]["occupancy_percent"].mean(), 1), round(df[df["rainy"]]["occupancy_percent"].mean(), 1)

def giorni_max_occupazione_zone_blu(zones_df):
    df = zones_df.copy()
    df["weekday"] = df["ts"].dt.dayofweek
    return df.groupby("weekday")["occupancy_percent"].mean().sort_values(ascending=False).head(2).index.map(lambda x: giorni_it[x]).tolist()

def parcheggio_struttura_max_occupazione(park_df):
    return park_df.groupby("name")["occupancy_percent"].mean().idxmax()

# --- Calcolo curiosità ---
rotazione_fiera = calcola_rotazione_parcheggio(park_df, "Piazza Fiera")
media_no_pioggia, media_pioggia = confronto_ciclobox_meteo(bike_df, weather_df)
giorni_massima_occupazione = giorni_max_occupazione_zone_blu(zones_df)
struttura_max_occupazione = parcheggio_struttura_max_occupazione(park_df)

curiosita_dict = {
    "rotazione_parcheggio_piazza_fiera": f"{rotazione_fiera} utilizzi al giorno",
    "media_occupazione_ciclobox_senza_pioggia": f"{media_no_pioggia}%",
    "media_occupazione_ciclobox_con_pioggia": f"{media_pioggia}%",
    "giorni_massima_occupazione_zone_blu": giorni_massima_occupazione,
    "parcheggio_con_occupazione_media_massima": struttura_max_occupazione
}

# --- Grafici lineari ---
def estrai_lineari(df, time_col):
    df = df.copy()
    df["weekday"] = df[time_col].dt.dayofweek
    df["hour"] = df[time_col].dt.hour
    grouped = df.groupby(["weekday", "hour"])["occupancy_percent"].mean().reset_index()
    data_dict = defaultdict(lambda: [None]*24)
    for _, row in grouped.iterrows():
        data_dict[int(row["weekday"])][int(row["hour"])] = round(row["occupancy_percent"], 2)
    return data_dict

totale_veicoli_df = pd.concat([
    park_df[["timestamp", "occupancy_percent"]].rename(columns={"timestamp": "ts"}),
    zones_df[["ts", "occupancy_percent"]]
])

lineari = {
    "parcheggi_totali_veicoli": estrai_lineari(totale_veicoli_df, "ts"),
    "parcheggi_struttura": estrai_lineari(park_df, "timestamp"),
    "parcheggi_stalli_blu": estrai_lineari(zones_df, "ts"),
    "ciclobox": estrai_lineari(bike_df, "timestamp"),
    "strutture": {name: estrai_lineari(g, "timestamp") for name, g in park_df.groupby("name")},
    "zone_blu": {name: estrai_lineari(g, "ts") for name, g in zones_df.groupby("name")},
    "ciclobox_singoli": {name: estrai_lineari(g, "timestamp") for name, g in bike_df.groupby("name")}
}

# --- Creazione JSON finale ---
json_data = {
    "intestazione": intestazione,
    "curiosita": curiosita_dict,
    "grafici_lineari": lineari
}

json_out_path = "/mnt/data/dati_dashboard_completi.json"
with open(json_out_path, "w") as f:
    json.dump(json_data, f, indent=2, ensure_ascii=False)
