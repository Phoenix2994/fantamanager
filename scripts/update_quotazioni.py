"""Aggiorna le quotazioni attuali dei calciatori nel database Firestore
dal sito https://www.fantacalcio.it/quotazioni-fantacalcio.

Inoltre raccoglie i GIOCATORI SVINCOLATI: calciatori presenti sul listone
di fantacalcio.it che non trovano corrispondenza (fuzzy) nelle rose del DB.
Vengono salvati in league/{leagueId}/svincolati/{playerId} con nome, ruolo
mantra, quotazione mantra e squadra.

Uso:
    py -3 scripts/update_quotazioni.py              # DRY-RUN: solo riepilogo
    py -3 scripts/update_quotazioni.py --write      # aggiorna Firestore

Richiede:
    - py -3 -m pip install firebase-admin requests beautifulsoup4
    - Service account: `scripts/serviceAccountKey.json` oppure env FIREBASE_SERVICE_ACCOUNT
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from difflib import SequenceMatcher

import requests
from bs4 import BeautifulSoup
from decimal import Decimal, ROUND_HALF_UP

SEASON = "2026-27"
LEAGUE_ID = "main"
URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")

# Mappatura codici ruolo fantacalcio.it -> ruoli usati nell'app
ROLE_MAP = {
    "por": "Por",
    "p": "Por",
    "dd": "Dd",
    "dc": "Dc",
    "ds": "Ds",
    "b": "B",
    "m": "M",
    "c": "C",
    "e": "E",
    "w": "W",
    "t": "T",
    "a": "A",
    "pc": "Pc",
}


def normalize_name(value: str) -> str:
    """Normalizza un nome per il confronto: minuscole, accent-folding, spazi."""
    n = unicodedata.normalize("NFKD", value)
    ascii_ = n.encode("ascii", "ignore").decode("ascii")
    ascii_ = ascii_.lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_).strip()


def slugify(value: str) -> str:
    """Nome normalizzato come ID documento deterministico."""
    return normalize_name(value).replace(" ", "-")


def round_half_up(x: float, ndigits: int = 1) -> float:
    """Arrotonda HALF UP (come ROUND di Excel); Python round() usa
    banker's rounding (round(2.5)=2) e qui non va bene."""
    quantum = Decimal("0.1") if ndigits == 1 else Decimal("0.01")
    return float(Decimal(str(x)).quantize(quantum, rounding=ROUND_HALF_UP))


def fetch_quotazioni() -> list[dict]:
    """Scarica la pagina e restituisce [{nome, squadra, ruolo, qi, qa}]."""
    response = requests.get(
        URL,
        timeout=30,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
            ),
            "Accept-Language": "it-IT,it;q=0.9",
        },
    )
    response.encoding = "utf-8"
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code} da {URL}")

    soup = BeautifulSoup(response.text, "html.parser")
    quotazioni = []
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        texts = [c.get_text(strip=True) for c in cells]
        # Struttura: [championship] | ruolo-classic | ruolo-mantra | NOME | SQ
        # | QI(classic) | QA(classic) | FVM(classic) | QI(mantra) | QA(mantra) | FVM(mantra)
        if len(cells) < 10 or not texts[3]:
            continue

        nome = texts[3]
        squadra = texts[4]

        # Ruolo mantra: fino a 3 span .role nella cella 2, uniti con ";"
        ruoli: list[str] = []
        for role_span in cells[2].find_all("span", class_="role"):
            mapped = ROLE_MAP.get((role_span.get("data-value") or "").lower())
            if mapped and mapped not in ruoli:
                ruoli.append(mapped)
        ruolo = ";".join(ruoli)

        qi = texts[8]
        qa = texts[9]
        try:
            qi_num = float(qi.replace(",", "."))
            qa_num = float(qa.replace(",", "."))
        except ValueError:
            continue
        # I giocatori con asterisco nel nome non sono svincolabili:
        # vengono esclusi dalla lista quotazioni/svincolati
        if not nome or qa_num <= 0 or "*" in nome:
            continue
        quotazioni.append(
            {"nome": nome, "squadra": squadra, "ruolo": ruolo, "qi": qi_num, "qa": qa_num}
        )
    return quotazioni


def find_match(nome_db: str, quotes) -> int | None:
    """Cerca l'indice della quotazione migliore con fuzzy matching >= 0.88."""
    best_idx = None
    best_ratio = 0.0
    target = normalize_name(nome_db)
    for i, q in enumerate(quotes):
        ratio = SequenceMatcher(None, target, q["nome_norm"]).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_idx = i
    if best_ratio >= 0.88 and best_idx is not None:
        return best_idx
    return None


def build_db_index(db):
    """Legge tutti i giocatori della stagione dal DB (team, ref, campi)."""
    players = []
    teams = db.collection("teams").stream()
    for team in teams:
        team_id = team.id
        season = team.reference.collection("seasons").document(SEASON)
        for player in season.collection("players").stream():
            data = player.to_dict()
            players.append({
                "team_id": team_id,
                "ref": player.reference,
                "name": data.get("name", ""),
                "qi": float(data.get("quotazioneIniziale", 0) or 0),
                "vi": float(data.get("valoreIniziale", 0) or 0),
                "va": float(data.get("valoreAttuale", 0) or 0),
                "qa_db": float(data.get("quotazioneAttuale", 0) or 0),
                "perc": float(data.get("prossimaPercRinnovo", 0) or 0),
            })
    return players


def sync_svincolati(db, svincolati: list[dict]) -> None:
    """Sincronizza league/{leagueId}/svincolati: cancella i documenti
    esistenti e scrive la lista corrente (ID deterministico = slug nome)."""
    from firebase_admin import firestore

    ref = db.collection("league").document(LEAGUE_ID).collection("svincolati")

    batch = db.batch()
    count = 0

    # Cancella tutti i documenti esistenti
    for d in ref.stream():
        batch.delete(d.reference)
        count += 1
        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0

    # Scrive i nuovi svincolati
    for s in svincolati:
        batch.set(
            ref.document(slugify(s["name"])),
            {
                **s,
                "season": SEASON,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        count += 1
        if count >= 400:
            batch.commit()
            batch = db.batch()
            count = 0

    if count:
        batch.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggiornamento quotazioni da fantacalcio.it")
    parser.add_argument("--write", action="store_true",
                        help="Scrive su Firestore (default: solo dry-run)")
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("ERRORE: installa firebase-admin -> py -3 -m pip install firebase-admin")

    if os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        cred = credentials.Certificate(json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"]))
    elif os.path.exists(KEY_PATH):
        cred = credentials.Certificate(KEY_PATH)
    else:
        sys.exit("ERRORE: manca la service account (scripts/serviceAccountKey.json o in env).")

    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print("Fetch quotazioni...")
    quotes = fetch_quotazioni()
    print(f"Estratte {len(quotes)} quotazioni.")

    quotes_norm = [{**q, "nome_norm": normalize_name(q["nome"])} for q in quotes]

    players = build_db_index(db)
    print(f"Trovati {len(players)} giocatori nel DB (stagione {SEASON}).")

    updated = []
    matched_quote_idx: set[int] = set()
    not_found_db = []
    for p in players:
        idx = find_match(p["name"], quotes_norm)
        if idx is None:
            not_found_db.append(p["name"])
            continue
        matched_quote_idx.add(idx)
        q = quotes_norm[idx]
        qi = p["qi"]
        vi = p["vi"]
        # V.A. e spesa rinnovo mai sotto 0.10 €, arrotondamento half up
        va = max(round_half_up(vi * (q["qa"] / qi), 1) if qi else 0.0, 0.1)
        spesa = max(round_half_up(va * p["perc"], 1), 0.1)
        updated.append({**p, "qa_new": q["qa"], "va_new": va, "spesa_new": spesa})

    # Svincolati: quote della fonte NON matchate da nessun giocatore del DB.
    # Nome in MAIUSCOLO (come nella sezione squadre).
    svincolati = [
        {
            "name": q["nome"].upper(),
            "ruolo": q["ruolo"],
            "quotazioneAttuale": q["qa"],
            "squadra": q["squadra"],
        }
        for i, q in enumerate(quotes_norm)
        if i not in matched_quote_idx
    ]
    svincolati.sort(key=lambda s: -s["quotazioneAttuale"])

    print()
    print(f"{len(updated)} giocatori con quota aggiornata.")
    print(f"{len(svincolati)} svincolati (in listone ma non in nessuna rosa).")
    if not_found_db:
        print(f"{len(not_found_db)} giocatori DB senza match nel listone (primi 10): {not_found_db[:10]}")

    if not args.write:
        print()
        print("=== DRY-RUN (nessuna scrittura) ===")
        for u in updated[:5]:
            print(f"  {u['name']}: Q.A. {u['qa_db']}->{u['qa_new']}, V.A. {u['va']}->{u['va_new']}")
        print()
        print("Svincolati (primi 10, ordinati per quotazione):")
        for s in svincolati[:10]:
            print(f"  {s['name']} ({s['ruolo'] or '?'}, {s['squadra']}) - {s['quotazioneAttuale']}")
        print()
        print("Esegui con --write per aggiornare Firestore.")
        return

    # Scrittura quotazioni rose (batch)
    batch = db.batch()
    count = 0
    for u in updated:
        batch.set(u["ref"], {
            "quotazioneAttuale": u["qa_new"],
            "valoreAttuale": u["va_new"],
            "prossimaSpesaRinnovo": u["spesa_new"],
        }, merge=True)
        count += 1
        if count >= 450:
            batch.commit()
            batch = db.batch()
            count = 0
    if count:
        batch.commit()

    # Sincronizzazione svincolati
    sync_svincolati(db, svincolati)

    # audit
    db.collection("auditLog").add({
        "timestamp": firestore.SERVER_TIMESTAMP,
        "leagueId": LEAGUE_ID,
        "teamId": "",
        "adminId": "github-actions",
        "entityType": "player",
        "entityId": SEASON,
        "operation": "update",
        "fieldModified": "quotazioneAttuale",
        "valueBefore": None,
        "valueAfter": {"aggiornati": len(updated), "svincolati": len(svincolati)},
        "changeSummary":
            f"Aggiornamento quotazioni da fantacalcio.it "
            f"({len(updated)} giocatori, {len(svincolati)} svincolati)",
    })

    print()
    print(f"Aggiornati {len(updated)} giocatori e sincronizzati {len(svincolati)} svincolati.")


if __name__ == "__main__":
    main()