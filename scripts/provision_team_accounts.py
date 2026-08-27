"""Crea (o ripara) un account Firebase Authentication per ogni squadra.

Per ogni documento in `teams`:
  1. Genera l'email deterministica squadra-<slug-nome>@fantamanager.app
     (STESSA regola di `teamLoginEmail()` in src/app/core/services/
     auth.service.ts — se una delle due cambia, va cambiata anche l'altra).
  2. Crea l'utente Firebase Auth se non esiste già (email/password), con
     una password casuale.
  3. Scrive `ownerUid` sul documento `teams/{id}` (Admin SDK: bypassa le
     security rules, che infatti impediscono ai client di scriverlo).

Idempotente: si può rilanciare in sicurezza. Se l'utente esiste già ma
`ownerUid` non è impostato (o punta a un uid diverso), lo sistema senza
toccare la password esistente. Le password vengono mostrate SOLO alla
creazione (Firebase non le rende mai leggibili in seguito) e salvate in
locale in scripts/team-credentials.local.json — MAI committare quel file
(già in .gitignore): consegna le credenziali a ciascuna squadra e poi
considera il file "carta bruciata", non serve conservarlo.

Uso:
    py -3 scripts/provision_team_accounts.py                # crea/ripara tutte le squadre
    py -3 scripts/provision_team_accounts.py --dry-run       # mostra solo cosa farebbe

Richiede:
    - py -3 -m pip install firebase-admin "google-cloud-firestore>=2.19,<2.20"
    - Service account: scripts/serviceAccountKey.json (vedi backup_firestore.py)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import unicodedata

DATABASE_ID = "(default)"

KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")
CREDENTIALS_OUT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "team-credentials.local.json"
)


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


def slugify(value: str) -> str:
    """Stessa regola di slugify() in src/app/core/text-utils.ts."""
    normalized = unicodedata.normalize("NFD", value.lower())
    without_diacritics = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", " ", without_diacritics).strip()
    return re.sub(r"\s+", "-", slug)


def team_login_email(team_name: str) -> str:
    """Stessa regola di teamLoginEmail() in auth.service.ts."""
    return f"squadra-{slugify(team_name)}@fantamanager.app"


def main() -> None:
    parser = argparse.ArgumentParser(description="Provisioning account Firebase per squadra.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mostra solo cosa farebbe, senza creare account né scrivere su Firestore.",
    )
    args = parser.parse_args()

    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth
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
    db = FsClient(project=project_id, credentials=cred.get_credential(), database=DATABASE_ID)

    print(f"Progetto Firestore: {project_id}{'  (dry-run)' if args.dry_run else ''}")

    teams = list(db.collection("teams").stream())
    if not teams:
        sys.exit("Nessuna squadra trovata in teams/.")

    nuove_credenziali: dict[str, dict[str, str]] = {}
    riparate = 0
    invariate = 0

    for team_doc in teams:
        team = team_doc.to_dict() or {}
        name = str(team.get("name", "")).strip()
        if not name:
            print(f"  ! salto {team_doc.id}: manca il campo 'name'")
            continue

        email = team_login_email(name)
        current_owner_uid = team.get("ownerUid")

        # 1. Trova o crea l'utente Firebase Auth
        try:
            user = fb_auth.get_user_by_email(email)
            existed = True
        except fb_auth.UserNotFoundError:
            existed = False
            user = None

        password = None
        if not existed:
            password = secrets.token_urlsafe(9)
            print(f"  + {name}: creo {email}")
            if not args.dry_run:
                user = fb_auth.create_user(email=email, password=password)
            nuove_credenziali[team_doc.id] = {
                "squadra": name,
                "email": email,
                "password": password,
            }
        elif current_owner_uid == user.uid:
            invariate += 1
            continue
        else:
            print(f"  ~ {name}: account già esistente ({email}), sistemo ownerUid")
            riparate += 1

        # 2. Allinea ownerUid sul documento squadra (solo Admin SDK può farlo)
        if not args.dry_run and user is not None:
            team_doc.reference.update({"ownerUid": user.uid})

    print(
        f"\nRiepilogo: {len(nuove_credenziali)} nuovi account, "
        f"{riparate} riparati, {invariate} già a posto."
    )

    if nuove_credenziali and not args.dry_run:
        with open(CREDENTIALS_OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(nuove_credenziali, f, ensure_ascii=False, indent=2)
        print(f"Credenziali dei nuovi account salvate in {CREDENTIALS_OUT_PATH}")
        print("Consegnale alle rispettive squadre, poi puoi cancellare il file: NON è recuperabile in seguito.")
    elif nuove_credenziali:
        print("(dry-run: nessuna credenziale creata davvero)")


if __name__ == "__main__":
    main()
