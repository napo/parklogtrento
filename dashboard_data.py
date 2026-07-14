"""
Precalcola le aggregazioni per la dashboard di andamento dei parcheggi.

Genera TRE file JSON distinti, uno per ciascuna categoria, così le tre
tipologie non vengono mai mescolate:

  docs/data/dashboard_struttura.json   -> parcheggi in struttura  (type='park')
  docs/data/dashboard_ciclobox.json    -> parcheggi ciclobox      (type='bike')
  docs/data/dashboard_stalliblu.json   -> parcheggi stalli blu    (zones, NON aggiornato)

Ogni file contiene:
  meta       : etichetta categoria, se è aggiornata, periodo coperto, nota
  structures : per ogni parcheggio -> heatmap 24x7, profilo orario tipico,
               occupazione media, ora di saturazione tipica, uptime/offline
  ranking    : parcheggi ordinati per occupazione media

Non tocca scrape.py: legge i geoparquet storici già presenti in data/.
"""

import os
import json
import pandas as pd

PARKS_PARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_PARQUET = "data" + os.sep + "zones.geoparquet"
DEST = "docs" + os.sep + "data" + os.sep

WEEKDAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]
MONTHS_IT = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
             "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def date_it(ts):
    """Data in italiano, es. '11 marzo 2025'."""
    return f"{ts.day} {MONTHS_IT[ts.month]} {ts.year}"


def robust_capacity(series):
    """Capacità rappresentativa = valore più frequente (moda), robusto ai
    valori anomali occasionali dei sensori."""
    s = pd.to_numeric(series, errors="coerce").dropna()
    if len(s) == 0:
        return 0
    m = s.mode()
    return int(m.iloc[0]) if len(m) else int(s.median())


def occupancy_frame(df, cap_col, free_col, offline_col=None):
    """Calcola l'occupazione % scartando righe non affidabili.

    Esclude: capacità nulla/mancante, freeslots mancante o maggiore della
    capacità (sensore incoerente) e, se disponibile, le rilevazioni offline.
    """
    d = df.copy()
    d[cap_col] = pd.to_numeric(d[cap_col], errors="coerce")
    d[free_col] = pd.to_numeric(d[free_col], errors="coerce")

    valid = d[cap_col].notna() & (d[cap_col] > 0) & d[free_col].notna()
    valid &= d[free_col] <= d[cap_col]
    if offline_col and offline_col in d.columns:
        is_offline = d[offline_col].fillna(False).astype(bool)
        valid &= ~is_offline
    d = d[valid].copy()
    d["occ"] = 100.0 * (d[cap_col] - d[free_col]) / d[cap_col]
    return d


def build_structure(name, g, tcol, cap_col, free_col):
    """Aggregazioni per un singolo parcheggio."""
    g = g.copy()
    g["hour"] = g[tcol].dt.hour
    g["dow"] = g[tcol].dt.dayofweek  # 0 = lunedì

    # heatmap 24x7: occupazione media per (giorno_settimana, ora)
    pivot = g.groupby(["dow", "hour"])["occ"].mean().round(1)
    heatmap = [[int(h), int(dw), round(float(v), 1)]
               for (dw, h), v in pivot.items()]  # [ora, giorno, valore] per ECharts

    # profilo orario tipico (media su tutti i giorni)
    hourly_series = g.groupby("hour")["occ"].mean().round(1)
    hourly = [round(float(hourly_series.get(h, float("nan"))), 1)
              if h in hourly_series.index else None for h in range(24)]

    occ_mean = round(float(g["occ"].mean()), 1)
    # ora di saturazione tipica = ora con occupazione media più alta
    saturation_hour = int(hourly_series.idxmax()) if len(hourly_series) else None

    return {
        "heatmap": heatmap,
        "hourly": hourly,
        "occ_mean": occ_mean,
        "saturation_hour": saturation_hour,
    }


def process_parks(df, wanted_type, label, category):
    df = df.copy()
    df["currentTimestamp"] = pd.to_datetime(df["currentTimestamp"], errors="coerce")
    df = df[df["currentTimestamp"].notna()]
    df = df[df["type"] == wanted_type]

    period_start = df["currentTimestamp"].min()
    period_end = df["currentTimestamp"].max()

    occ = occupancy_frame(df, "capacity", "freeslots", offline_col="offline")

    structures = []
    for name, g_all in df.groupby("name"):
        g_occ = occ[occ["name"] == name]
        if len(g_occ) == 0:
            continue

        # uptime / affidabilità del sensore (su tutte le righe, non solo valide)
        n_total = len(g_all)
        if "offline" in g_all.columns:
            offline_pct = round(100.0 * g_all["offline"].fillna(False).astype(bool).mean(), 1)
        else:
            offline_pct = 0.0
        uptime_pct = round(100.0 - offline_pct, 1)

        capacity = robust_capacity(g_all["capacity"])

        agg = build_structure(name, g_occ, "currentTimestamp", "capacity", "freeslots")
        structures.append({
            "name": name,
            "capacity": capacity,
            "first_seen": g_all["currentTimestamp"].min().strftime("%Y-%m-%d"),
            "n_obs": int(n_total),
            "uptime_pct": uptime_pct,
            "offline_pct": offline_pct,
            **agg,
        })

    structures.sort(key=lambda s: s["occ_mean"], reverse=True)
    ranking = [{"name": s["name"],
                "occ_mean": s["occ_mean"],
                "saturation_hour": s["saturation_hour"],
                "uptime_pct": s["uptime_pct"]}
               for s in structures]

    return {
        "meta": {
            "category": category,
            "label": label,
            "updated": True,
            "period_start": period_start.strftime("%Y-%m-%d"),
            "period_end": period_end.strftime("%Y-%m-%d"),
            "n_structures": len(structures),
            "note": "",
        },
        "weekdays": WEEKDAYS_IT,
        "structures": structures,
        "ranking": ranking,
    }


def process_zones(df):
    """Stalli blu: dato storico congelato. Usa gli stalli 'blu' come misura
    principale di occupazione, più la composizione dei tipi di stallo."""
    df = df.copy()
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    df = df[df["ts"].notna()]

    period_start = df["ts"].min()
    period_end = df["ts"].max()

    occ = occupancy_frame(df, "stall_blu_capacity", "stall_blu_freeslots")

    structures = []
    for name, g_all in df.groupby("name"):
        g_occ = occ[occ["name"] == name]
        if len(g_occ) == 0:
            continue
        cap_blu = robust_capacity(g_all["stall_blu_capacity"])
        cap_cs = robust_capacity(g_all["stall_carico-scarico_capacity"])
        cap_dis = robust_capacity(g_all["stall_disabili_capacity"])

        agg = build_structure(name, g_occ, "ts", "stall_blu_capacity", "stall_blu_freeslots")
        structures.append({
            "name": name,
            "capacity": cap_blu,
            "capacity_blu": cap_blu,
            "capacity_carico_scarico": cap_cs,
            "capacity_disabili": cap_dis,
            "first_seen": g_all["ts"].min().strftime("%Y-%m-%d"),
            "n_obs": int(len(g_all)),
            "uptime_pct": 100.0,
            "offline_pct": 0.0,
            **agg,
        })

    structures.sort(key=lambda s: s["occ_mean"], reverse=True)
    ranking = [{"name": s["name"],
                "occ_mean": s["occ_mean"],
                "saturation_hour": s["saturation_hour"],
                "uptime_pct": s["uptime_pct"]}
               for s in structures]

    composition = {
        "blu": int(sum(s["capacity_blu"] for s in structures)),
        "carico_scarico": int(sum(s["capacity_carico_scarico"] for s in structures)),
        "disabili": int(sum(s["capacity_disabili"] for s in structures)),
    }

    ps = date_it(period_start)
    pe = date_it(period_end)
    return {
        "meta": {
            "category": "stalliblu",
            "label": "Parcheggi su stalli blu (zone regolamentate)",
            "updated": False,
            "period_start": period_start.strftime("%Y-%m-%d"),
            "period_end": period_end.strftime("%Y-%m-%d"),
            "n_structures": len(structures),
            "note": ("Dati storici non più aggiornati. "
                     "Periodo coperto: dall'" + ps + " al " + pe + "."),
        },
        "weekdays": WEEKDAYS_IT,
        "composition": composition,
        "structures": structures,
        "ranking": ranking,
    }


def main():
    parks = pd.read_parquet(PARKS_PARQUET)
    zones = pd.read_parquet(ZONES_PARQUET)

    out = {
        "dashboard_struttura.json": process_parks(parks, "park", "Parcheggi in struttura", "struttura"),
        "dashboard_ciclobox.json": process_parks(parks, "bike", "Parcheggi ciclobox", "ciclobox"),
        "dashboard_stalliblu.json": process_zones(zones),
    }

    os.makedirs(DEST, exist_ok=True)
    for fname, payload in out.items():
        with open(DEST + fname, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        m = payload["meta"]
        print(f"{fname}: {m['n_structures']} parcheggi, "
              f"periodo {m['period_start']} -> {m['period_end']}, "
              f"aggiornato={m['updated']}")


if __name__ == "__main__":
    main()
