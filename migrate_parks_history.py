"""
Migrazione one-off: divide l'unico data/parks.geoparquet (cumulativo, in
crescita illimitata) in partizioni mensili sotto data/history/, lette e
scritte da parks_history.py.

Non tocca git: dopo aver controllato il riepilogo stampato, fai a mano

    git rm data/parks.geoparquet
    git add data/history/
    git commit -m "..."

Va lanciato una sola volta, da riga di comando: python migrate_parks_history.py
"""

import os

import geopandas as gpd

import parks_history

OLD_PARKS_GEOPARQUET = "data" + os.sep + "parks.geoparquet"


def main():
    parks = gpd.read_parquet(OLD_PARKS_GEOPARQUET)
    totale_righe = len(parks)

    os.makedirs(parks_history.HISTORY_DIR, exist_ok=True)
    periodi = parks["currentTimestamp"].dt.strftime("%Y-%m")

    righe_scritte = 0
    for periodo, gruppo in parks.groupby(periodi, sort=True):
        path = parks_history._partition_path(periodo)
        gruppo = gruppo.reset_index(drop=True)
        gruppo.to_parquet(path, engine="pyarrow")
        size_kb = os.path.getsize(path) / 1024
        print(f"{path}: {len(gruppo)} righe, {size_kb:.0f} KB")
        righe_scritte += len(gruppo)

    print(f"\ntotale: {righe_scritte} righe scritte su {totale_righe} lette dal file originale")
    if righe_scritte != totale_righe:
        print("ATTENZIONE: il totale non torna, controlla prima di rimuovere il file originale")


if __name__ == "__main__":
    main()
