"""
Cache busting degli asset del sito.

Il problema: i browser (e la CDN di GitHub Pages) tengono in cache
assets/js/dashboard.js e gli altri file per un po'. Se il contenuto cambia ma
il nome resta lo stesso, un visitatore puo' ritrovarsi con l'HTML nuovo e il
JavaScript vecchio: e' successo davvero, e il risultato erano i filtri delle
statistiche che non rispondevano.

La soluzione: accodare a ogni riferimento locale una firma del contenuto
(?v=<hash>). Se il file non cambia, la firma non cambia e la cache continua a
fare il suo mestiere; se cambia, l'URL cambia e il browser e' costretto a
riscaricarlo.

Lo script e' idempotente: si puo' rilanciare quante volte si vuole.
"""

import os
import re
import hashlib

RADICE = "docs"
ESTENSIONI = (".js", ".css")

# Riferimenti locali dentro src="..." o href="...", con eventuale ?v=... gia' presente
RIF = re.compile(r'((?:src|href)=")([^"?#>]+\.(?:js|css))(?:\?v=[0-9a-f]+)?(")')


def firma(percorso):
    h = hashlib.md5()
    with open(percorso, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:8]


def risolvi(pagina, riferimento):
    """Dal riferimento relativo nell'HTML al file su disco."""
    if riferimento.startswith(("http://", "https://", "//")):
        return None
    return os.path.normpath(os.path.join(os.path.dirname(pagina), riferimento))


def main():
    pagine = []
    for cartella, _, files in os.walk(RADICE):
        for nome in files:
            if nome.endswith(".html"):
                pagine.append(os.path.join(cartella, nome))

    cache_firme = {}
    totale = 0
    for pagina in sorted(pagine):
        testo = open(pagina, encoding="utf-8").read()
        modificati = []

        def sostituisci(m):
            nonlocal modificati
            prefisso, rif, suffisso = m.group(1), m.group(2), m.group(3)
            percorso = risolvi(pagina, rif)
            if not percorso or not os.path.isfile(percorso):
                return m.group(0)   # esterno o inesistente: lasciato com'e'
            if percorso not in cache_firme:
                cache_firme[percorso] = firma(percorso)
            modificati.append(rif)
            return f"{prefisso}{rif}?v={cache_firme[percorso]}{suffisso}"

        nuovo = RIF.sub(sostituisci, testo)
        if nuovo != testo:
            open(pagina, "w", encoding="utf-8").write(nuovo)
            totale += len(modificati)
            print(f"{pagina}: {len(modificati)} riferimenti firmati")

    print(f"\nfirmati {totale} riferimenti su {len(pagine)} pagine")


if __name__ == "__main__":
    main()
