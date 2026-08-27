"""Reimposta la password di uno o più account squadra.

Le email delle squadre sono FITTIZIE (squadra-<slug>@fantamanager.app, non
recapitano davvero — vedi provision_team_accounts.py): il classico "invio
email di reset password" di Firebase NON funziona, perché quell'email non
arriva da nessuna parte. Niente da fare nemmeno dalla Console Firebase:
per gli account email/password la Console offre solo "invia email di reset"
(mai un campo per digitare direttamente la nuova password — scelta di
sicurezza di Google, impostarla direttamente resta un'operazione Admin SDK).
L'unico modo è impostare direttamente una nuova password via Admin SDK, che
è esattamente quello che fa questo script.

NOTA TECNICA sulla fonte dei dati squadra (id/nome/email): usa PRIMA
scripts/team-credentials.local.json (se una squadra è già lì, zero
chiamate di rete per trovarla) e interroga Firestore SOLO per le squadre
mancanti in quel file. Due motivi:
  1. Firestore ha una quota di lettura giornaliera (piano gratuito: 50k/
     giorno) che con un uso intenso dell'app si esaurisce — quando succede,
     il client gRPC standard (google-cloud-firestore) fa retry automatico
     con backoff invece di dare un errore, e lo script sembra bloccato
     all'infinito. Passando dal file locale, quando possibile, si evita
     del tutto il problema.
  2. Quando serve davvero interrogare Firestore, questo script usa comunque
     l'API REST (HTTPS semplice, con un token della service account) invece
     del client gRPC, così un'eventuale quota esaurita dà subito un errore
     leggibile invece di un blocco silenzioso.

Le password le scegli TU: per ogni squadra da resettare lo script te la
chiede a schermo (visibile mentre digiti, per poterla rileggere/correggere
— è un tool ad uso personale, non un form di produzione). Nessuna
generazione automatica.

Uso:
    py -3 scripts/reset_team_password.py "Nome Squadra"
        Chiede la nuova password per quella squadra e la imposta
        (richiede un terminale interattivo vero — vedi sotto --set se il
        tuo terminale non mostra/accetta il prompt).

    py -3 scripts/reset_team_password.py "Nome Squadra" --password "nuovaPwd123"
        Salta la domanda: imposta direttamente la password indicata sulla
        riga di comando.

    py -3 scripts/reset_team_password.py --set "Nome Squadra 1" "password1" --set "Nome Squadra 2" "password2"
        Modalità NON interattiva: tutte le coppie squadra/password sulla
        riga di comando (ripeti --set quante volte serve). Nessuna
        domanda a schermo.

    py -3 scripts/reset_team_password.py --all
        Chiede, UNA SQUADRA ALLA VOLTA, la nuova password da impostare per
        ciascuna delle squadre già presenti in team-credentials.local.json
        (mai la stessa password ripetuta automaticamente per tutte).

    py -3 scripts/reset_team_password.py "Nome Squadra" --dry-run
        Mostra solo cosa farebbe (chiede comunque la password, per provare
        il flusso), senza toccare Firebase Auth.

Le nuove credenziali vengono salvate/aggiornate in
scripts/team-credentials.local.json (MAI committare quel file, già in
.gitignore): consegnale alla squadra interessata, poi considera il file
"carta bruciata" — non serve conservarlo dopo la consegna.

Richiede:
    - py -3 -m pip install firebase-admin requests
    - Service account: scripts/serviceAccountKey.json (vedi backup_firestore.py)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from provision_team_accounts import load_service_account, team_login_email  # noqa: E402

MIN_PASSWORD_LEN = 6  # minimo richiesto da Firebase Auth
REST_TIMEOUT_SECONDS = 15  # fallisce chiaramente invece di restare appeso

CREDENTIALS_OUT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "team-credentials.local.json"
)


def carica_credenziali_esistenti() -> dict[str, dict[str, str]]:
    """Le credenziali già salvate in locale (se il file esiste), da aggiornare senza perdere le altre squadre."""
    if os.path.exists(CREDENTIALS_OUT_PATH):
        with open(CREDENTIALS_OUT_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def leggi_squadre_via_rest(project_id: str, google_cred) -> list[dict[str, str]]:
    """Elenco squadre (id + name) via API REST di Firestore — usata SOLO per le squadre non già note in locale."""
    import requests
    from google.auth.transport.requests import Request as GoogleAuthRequest

    google_cred.refresh(GoogleAuthRequest())
    headers = {"Authorization": f"Bearer {google_cred.token}"}

    squadre: list[dict[str, str]] = []
    base_url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/teams"
    page_token = None

    while True:
        params = {"pageSize": 100}
        if page_token:
            params["pageToken"] = page_token
        try:
            resp = requests.get(base_url, params=params, headers=headers, timeout=REST_TIMEOUT_SECONDS)
        except requests.exceptions.RequestException as e:
            sys.exit(f"ERRORE di rete leggendo le squadre (REST): {e}")
        if resp.status_code != 200:
            sys.exit(
                f"ERRORE leggendo le squadre da Firestore (HTTP {resp.status_code}): {resp.text[:300]}\n"
                "Se il codice è 429 (quota esaurita) e la squadra che ti serve è già in "
                "team-credentials.local.json, non dovresti nemmeno arrivare qui: controlla il nome "
                "digitato (deve combaciare esattamente col campo 'squadra' nel file)."
            )

        data = resp.json()
        for doc in data.get("documents", []):
            doc_id = doc["name"].rsplit("/", 1)[-1]
            name = doc.get("fields", {}).get("name", {}).get("stringValue", "")
            squadre.append({"id": doc_id, "name": name})

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return squadre


def chiedi_password(nome_squadra: str) -> str:
    """Richiede la nuova password a schermo, ripetendo finché non è valida (Firebase: minimo 6 caratteri).

    Il prompt viene scritto con print(..., flush=True) invece di passarlo a
    input(): in alcuni terminali (es. se stdout non è un vero tty — capita
    con certi terminali integrati) il prompt interno di input() non viene
    mostrato finché non arriva un flush esplicito, e lo script sembra
    "bloccato" mentre in realtà sta già aspettando la risposta.
    """
    while True:
        print(f'Nuova password per "{nome_squadra}" (min. {MIN_PASSWORD_LEN} caratteri): ', end="", flush=True)
        valore = input().strip()
        if len(valore) >= MIN_PASSWORD_LEN:
            return valore
        print(f"  troppo corta ({len(valore)} caratteri), riprova.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reimposta la password di un account squadra.")
    parser.add_argument(
        "team_name",
        nargs="?",
        help='Nome esatto della squadra (come in Firestore, es. "Phoenix"). Omesso se usi --all.',
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Nuova password da impostare, senza chiederla a schermo (solo con una squadra sola, non con --all).",
    )
    parser.add_argument(
        "--set",
        nargs=2,
        action="append",
        metavar=("SQUADRA", "PASSWORD"),
        help='Modalità non interattiva: coppia "Nome Squadra" "password" (ripetibile). Ignora team_name/--all/--password.',
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Reimposta la password di tutte le squadre note in locale, una alla volta (te la chiede per ciascuna).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Mostra solo cosa farebbe, senza modificare Firebase Auth.",
    )
    args = parser.parse_args()

    if not args.set:
        if not args.all and not args.team_name:
            sys.exit("ERRORE: indica il nome della squadra, usa --all, oppure --set.")
        if args.all and args.password:
            sys.exit("ERRORE: --password non è compatibile con --all (imposterebbe la STESSA password per tutte).")

    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth
        from firebase_admin import credentials
        import requests  # noqa: F401  (usata in leggi_squadre_via_rest)
    except ImportError:
        sys.exit("ERRORE: installa le dipendenze -> py -3 -m pip install firebase-admin requests")

    info = load_service_account()
    project_id = str(info["project_id"]).strip()
    cred = credentials.Certificate(info)
    firebase_admin.initialize_app(cred, {"projectId": project_id})

    print(f"Progetto Firestore: {project_id}{'  (dry-run)' if args.dry_run else ''}")

    credenziali = carica_credenziali_esistenti()

    # Fonte primaria: il file locale (id -> {squadra, email, password}), zero rete.
    squadre_per_nome: dict[str, dict[str, str]] = {
        v.get("squadra", ""): {
            "id": team_id,
            "name": v.get("squadra", ""),
            "email": v.get("email") or team_login_email(v.get("squadra", "")),
        }
        for team_id, v in credenziali.items()
        if v.get("squadra")
    }

    # Nomi che ci servono per questa esecuzione
    if args.set:
        nomi_richiesti = {nome for nome, _ in args.set}
    elif args.all:
        nomi_richiesti = set(squadre_per_nome)  # solo quelle già note in locale
    else:
        nomi_richiesti = {args.team_name}

    mancanti = nomi_richiesti - set(squadre_per_nome)
    if mancanti:
        print(f"Squadre non ancora nel file locale, le cerco su Firestore: {', '.join(mancanti)}")
        teams_remote = leggi_squadre_via_rest(project_id, cred.get_credential())
        for t in teams_remote:
            squadre_per_nome.setdefault(
                t["name"], {"id": t["id"], "name": t["name"], "email": team_login_email(t["name"])}
            )
        ancora_mancanti = nomi_richiesti - set(squadre_per_nome)
        if ancora_mancanti:
            nomi_esistenti = ", ".join(t["name"] for t in teams_remote) or "(nessuna)"
            sys.exit(f"ERRORE: squadre non trovate: {', '.join(ancora_mancanti)}. Squadre esistenti: {nomi_esistenti}")

    da_resettare = [squadre_per_nome[nome] for nome in nomi_richiesti]

    password_per_nome: dict[str, str] = {}
    if args.set:
        for nome, pwd in args.set:
            if len(pwd) < MIN_PASSWORD_LEN:
                sys.exit(f'ERRORE: la password per "{nome}" ha solo {len(pwd)} caratteri (minimo {MIN_PASSWORD_LEN}).')
            password_per_nome[nome] = pwd

    fatte = 0

    for team in da_resettare:
        name = team["name"]
        email = team["email"]
        try:
            user = fb_auth.get_user_by_email(email)
        except fb_auth.UserNotFoundError:
            print(f"  ! {name}: nessun account Auth per {email} — esegui prima provision_team_accounts.py")
            continue

        if args.set:
            nuova_password = password_per_nome[name]
        elif args.password:
            nuova_password = args.password
        else:
            nuova_password = chiedi_password(name)
        print(f"  ~ {name}: reimposto la password di {email}")
        if not args.dry_run:
            fb_auth.update_user(user.uid, password=nuova_password)

        credenziali[team["id"]] = {"squadra": name, "email": email, "password": nuova_password}
        fatte += 1

    print(f"\nRiepilogo: {fatte} password reimpostate.")

    if fatte and not args.dry_run:
        with open(CREDENTIALS_OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(credenziali, f, ensure_ascii=False, indent=2)
        print(f"Credenziali aggiornate in {CREDENTIALS_OUT_PATH}")
        print("Consegnale alle rispettive squadre, poi considera il file \"carta bruciata\".")
    elif fatte:
        print("(dry-run: nessuna password modificata davvero)")


if __name__ == "__main__":
    main()
