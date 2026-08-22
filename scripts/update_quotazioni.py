"""Aggiorna le quotazioni attuali dei calciatori nel database Firestore
dal sito https://www.fantacalcio.it/quotazioni-fantacalcio.

Uso:
    py -3 scripts/update_quotazioni.py              # DRY-RUN: stampa riepilogo senza modifiche
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

SEASON = "2026-27"
URL = "https://www.fantacalcio.it/quotazioni-fantacalcio"

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")


def normalize_name(value: str) -> str:
    """Normalizza un nome per il confronto: minuscole, accent-folding, spazi."""
    n = unicodedata.normalize("NFKD", value)
    ascii_ = n.encode("ascii", "ignore").decode("ascii")
    ascii_ = ascii_.lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_).strip()


def fetch_quotazioni() -> list[dict]:
    """Scarica la pagina e restituisce [{nome, squadra, qi, qa}]."""
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
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        # Struttura reale tabella: 3 vuote | NOME | SQ | QI(classic) | QA(classic)
        # | FVM/1000(classic) | QI(mantra) | QA(mantra) | FVM/1000(mantra)
        # Vogliamo la QUOTAZIONE MANTRA → colonne 8 (QI) e 9 (QA).
        if len(cells) < 10 or not cells[3]:
            continue
        nome = cells[3]
        qi = cells[8]
        qa = cells[9]
        try:
            qi_num = float(qi.replace(",", "."))
            qa_num = float(qa.replace(",", "."))
        except ValueError:
            continue
        if not nome or qa_num <= 0:
            continue
        quotazioni.append({"nome": nome, "qi": qi_num, "qa": qa_num})
    return quotazioni


def find_match(nome_db: str, quotes) -> float | None:
    """Cerca la quotazione migliore con fuzzy matching >= 0.88."""
    best = None
    best_ratio = 0.0
    target = normalize_name(nome_db)
    for q in quotes:
        ratio = SequenceMatcher(None, target, q["nome_norm"]).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = q
    if best_ratio >= 0.88 and best:
        return best["qa"]
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggiornamento quotazioni da fantacalcio.it")
    parser.add_argument("--write", action="store_true",
                        help="Scrive su Firestore (default: solo dry-run)")
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("ERRORE: installa firebase-admin → py -3 -m pip install firebase-admin")

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
    print(f"✔ Estratte {len(quotes)} quotazioni.\n")

    quotes_norm = [
        {"nome": q["nome"], "nome_norm": normalize_name(q["nome"]),
         "qa": q["qa"], "qi": q["qi"]}
        for q in quotes
    ]

    players = build_db_index(db)
    print(f"✔ Trovati {len(players)} giocatori nel DB (stagione {SEASON}).\n")

    updated = []
    not_found = []
    for p in players:
        qa_new = find_match(p["name"], quotes_norm)
        if qa_new is None:
            not_found.append(p["name"])
            continue
        qi = p["qi"]
        vi = p["vi"]
        va = round(vi * (qa_new / qi) * 10) / 10 if qi else 0.0
        spesa = round(va * p["perc"] * 10) / 10
        updated.append({**p, "qa_new": qa_new, "va_new": va, "spesa_new": spesa})

    print(f"\n→ {len(updated)} giocatori con quota aggiornata.")
    if not_found:
        print(f"→ {len(not_found)} senza match (primi 10): {not_found[:10]}")

    if not args.write:
        print("\n=== DRY-RUN (nessuna scrittura) ===")
        for u in updated[:5]:
            print(f"  {u['name']}: Q.A. {u['qa_db']}→{u['qa_new']}, V.A. {u['va']}→{u['va_new']}")
        print("Esegui con --write per aggiornare Firestore.")
        return

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

    db.collection("auditLog").add({
        "timestamp": firestore.SERVER_TIMESTAMP,
        "leagueId": "main",
        "teamId": "",
        "adminId": "github-actions",
        "entityType": "player",
        "entityId": SEASON,
        "operation": "update",
        "fieldModified": "quotazioneAttuale",
        "valueBefore": None,
        "valueAfter": len(updated),
        "changeSummary": f"Aggiornamento quotazioni da fantacalcio.it ({len(updated)} giocatori)",
    })

    print(f"\n✔ Aggiornati {len(updated)} giocatori su Firestore.")


if __name__ == "__main__":
    main()