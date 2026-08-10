import glob
import os

import geopandas as gpd
import pandas as pd

HISTORY_DIR = "data" + os.sep + "history"
_PARTITION_GLOB = HISTORY_DIR + os.sep + "parks-*.geoparquet"


def _partition_path(period):
    return HISTORY_DIR + os.sep + f"parks-{period}.geoparquet"


def load_parks_history():
    """
    Legge tutte le partizioni mensili sotto data/history/ e le concatena
    in un unico GeoDataFrame, ordinato per currentTimestamp, cosi' come
    si comportava in passato la lettura dell'unico data/parks.geoparquet.
    """
    files = sorted(glob.glob(_PARTITION_GLOB))
    if not files:
        raise FileNotFoundError(
            f"nessuna partizione trovata in {HISTORY_DIR} "
            "(repo non ancora migrato: vedi migrate_parks_history.py)"
        )
    parts = [gpd.read_parquet(f) for f in files]
    history = gpd.GeoDataFrame(
        pd.concat(parts, ignore_index=True),
        geometry="geom",
        crs="EPSG:4326",
    )
    return history.sort_values("currentTimestamp", ignore_index=True)


def append_reading(new_rows):
    """
    Aggiunge una nuova lettura (tutte le righe con lo stesso currentTimestamp,
    come prodotto da uno scrape) alla partizione del mese a cui appartiene.
    Tocca solo il file del mese corrente: i mesi passati restano immutati.
    """
    os.makedirs(HISTORY_DIR, exist_ok=True)
    period = new_rows["currentTimestamp"].max().strftime("%Y-%m")
    path = _partition_path(period)

    if os.path.exists(path):
        existing = gpd.read_parquet(path)
        if existing["currentTimestamp"].max() >= new_rows["currentTimestamp"].max():
            return
        combined = gpd.GeoDataFrame(
            pd.concat([existing, new_rows], ignore_index=True),
            geometry="geom",
            crs="EPSG:4326",
        )
        combined.to_parquet(path, engine="pyarrow")
        print("new parks create " + str(new_rows["currentTimestamp"].max()))
    else:
        new_rows.to_parquet(path, engine="pyarrow")
        print("new partition " + period + " create " + str(new_rows["currentTimestamp"].max()))
