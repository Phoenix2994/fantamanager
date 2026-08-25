# Fantacalcio Manageriale 2026-27

Web app Angular per la gestione collaborativa del fantacalcio manageriale della lega.
**Consultazione libera per tutti**, scrittura riservata a chi effettua il login con la
**password condivisa della lega** (accesso admin).

## Stack

- **Angular 20** (standalone components, signals) + **Angular Material**
- **Firebase Firestore** (@angular/fire) con persistenza offline (IndexedDB, multi-tab)
- **Firebase Authentication** con account condiviso tra gli admin
- Hosting: GitHub Pages / Firebase Hosting

## Struttura del progetto

```
src/app/
  core/
    models.ts                  # Interfacce Firestore (Player, Team, SeasonFinance, AuditLog…)
    finance-calculator.ts      # Formule pure: V.A., tasse a scaglioni, spese, bilanci
    guards/auth.guard.ts       # loginGuard (redirect se già autenticati)
    nav/
      nav-menu.ts              # Menù di navigazione principale (hamburger): Dashboard/Svincolati/Asta/Scambi
      page-shell.scss          # Stili condivisi delle pagine semplici (svincolati, scambi)
    services/
      auth.service.ts          # Login con password condivisa (account Firebase unico)
      team.service.ts          # CRUD squadre/giocatori/prestiti (realtime)
      finance.service.ts       # Spese stagionali + scaglioni fiscali
      audit.service.ts         # Feed storico operazioni
      team-selection.service.ts# Stato UI: squadra selezionata
  features/
    login/                     # Pagina di login (solo password)
    dashboard/                 # Shell responsive (desktop 3 col / tablet 2 col / mobile bottom-nav)
      sections/
        players-section.ts     # Rosa: filtri, ricerca fuzzy, tabella, prestiti
        svincolati-section.ts  # Svincolati (usato in dashboard e nella pagina dedicata)
        finance-section.ts     # Pannello spese (entrate/uscite/calcolati)
        history-section.ts     # Storico operazioni (auditLog)
    svincolati/                # Pagina dedicata /svincolati (voce del menù)
    asta/                      # Asta live /asta + vista TV /tv
    scambi/                    # Scambi tra squadre /scambi (placeholder)
firestore.rules                # Security rules Firestore
firestore.indexes.json         # Indici compositi (auditLog)
firebase.json                  # Config Firebase CLI (rules + hosting)
```

## Setup iniziale

### 1. Dipendenze

```bash
npm install
```

### 2. Configurazione Firebase

1. Crea un progetto su [console.firebase.google.com](https://console.firebase.google.com)
2. Aggiungi una **Web App** e copia la configurazione SDK
3. Incolla i valori in **entrambi** i file:
   - `src/environments/environment.ts`
   - `src/environments/environment.development.ts`

### 3. Account admin condiviso

Console Firebase → **Authentication** → Sign-in method → abilita **Email/Password**,
poi crea l'utente:

- Email: `admin@fantamanager.app` (o quella impostata in `environment.adminEmail`)
- Password: la password condivisa della lega

> La dashboard è pubblicamente accessibile in sola lettura: il pulsante "Accedi"
> nell'header apre la pagina di login riservata agli admin.

### 4. Database Firestore

Console Firebase → **Firestore Database** → crea il database (regione consigliata: `europe-west`).

### 5. Security rules e indici

Con la CLI Firebase (`npm i -g firebase-tools`, poi `firebase login`):

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Comandi

| Comando | Descrizione |
| --- | --- |
| `npm start` | Dev server su http://localhost:4200 |
| `npm run build` | Build di produzione in `dist/fantamanager/browser` |
| `npm test` | Unit test (Karma) |

## Backup di Firestore (gratuito)

Le "Scheduled Backups" native richiedono il piano Blaze (carta di credito):
qui si usa invece **GitHub Actions** (gratuito sui repo pubblici) con uno
script Python + firebase-admin, lo stesso stack del workflow quotazioni.

- **Workflow**: `.github/workflows/backup-firestore.yml` — cron giornaliero
  alle 02:30 UTC (+ lancio manuale dal tab Actions → *Run workflow*)
- **Script**: `scripts/backup_firestore.py` esporta ricorsivamente tutte le
  collection/subcollection in un JSON con metadati
- **Destinazione**: branch [`data-backups`](../../tree/data-backups), cartella
  `backups/`, con retention degli ultimi 90 snapshot (~3 mesi)
- **Segreto**: usa `FIREBASE_SERVICE_ACCOUNT`, lo stesso già configurato

Backup manuale locale:

```bash
py -3 -m pip install firebase-admin "google-cloud-firestore>=2.19,<2.20"
py -3 scripts/backup_firestore.py   # -> backups/firestore-<timestamp>.json
```

Ripristino (prima sempre in dry-run):

```bash
py -3 scripts/restore_firestore.py backups/firestore-<ts>.json          # dry-run
py -3 scripts/restore_firestore.py backups/firestore-<ts>.json --write  # scrive
```

> Nota: i costi sono zero (letture nel free tier Firestore, Actions gratuiti,
> repo GitHub come storage). I dati sono già pubblici in lettura secondo
> `firestore.rules`, quindi il branch dei backup non espone nulla di nuovo;
> la service account resta nei Secrets e mai nel repository.

## Modello dati (Firestore)

```
league/{leagueId}/taxBrackets/{bracketId}   # 6 scaglioni IRPEF-style
teams/{teamId}                              # 10 squadre
teams/{teamId}/players/{playerId}           # rose
teams/{teamId}/loanedPlayers/{loanId}       # ceduti in prestito
teams/{teamId}/seasonFinance/{season}       # es. "2026-27"
auditLog/{logId}                            # storico immutabile operazioni
```

### Formule implementate (`core/finance-calculator.ts`)

- `valoreAttuale = valoreIniziale × (quotazioneAttuale / quotazioneIniziale)`
- `prossimaSpesaRinnovo = valoreAttuale × prossimaPercRinnovo`
- Tasse progressive a 6 scaglioni con **ratchet**: mai sotto il massimo storico pagato
- `spesaAnnuale`, `spesaDaVersare` (con indennizzi), `spesaTotale`,
  `soldiDaVersare`, `valoreRosa`, `bilancioSocietarioStagionale`

## Roadmap

- [x] **Fase 1** — Scaffold, auth password condivisa, layout responsive, security rules
- [ ] **Fase 2** — CRUD giocatori/spese (dialog Material), Cloud Functions (audit log + ricalcoli)
- [ ] **Fase 3** — Polish UI responsive, card mobile, filtri storico avanzati
- [ ] **Fase 4** — GitHub Actions scraping quotazioni (Python/BeautifulSoup), import ROSE.xlsx
- [ ] **Fase 5** — Deploy GitHub Pages/Firebase Hosting, ottimizzazioni