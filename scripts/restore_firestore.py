"""Ripristina un backup JSON di Firestore generato da backup_firestore.py.

Uso:
    py -3 scripts/restore_firestore.py backups/firestore-<ts>.json            # DRY-RUN (default)
    py -3 scripts/restore_firestore.py backups/firestore-<ts>.json --write    # scrive davvero

Il dry-run mostra quante scritture verrebbero eseguite senza toccare il DB.
Le scritture sono in batch da 500 (limite Firestore) con `set()`, quindi
SOVRASCRIVONO i documenti esistenti con lo stesso id (merge=False, per avere
uno stato identico al backup). I documenti presenti sul DB ma NON nel
backup non vengono cancellati: in quel caso fare prima una pulizia manuale.

Richiede:
    - py -3 -m pip install firebase-admin "google-cloud-firestore>=2.19,<2.20"
    - Service account: `scripts/serviceAccountKey.json` oppure env FIREBASE_SERVICE_ACCOUNT
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backup_firestore import DATABASE_ID, load_service_account  # noqa: E402

BATCH_SIZE = 500


def deserialize_value(value):
    """Ricostruisce i tipi Firestore dai tag __type__ del backup."""
    if isinstance(value, list):
        return [deserialize_value(v) for v in value]
    if isinstance(value, dict):
        tag = value.get("__type__")
        if tag == "timestamp":
            return datetime.fromisoformat(value["value"])
        if tag == "documentRef":
            return _make_ref(_client(), value["value"])
        if tag == "geoPoint":
            from google.cloud.firestore import GeoPoint

            return GeoPoint(value["latitude"], value["longitude"])
        if tag == "bytes":
            return base64.b64decode(value["value"])
        return {k: deserialize_value(v) for k, v in value.items()}
    return value


def _make_ref(client, path: str):
    """Crea un DocumentReference dal path 'collezione/doc/subcol/doc'."""
    parts = path.split("/")
    ref = client.collection(parts[0]).document(parts[1])
    i = 2
    while i < len(parts):
        ref = ref.collection(parts[i]).document(parts[i + 1])
        i += 2
    return ref


_client_cache = {}


def _client():
    """Client Firestore esplicito, creato una sola volta (lazy)."""
    if "db" not in _client_cache:
        import firebase_admin
        from firebase_admin import credentials
        from google.cloud.firestore import Client as FsClient

        info = load_service_account()
        project_id = str(info["project_id"]).strip()
        cred = credentials.Certificate(info)
        firebase_admin.initialize_app(cred, {"projectId": project_id})
        _client_cache["db"] = FsClient(
            project=project_id, credentials=cred.get_credential(), database=DATABASE_ID
        )
    return _client_cache["db"]


def collect_writes(node: dict, parent_ref):
    """Appiattisce l'albero del backup in una lista (ref, dati) da scrivere."""
    writes = []
    for doc_id, entry in node.items():
        data = {k: deserialize_value(v) for k, v in entry.items() if not k.startswith("_")}
        doc_ref = parent_ref.document(doc_id)
        writes.append((doc_ref, data))
        for sub_name, sub_docs in (entry.get("_subcollections") or {}).items():
            writes.extend(collect_writes(sub_docs, doc_ref.collection(sub_name)))
    return writes


def main() -> None:
    parser = argparse.ArgumentParser(description="Ripristina un backup JSON su Firestore.")
    parser.add_argument("backup", help="Percorso del file JSON generato da backup_firestore.py")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Esegue davvero le scritture (default: dry-run, solo conteggio)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.backup):
        sys.exit(f"ERRORE: file non trovato: {args.backup}")
    with open(args.backup, encoding="utf-8") as f:
        payload = json.load(f)

    meta = payload.get("_meta", {})
    print(
        f"Backup di {meta.get('project', '?')} dal {meta.get('startedAt', '?')} "
        f"({meta.get('totalDocuments', '?')} documenti)"
    )

    db = _client()
    all_writes = []
    for coll_name, docs in payload["data"].items():
        all_writes.extend(collect_writes(docs, db.collection(coll_name)))

    print(f"Scritture da eseguire: {len(all_writes)} documenti.")
    if not args.write:
        print("DRY-RUN: nessuna scrittura eseguita. Aggiungi --write per procedere.")
        return

    confirm = input("Sovrascrivere i documenti su Firestore? [scrivi 'SI' per confermare] ")
    if confirm.strip() != "SI":
        sys.exit("Annullato.")

    batch = db.batch()
    done = 0
    for ref, data in all_writes:
        batch.set(ref, data)
        done += 1
        if done % BATCH_SIZE == 0:
            batch.commit()
            print(f"  committati {done} documenti...")
            batch = db.batch()
    if done % BATCH_SIZE != 0:
        batch.commit()
    print(f"Ripristino completato: {done} documenti scritti.")


if __name__ == "__main__":
    main()
