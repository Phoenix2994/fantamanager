"""
Migrazione: aggiunge acquistiMercatoInfrasettimanale = 0 ai documenti
seasonFinance/{season} già presenti su Firestore, senza toccare gli
altri campi (merge).

Uso:
    py -3 scripts/migrate_infrasettimanale.py            # dry-run
    py -3 scripts/migrate_infrasettimanale.py --write    # esegue
"""
import argparse
import os
import sys

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")
SEASON = "2026-27"
FIELD = "acquistiMercatoInfrasettimanale"


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrazione campo asta infrasettimanale")
    parser.add_argument("--write", action="store_true",
                        help="Esegue la scrittura (default: solo dry-run)")
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        sys.exit("ERRORE: installa firebase-admin →  py -3 -m pip install firebase-admin")

    if not os.path.exists(KEY_PATH):
        sys.exit(f"ERRORE: manca {KEY_PATH}")

    cred = credentials.Certificate(KEY_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    teams = db.collection("teams").stream()
    refs = []
    for team in teams:
        refs.append(team.reference.collection("seasonFinance").document(SEASON))

    print(f"Trovate {len(refs)} squadre. Documento: teams/{{id}}/seasonFinance/{SEASON}")

    if not args.write:
        print("DRY-RUN: nessuna scrittura. Rilancia con --write per applicare.")
        return

    batch = db.batch()
    ops = 0
    for ref in refs:
        batch.set(ref, {FIELD: 0}, merge=True)
        ops += 1
        if ops >= 450:
            batch.commit()
            batch = db.batch()
            ops = 0
    if ops > 0:
        batch.commit()

    print(f"Migrazione completata: {len(refs)} documenti aggiornati con {FIELD}=0 (merge).")


if __name__ == "__main__":
    main()