"""
Previsioni di occupazione dei parcheggi.

REGOLA FONDAMENTALE: si prevedono SOLO i parcheggi in struttura e i ciclobox,
tenuti sempre separati. Gli stalli blu non si prevedono MAI: la raccolta si e'
interrotta il 28 aprile 2025 e prevederli sarebbe inventare.

Modello: profilo stagionale (giorno della settimana x ora) corretto con lo
scostamento piu' recente. Sui dati reali (backtest sugli ultimi 30 giorni):

    orizzonte   profilo   profilo+correzione   persistenza
      +1h        12.4          6.8                8.9
      +3h        12.4          9.5               19.6
      +6h        12.4         11.2               22.8
      +24h       12.5         12.3               23.4

(errore medio assoluto in punti percentuali di occupazione; il riferimento
banale della media globale sbaglia di 24.8)

Genera, per ogni categoria:
  docs/data/forecast_parcheggi.json
  docs/data/forecast_ciclobox.json
e archivia le previsioni emesse in docs/data/forecast_archive/, cosi' in
seguito si potra' misurare onestamente quanto ci si azzecca.

Va eseguito una volta al giorno, dopo dashboard_data.py.
"""

import os
import json
import numpy as np
import pandas as pd

PARKS_PARQUET = "data" + os.sep + "parks.geoparquet"
DEST = "docs" + os.sep + "data" + os.sep
ARCHIVIO = DEST + "forecast_archive" + os.sep

ORE_AVANTI = 48          # orizzonte della previsione
PESO_CORREZIONE = 0.6    # quanto pesa lo scostamento attuale (calibrato sul backtest)
DECADIMENTO_ORE = 12.0   # dopo ~12h la correzione e' svanita e resta il profilo

# Categorie previste: gli stalli blu NON compaiono e non devono comparire.
CATEGORIE = [
    {"type": "park", "file": "forecast_parcheggi.json", "label": "Parcheggi in struttura"},
    {"type": "bike", "file": "forecast_ciclobox.json", "label": "Parcheggi ciclobox"},
]

# Strutture con orari propri: fuori apertura non si prevede nulla.
ORARI = {
    "Parcheggio Cittadella dello studente - P6": {
        "apertura": 8, "chiusura": 21, "giorni": [0, 1, 2, 3, 4, 5]
    },
}


def serie_oraria(df):
    """Serie oraria di occupazione per struttura, scartando i dati inaffidabili."""
    d = df.copy()
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
    h.columns = ["name", "ts", "occ"]
    h["dow"] = h["ts"].dt.dayofweek
    h["hour"] = h["ts"].dt.hour
    return h, d


def aperto(nome, ts):
    r = ORARI.get(nome)
    if not r:
        return True
    return ts.dayofweek in r["giorni"] and r["apertura"] <= ts.hour < r["chiusura"]


def prevedi_categoria(parks, tipo, label):
    df = parks[parks["type"] == tipo]
    h, grezzi = serie_oraria(df)
    if len(h) == 0:
        return None

    ultimo = h["ts"].max()
    profilo = h.groupby(["name", "dow", "hour"])["occ"].mean()

    # errore storico del profilo, per struttura: da qui escono gli intervalli
    h = h.join(profilo.rename("prof"), on=["name", "dow", "hour"])
    h["res"] = h["occ"] - h["prof"]
    mae = h.groupby("name")["res"].apply(lambda s: s.abs().mean())

    strutture = []
    for nome, g in h.groupby("name"):
        g = g.sort_values("ts")
        ultima_oss = g.iloc[-1]
        # se l'ultima osservazione e' vecchia la correzione non ha senso
        eta_ore = (ultimo - ultima_oss["ts"]).total_seconds() / 3600.0
        scarto = float(ultima_oss["res"]) if eta_ore <= 3 and not pd.isna(ultima_oss["res"]) else 0.0

        cap = pd.to_numeric(grezzi[grezzi["name"] == nome]["cap"], errors="coerce").dropna()
        capienza = int(cap.mode().iloc[0]) if len(cap) else 0

        punti = []
        for k in range(1, ORE_AVANTI + 1):
            t = ultimo + pd.Timedelta(hours=k)
            if not aperto(nome, t):
                continue
            key = (nome, t.dayofweek, t.hour)
            if key not in profilo.index:
                continue
            base = float(profilo.loc[key])
            # la correzione si spegne col passare delle ore
            peso = PESO_CORREZIONE * float(np.exp(-k / DECADIMENTO_ORE))
            stima = base + peso * scarto
            stima = max(0.0, min(100.0, stima))
            err = float(mae.get(nome, 12.0))
            punti.append({
                "ts": t.strftime("%Y-%m-%dT%H:00"),
                "occ": round(stima, 1),
                "min": round(max(0.0, stima - err), 1),
                "max": round(min(100.0, stima + err), 1),
                "liberi": int(round(capienza * (100.0 - stima) / 100.0)) if capienza else None,
            })

        strutture.append({
            "name": nome,
            "capacity": capienza,
            "mae_storico": round(float(mae.get(nome, float("nan"))), 1),
            "scarto_attuale": round(scarto, 1),
            "punti": punti,
        })

    strutture.sort(key=lambda s: s["name"])
    return {
        "meta": {
            "category": "parcheggi" if tipo == "park" else "ciclobox",
            "label": label,
            "emessa": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M"),
            "ultimo_dato": ultimo.strftime("%Y-%m-%dT%H:00"),
            "orizzonte_ore": ORE_AVANTI,
            "modello": "profilo giorno-settimana x ora, corretto con lo scostamento piu' recente",
            "nota": ("Previsione sperimentale e non ufficiale. La fonte dei dati e' il Comune di "
                     "Trento, la previsione no. L'errore tipico e' indicato per ogni parcheggio."),
        },
        "structures": strutture,
    }


def main():
    parks = pd.read_parquet(PARKS_PARQUET)
    os.makedirs(ARCHIVIO, exist_ok=True)

    for cfg in CATEGORIE:
        payload = prevedi_categoria(parks, cfg["type"], cfg["label"])
        if payload is None:
            print(f"{cfg['file']}: nessun dato, saltata")
            continue
        with open(DEST + cfg["file"], "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

        # copia archiviata: serve per misurare in seguito quanto ci si azzecca
        giorno = pd.Timestamp.now("UTC").strftime("%Y-%m-%d")
        nome_arch = f"{ARCHIVIO}{giorno}_{payload['meta']['category']}.json"
        with open(nome_arch, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

        n_punti = sum(len(s["punti"]) for s in payload["structures"])
        mae_medio = np.nanmean([s["mae_storico"] for s in payload["structures"]])
        print(f"{cfg['file']}: {len(payload['structures'])} strutture, {n_punti} ore previste, "
              f"errore tipico {mae_medio:.1f} punti")


if __name__ == "__main__":
    main()
