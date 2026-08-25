"""Backup completo del database Firestore in un file JSON.

Esporta ricorsivamente tutte le collection di primo livello (e le loro
subcollection) in un unico JSON con metadati (progetto, data, statistiche).
Lo script e' usato dal workflow GitHub Actions `.github/workflows/
backup-firestore.yml`, che committa il risultato sul branch `data-backups`.

Uso:
    py -3 scripts/backup_firestore.py                    # scrive backups/firestore-<timestamp>.json
    py -3 scripts/backup_firestore.py --out backup.json  # percorso di output personalizzato

Richiede:
    - py -3 -m pip install firebase-admin "google-cloud-firestore>=2.19,<2.20"
    - Service account: `scripts/serviceAccountKey.json` oppure env FIREBASE_SERVICE_ACCOUNT

Costi: le letture rientrano nel free tier Firestore (50k letture/giorno);
il DB di una lega di fantacalcio e' nell'ordine delle migliaia di documenti.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

DATABASE_ID = "(default)"

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")


def load_service_account() -> dict:
    """Carica la service account dal secret GitHub (env) o dal file locale."""
    if os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        raw = os.environ["FIREBASE_SERVICE_ACCOUNT"].strip()
        if (raw.startswith("'") and raw.endswith("'")) or (
            raw.startswith('"') and raw.endswith('"')
        ):
            raw = raw[1:-1]
        try:
            info = json.loads(raw)
        except json.JSONDecodeError:
            # Secret salvato con newlines escape (\n letterali nel JSON)
            info = json.loads(raw.replace("\\n", "\n"))
    elif os.path.exists(KEY_PATH):
        with open(KEY_PATH, encoding="utf-8") as f:
            info = json.load(f)
    else:
        sys.exit(
            "ERRORE: manca la service account "
            "(scripts/serviceAccountKey.json oppure env FIREBASE_SERVICE_ACCOUNT)."
        )

    project_id = str(info.get("project_id", "")).strip()
    if not project_id:
        sys.exit("ERRORE: la service account non contiene 'project_id'.")
    return info


def serialize_value(value):
    """Converte i tipi Firestore in tipi JSON-serializzabili."""
    import google.cloud.firestore as fs_types

    if isinstance(value, datetime):
        # Timestamp Firestore -> ISO 8601 UTC
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return {"__type__": "timestamp", "value": value.isoformat()}
    if isinstance(value, fs_types.DocumentReference):
        return {"__type__": "documentRef", "value": value.path}
    if isinstance(value, fs_types.GeoPoint):
        return {
            "__type__": "geoPoint",
            "latitude": value.latitude,
            "longitude": value.longitude,
        }
    if isinstance(value, bytes):
        import base64

        return {"__type__": "bytes", "value": base64.b64encode(value).decode("ascii")}
    if isinstance(value, list):
        return [serialize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    # Fallback: rappresentazione testuale (non dovrebbe mai servire)
    return str(value)


def export_collection(collection_ref) -> dict:
    """Esporta una collection come dict {docId: dati}, con subcollection annidate."""
    result: dict = {}
    count = 0
    for doc in collection_ref.stream():
        count += 1
        data = {k: serialize_value(v) for k, v in (doc.to_dict() or {}).items()}
        entry = {"_path": doc.id, **data}
        subs = {}
        for sub in doc.reference.collections():
            exported = export_collection(sub)
            subs[sub.id] = exported["docs"]
            count += exported["_count"]
        if subs:
            entry["_subcollections"] = subs
        result[doc.id] = entry
    return {"docs": result, "_count": count}


def _count_docs(node: dict) -> int:
    """Conteggio ricorsivo dei documenti in un dict esportato."""
    n = len(node)
    for entry in node.values():
        for sub in (entry.get("_subcollections") or {}).values():
            n += _count_docs(sub)
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup completo di Firestore in JSON.")
    parser.add_argument(
        "--out",
        default=None,
        help="Percorso del file JSON di output (default: backups/firestore-<timestamp>.json)",
    )
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import credentials
        from google.cloud.firestore import Client as FsClient
    except ImportError:
        sys.exit(
            "ERRORE: installa le dipendenze -> "
            'py -3 -m pip install firebase-admin "google-cloud-firestore>=2.19,<2.20"'
        )

    info = load_service_account()
    project_id = str(info["project_id"]).strip()
    cred = credentials.Certificate(info)
    firebase_admin.initialize_app(cred, {"projectId": project_id})
    print(f"Progetto Firestore: {project_id}")

    # Client esplicito con progetto e database indicati: alcune versioni di
    # google-cloud-firestore (2.20.x) codificano male "(default)".
    db = FsClient(project=project_id, credentials=cred.get_credential(), database=DATABASE_ID)

    started = datetime.now(timezone.utc)
    collections_out: dict = {}
    total_docs = 0
    for coll in db.collections():
        print(f"Export collection '{coll.id}'...")
        exported = export_collection(coll)
        collections_out[coll.id] = exported["docs"]
        total_docs += exported["_count"]
        print(f"  -> {exported['_count']} documenti")

    finished = datetime.now(timezone.utc)
    payload = {
        "_meta": {
            "project": project_id,
            "database": DATABASE_ID,
            "startedAt": started.isoformat(),
            "finishedAt": finished.isoformat(),
            "durationSeconds": round((finished - started).total_seconds(), 1),
            "totalDocuments": total_docs,
            "collections": {cid: _count_docs(docs) for cid, docs in collections_out.items()},
        },
        "data": collections_out,
    }

    out_path = args.out or os.path.join(
        "backups", f"firestore-{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Backup completato: {total_docs} documenti -> {out_path} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
