"""
Valutazione onesta delle previsioni.

Confronta le previsioni archiviate (emesse PRIMA che i fatti accadessero, da
forecast.py) con quello che e' poi realmente successo, e pubblica l'errore.

E' la parte che rende le previsioni credibili: un sito che dice "sbaglio in
media 7 punti sul Duomo e 19 su ex Zuffo, ed ecco lo storico" vale molto piu'
di uno che mostra una curva senza dire quanto vale.

Oltre all'errore del modello viene calcolato quello di un riferimento banale
(la media storica della struttura), per poter dire se il modello serve davvero:
lo "skill" e' la riduzione percentuale dell'errore rispetto al riferimento.

Genera docs/data/forecast_score.json. Va eseguito una volta al giorno, dopo
forecast.py.
"""

import os
import json
import glob
import numpy as np
import pandas as pd

PARKS_PARQUET = "data" + os.sep + "parks.geoparquet"
DEST = "docs" + os.sep + "data" + os.sep
ARCHIVIO = DEST + "forecast_archive" + os.sep

TIPO_DI_CATEGORIA = {"parcheggi": "park", "ciclobox": "bike"}


def serie_oraria_reale(parks, tipo):
    d = parks[parks["type"] == tipo].copy()
    d["ts"] = pd.to_datetime(d["currentTimestamp"], errors="coerce")
    d = d[d["ts"].notna()]
    d["cap"] = pd.to_numeric(d["capacity"], errors="coerce")
    d["free"] = pd.to_numeric(d["freeslots"], errors="coerce")
    ok = (d["cap"] > 0) & d["free"].notna() & (d["free"] <= d["cap"])
    if "offline" in d.columns:
        ok &= ~d["offline"].fillna(False).astype(bool)
    d = d[ok].copy()
    d["occ"] = 100.0 * (d["cap"] - d["free"]) / d["cap"]
    h = d.groupby(["name", d["ts"].dt.floor("h")])["occ"].mean().reset_index()
    h.columns = ["name", "ts", "reale"]
    return h


def valuta(parks, categoria):
    tipo = TIPO_DI_CATEGORIA[categoria]
    reale = serie_oraria_reale(parks, tipo)
    if len(reale) == 0:
        return None

    # riferimento banale: la media storica di ogni struttura
    media_storica = reale.groupby("name")["reale"].mean()

    righe = []
    for percorso in sorted(glob.glob(f"{ARCHIVIO}*_{categoria}.json")):
        with open(percorso, encoding="utf-8") as f:
            prev = json.load(f)
        emessa = pd.Timestamp(prev["meta"]["ultimo_dato"])
        for s in prev["structures"]:
            for p in s["punti"]:
                righe.append({
                    "name": s["name"],
                    "ts": pd.Timestamp(p["ts"]),
                    "previsto": p["occ"],
                    "orizzonte": int(round((pd.Timestamp(p["ts"]) - emessa).total_seconds() / 3600)),
                    "emessa": emessa,
                })
    if not righe:
        return None

    df = pd.DataFrame(righe).merge(reale, on=["name", "ts"], how="inner")
    if len(df) == 0:
        # nessuna previsione e' ancora verificabile: e' normale al primo giro
        return {
            "meta": {"category": categoria, "verificabili": 0,
                     "nota": "Nessuna previsione ancora verificabile: servono almeno "
                             "24 ore fra l'emissione e la verifica."},
            "per_struttura": [], "per_orizzonte": [],
        }

    df["errore"] = (df["previsto"] - df["reale"]).abs()
    df["errore_banale"] = (df["name"].map(media_storica) - df["reale"]).abs()

    per_struttura = []
    for nome, g in df.groupby("name"):
        mae = g["errore"].mean()
        mae_banale = g["errore_banale"].mean()
        skill = 100 * (1 - mae / mae_banale) if mae_banale > 0 else 0.0
        per_struttura.append({
            "name": nome,
            "mae": round(float(mae), 1),
            "mae_riferimento": round(float(mae_banale), 1),
            "skill": round(float(skill), 0),
            "n": int(len(g)),
        })
    per_struttura.sort(key=lambda x: x["mae"])

    per_orizzonte = []
    for h, g in df.groupby("orizzonte"):
        if h < 1 or h > 48:
            continue
        per_orizzonte.append({
            "orizzonte": int(h),
            "mae": round(float(g["errore"].mean()), 1),
            "n": int(len(g)),
        })
    per_orizzonte.sort(key=lambda x: x["orizzonte"])

    return {
        "meta": {
            "category": categoria,
            "verificabili": int(len(df)),
            "periodo_da": df["ts"].min().strftime("%Y-%m-%d"),
            "periodo_a": df["ts"].max().strftime("%Y-%m-%d"),
            "mae_medio": round(float(df["errore"].mean()), 1),
            "mae_riferimento": round(float(df["errore_banale"].mean()), 1),
            "skill": round(float(100 * (1 - df["errore"].mean() / df["errore_banale"].mean())), 0),
            "aggiornato": pd.Timestamp.now("UTC").strftime("%Y-%m-%d"),
            "nota": ("Errore medio assoluto in punti percentuali di occupazione, misurato "
                     "confrontando le previsioni archiviate con quello che e' poi successo. "
                     "Lo 'skill' e' quanto il modello riduce l'errore rispetto a un "
                     "riferimento banale (la media storica del parcheggio): 0% vuol dire "
                     "che il modello non serve a niente."),
        },
        "per_struttura": per_struttura,
        "per_orizzonte": per_orizzonte,
    }


def main():
    if not os.path.isdir(ARCHIVIO):
        print("archivio delle previsioni assente: niente da valutare")
        return
    parks = pd.read_parquet(PARKS_PARQUET)
    out = {"categorie": []}
    for categoria in ["parcheggi", "ciclobox"]:   # gli stalli non si prevedono, quindi non si valutano
        r = valuta(parks, categoria)
        if r:
            out["categorie"].append(r)
            m = r["meta"]
            if m["verificabili"]:
                print(f"{categoria}: {m['verificabili']} previsioni verificate, "
                      f"errore {m['mae_medio']} punti (riferimento {m['mae_riferimento']}), "
                      f"skill {m['skill']}%")
            else:
                print(f"{categoria}: nessuna previsione ancora verificabile")

    with open(DEST + "forecast_score.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("scritto forecast_score.json")


if __name__ == "__main__":
    main()
