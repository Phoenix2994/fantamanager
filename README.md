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
        finance-section.ts     # Pannello spese (entrate/uscite/calcolati)
        history-section.ts     # Storico operazioni (auditLog)
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