"""
Precalcola i dati per la pagina statistiche/andamenti dei parcheggi.

Genera TRE file JSON distinti, uno per categoria, così le tipologie non
vengono mai mescolate:

  docs/data/dashboard_struttura.json   -> parcheggi in struttura (type='park')
  docs/data/dashboard_ciclobox.json    -> parcheggi ciclobox     (type='bike')
  docs/data/dashboard_stalliblu.json   -> parcheggi stalli blu   (zones, NON aggiornato)

Per ogni parcheggio viene salvata una matrice GIORNO x ORA con l'occupazione
media (%). A partire da questa matrice la pagina web ricostruisce, filtrando
per intervallo di date / giorni della settimana / mesi:
  - andamento nel tempo
  - heatmap calendario (ora x giorno della settimana)
  - giornata tipica (profilo orario)
  - classifica occupazione media
  - copertura del dato nel periodo

L'occupazione è calcolata in modo robusto: si scartano capacità nulle,
posti liberi incoerenti e (per i parcheggi) le rilevazioni offline.

Non tocca scrape.py. Va eseguito una volta al giorno (workflow update_stats).
"""

import os
import json
import pandas as pd

PARKS_PARQUET = "data" + os.sep + "parks.geoparquet"
ZONES_PARQUET = "data" + os.sep + "zones.geoparquet"
DEST = "docs" + os.sep + "data" + os.sep

WEEKDAYS_IT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]
WEEKDAYS_FULL = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
MONTHS_IT = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
             "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def date_it(ts):
    return f"{ts.day} {MONTHS_IT[ts.month]} {ts.year}"


def robust_capacity(series):
    s = pd.to_numeric(series, errors="coerce").dropna()
    if len(s) == 0:
        return 0
    m = s.mode()
    return int(m.iloc[0]) if len(m) else int(s.median())


def occupancy_frame(df, tcol, cap_col, free_col, offline_col=None):
    d = df.copy()
    d[cap_col] = pd.to_numeric(d[cap_col], errors="coerce")
    d[free_col] = pd.to_numeric(d[free_col], errors="coerce")
    valid = d[cap_col].notna() & (d[cap_col] > 0) & d[free_col].notna()
    valid &= d[free_col] <= d[cap_col]
    if offline_col and offline_col in d.columns:
        valid &= ~d[offline_col].fillna(False).astype(bool)
    d = d[valid].copy()
    d["occ"] = 100.0 * (d[cap_col] - d[free_col]) / d[cap_col]
    d["date"] = d[tcol].dt.date
    d["hour"] = d[tcol].dt.hour
    return d


def day_hour_matrix(g):
    """Matrice [giorni][24] con l'occupazione media per giorno e ora.
    I giorni vanno da first_seen all'ultimo giorno con dati (contigui),
    con None dove non ci sono rilevazioni valide."""
    m = g.groupby(["date", "hour"])["occ"].mean().round(0)
    piv = m.unstack("hour")
    all_dates = pd.date_range(min(piv.index), max(piv.index), freq="D").date
    piv = piv.reindex(index=all_dates, columns=range(24))
    matrix = [[None if pd.isna(v) else int(v) for v in row] for row in piv.values]
    return str(all_dates[0]), matrix


def build_category(df, tcol, cap_col, free_col, offline_col, label, category,
                   period_start, period_end, updated, note, extra_per_struct=None):
    occ = occupancy_frame(df, tcol, cap_col, free_col, offline_col)
    structures = []
    for name, g_all in df.groupby("name"):
        g_occ = occ[occ["name"] == name]
        if len(g_occ) == 0:
            continue
        start, matrix = day_hour_matrix(g_occ)
        item = {
            "name": name,
            "capacity": robust_capacity(g_all[cap_col]),
            "first_seen": g_all[tcol].min().strftime("%Y-%m-%d"),
            "start": start,
            "matrix": matrix,
        }
        if extra_per_struct:
            item.update(extra_per_struct(g_all))
        structures.append(item)

    structures.sort(key=lambda s: s["name"])

    return {
        "meta": {
            "category": category,
            "label": label,
            "updated": updated,
            "period_start": period_start.strftime("%Y-%m-%d"),
            "period_end": period_end.strftime("%Y-%m-%d"),
            "n_structures": len(structures),
            "note": note,
        },
        "weekdays": WEEKDAYS_IT,
        "months": MONTHS_IT[1:],
        "structures": structures,
    }


def process_parks(parks, wanted_type, label, category):
    df = parks.copy()
    df["ts"] = pd.to_datetime(df["currentTimestamp"], errors="coerce")
    df = df[df["ts"].notna() & (df["type"] == wanted_type)]
    return build_category(
        df, "ts", "capacity", "freeslots", "offline",
        label, category, df["ts"].min(), df["ts"].max(),
        updated=True, note="",
    )


def process_zones(zones):
    df = zones.copy()
    df["ts"] = pd.to_datetime(df["ts"], errors="coerce")
    df = df[df["ts"].notna()]
    ps, pe = df["ts"].min(), df["ts"].max()
    note = ("Dati storici non più aggiornati. Periodo coperto: dall'"
            + date_it(ps) + " al " + date_it(pe) + ".")

    def extra(g_all):
        return {
            "capacity_blu": robust_capacity(g_all["stall_blu_capacity"]),
            "capacity_carico_scarico": robust_capacity(g_all["stall_carico-scarico_capacity"]),
            "capacity_disabili": robust_capacity(g_all["stall_disabili_capacity"]),
        }

    payload = build_category(
        df, "ts", "stall_blu_capacity", "stall_blu_freeslots", None,
        "Parcheggi su stalli blu (zone regolamentate)", "stalliblu", ps, pe,
        updated=False, note=note, extra_per_struct=extra,
    )
    payload["composition"] = {
        "blu": int(sum(s["capacity_blu"] for s in payload["structures"])),
        "carico_scarico": int(sum(s["capacity_carico_scarico"] for s in payload["structures"])),
        "disabili": int(sum(s["capacity_disabili"] for s in payload["structures"])),
    }
    return payload


# ============================================================== #
#  CURIOSITÀ                                                     #
#  Fatti sintetici calcolati dai dati, per quattro fasce di      #
#  calendario (globale, anno scorso, mese scorso, settimana      #
#  scorsa) e per le tre categorie separate.                      #
# ============================================================== #

def _occ_raw(df, tcol, cap_col, free_col, offline_col=None):
    d = df.copy()
    d[cap_col] = pd.to_numeric(d[cap_col], errors="coerce")
    d[free_col] = pd.to_numeric(d[free_col], errors="coerce")
    valid = d[cap_col].notna() & (d[cap_col] > 0) & d[free_col].notna() & (d[free_col] <= d[cap_col])
    if offline_col and offline_col in d.columns:
        valid &= ~d[offline_col].fillna(False).astype(bool)
    d = d[valid].copy()
    d["occ"] = 100.0 * (d[cap_col] - d[free_col]) / d[cap_col]
    d["hour"] = d[tcol].dt.hour
    d["dow"] = d[tcol].dt.dayofweek
    return d


def calendar_periods(ref):
    """Ritorna i periodi di calendario relativi alla data di riferimento
    (l'ultimo giorno con dati della categoria)."""
    ref = pd.Timestamp(ref).normalize()
    periods = {}
    periods["globale"] = (None, None, "Tutto lo storico")
    # ieri = ultimo giorno con dati
    periods["ieri"] = (ref, ref.replace(hour=23, minute=59, second=59), date_it(ref))
    # anno scorso
    y = ref.year - 1
    periods["anno"] = (pd.Timestamp(y, 1, 1), pd.Timestamp(y, 12, 31, 23, 59, 59), str(y))
    # mese scorso
    first_this_month = ref.replace(day=1)
    last_prev_month = first_this_month - pd.Timedelta(days=1)
    first_prev_month = last_prev_month.replace(day=1)
    periods["mese"] = (first_prev_month.normalize(),
                       last_prev_month.replace(hour=23, minute=59, second=59),
                       f"{MONTHS_IT[last_prev_month.month].capitalize()} {last_prev_month.year}")
    # settimana scorsa (lun-dom)
    monday_this_week = ref - pd.Timedelta(days=ref.weekday())
    prev_monday = monday_this_week - pd.Timedelta(days=7)
    prev_sunday = prev_monday + pd.Timedelta(days=6)
    lbl = f"Settimana {prev_monday.day} {MONTHS_IT[prev_monday.month]}"
    if prev_monday.month != prev_sunday.month:
        lbl += f" – {prev_sunday.day} {MONTHS_IT[prev_sunday.month]} {prev_sunday.year}"
    else:
        lbl += f"–{prev_sunday.day} {MONTHS_IT[prev_sunday.month]} {prev_sunday.year}"
    periods["settimana"] = (prev_monday.normalize(),
                            prev_sunday.replace(hour=23, minute=59, second=59), lbl)
    return periods


def _facts_for(d, free_col):
    """Calcola le curiosità su un sottoinsieme già filtrato (con colonna occ)."""
    facts = []
    n_days = d["date"].nunique() if "date" in d.columns else pd.to_datetime(d["ts"]).dt.date.nunique()
    if len(d) == 0:
        return None, 0

    by_struct = d.groupby("name")["occ"].mean()
    most_full = by_struct.idxmax(); most_empty = by_struct.idxmin()
    facts.append({"label": "Il più pieno", "value": most_full,
                  "detail": f"occupazione media {by_struct.max():.0f}%"})
    facts.append({"label": "Il più libero", "value": most_empty,
                  "detail": f"occupazione media {by_struct.min():.0f}%"})

    by_hour = d.groupby("hour")["occ"].mean()
    facts.append({"label": "Ora di punta", "value": f"{int(by_hour.idxmax())}:00",
                  "detail": f"in media {by_hour.max():.0f}% occupato"})
    facts.append({"label": "Ora più tranquilla", "value": f"{int(by_hour.idxmin())}:00",
                  "detail": f"in media {by_hour.min():.0f}% occupato"})

    by_dow = d.groupby("dow")["occ"].mean()
    facts.append({"label": "Giorno più affollato", "value": WEEKDAYS_FULL[int(by_dow.idxmax())],
                  "detail": f"in media {by_dow.max():.0f}% occupato"})

    peak = d.loc[d["occ"].idxmax()]
    tcol = "ts"
    peak_ts = pd.to_datetime(peak[tcol])
    facts.append({"label": "Picco assoluto", "value": f"{peak['occ']:.0f}% · {peak['name']}",
                  "detail": f"il {peak_ts.day} {MONTHS_IT[peak_ts.month]} {peak_ts.year} alle {peak_ts.hour}:{peak_ts.minute:02d}"})

    full = d[pd.to_numeric(d[free_col], errors="coerce") == 0]
    if len(full):
        fc = full.groupby("name").size().sort_values(ascending=False)
        facts.append({"label": "Più volte \"tutto pieno\"", "value": fc.index[0],
                      "detail": f"{int(fc.iloc[0])} rilevazioni a zero posti"})

    counts = d.groupby("name")["occ"].count()
    enough = counts[counts >= 50].index
    if len(enough) >= 2:
        std = d[d["name"].isin(enough)].groupby("name")["occ"].std()
        facts.append({"label": "Il più regolare", "value": std.idxmin(),
                      "detail": f"oscillazioni minime (±{std.min():.0f}%)"})
        facts.append({"label": "Il più variabile", "value": std.idxmax(),
                      "detail": f"oscillazioni ampie (±{std.max():.0f}%)"})

    return facts, n_days


def build_curiosita_category(df, tcol, cap_col, free_col, offline_col, label, category):
    df = df.copy()
    df[tcol] = pd.to_datetime(df[tcol], errors="coerce")
    df = df[df[tcol].notna()]
    d_all = _occ_raw(df, tcol, cap_col, free_col, offline_col)
    d_all["ts"] = df.loc[d_all.index, tcol]
    d_all["date"] = d_all["ts"].dt.date

    ref = d_all["ts"].max()
    periods = calendar_periods(ref)
    out = {"label": label, "category": category, "periods": []}
    for key in ["globale", "ieri", "settimana", "mese", "anno"]:
        start, end, plabel = periods[key]
        if start is None:
            sub = d_all
        else:
            sub = d_all[(d_all["ts"] >= start) & (d_all["ts"] <= end)]
        facts, n_days = _facts_for(sub, free_col)
        out["periods"].append({
            "key": key, "label": plabel,
            "n_days": int(n_days),
            "facts": facts if facts else [],
            "empty": facts is None,
        })
    return out


def build_curiosita(parks, zones):
    parks = parks.copy()
    parks["cts"] = pd.to_datetime(parks["currentTimestamp"], errors="coerce")
    result = {
        "generated": pd.Timestamp.now("UTC").strftime("%Y-%m-%d"),
        "categories": [
            build_curiosita_category(parks[parks["type"] == "park"], "cts", "capacity", "freeslots", "offline",
                                     "Parcheggi in struttura", "parcheggi"),
            build_curiosita_category(parks[parks["type"] == "bike"], "cts", "capacity", "freeslots", "offline",
                                     "Parcheggi ciclobox", "ciclobox"),
            build_curiosita_category(zones, "ts", "stall_blu_capacity", "stall_blu_freeslots", None,
                                     "Parcheggi su stalli blu", "stalli"),
        ],
    }
    return result


def main():
    parks = pd.read_parquet(PARKS_PARQUET)
    zones = pd.read_parquet(ZONES_PARQUET)
    out = {
        "dashboard_struttura.json": process_parks(parks, "park", "Parcheggi in struttura", "struttura"),
        "dashboard_ciclobox.json": process_parks(parks, "bike", "Parcheggi ciclobox", "ciclobox"),
        "dashboard_stalliblu.json": process_zones(zones),
    }
    os.makedirs(DEST, exist_ok=True)

    curio = build_curiosita(parks, zones)
    with open(DEST + "curiosita.json", "w", encoding="utf-8") as f:
        json.dump(curio, f, ensure_ascii=False, separators=(",", ":"))
    print("curiosita.json: " + str(len(curio["categories"])) + " categorie x 5 periodi (globale, ieri, settimana, mese, anno)")

    for fname, payload in out.items():
        with open(DEST + fname, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        m = payload["meta"]
        size = os.path.getsize(DEST + fname) / 1024
        print(f"{fname}: {m['n_structures']} parcheggi, "
              f"{m['period_start']} -> {m['period_end']}, "
              f"aggiornato={m['updated']}, {size:.0f} KB")


if __name__ == "__main__":
    main()
