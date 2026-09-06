# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Angular web app for running a friend group's "fantacalcio manageriale" (fantasy football manager) league: rosters, season finances, a live auction with a TV display, trades, free-agent lists, prize pool, and an audit/undo history. Reading is public; writing requires a login (shared admin password, or per-team accounts — see Auth model below).

## Commands

```bash
npm start                  # dev server, http://localhost:4200
npm run build               # production build -> dist/fantamanager/browser
npm run build:prod          # same, with --base-href=/fantamanager/ (GitHub Pages deploy)
npm test                    # Karma/Jasmine, watches by default
ng test --watch=false       # single run (use this for CI-style checks)
ng test --include='**/finance-calculator.spec.ts'   # run a single spec file
```

There is no lint script configured. There is no e2e config — a `ng build` plus manual/live verification is the standard way to check UI or service changes (see Testing below).

Firestore rules/indexes, after editing `firestore.rules` or `firestore.indexes.json`:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Deploy to GitHub Pages happens automatically via `.github/workflows/deploy-pages.yml` on every push to `main` (runs `npm run build:prod` then publishes to the `gh-pages` branch) — pushing to `main` **is** the deploy step, there's no separate manual deploy for normal changes. `npm run deploy` (`angular-cli-ghpages`) exists for a manual one-off push of a local `dist/` build.

## Architecture

### Stack

Angular 20 (standalone components, signals, no NgModules) + Angular Material, on Firebase: Firestore (`@angular/fire`, modular SDK) for data, Firebase Auth for login. No backend server — all writes go directly from the client to Firestore under `firestore.rules`.

### Auth model — three tiers, enforced in `firestore.rules`, not just in the UI

- **Admin**: the shared league password (`environment.adminEmail`, or a team-owner uid listed in `environment.legaAdminUids`) signed in via email/password. Can write rosters, finances, league config, confirm trades, open/assign the auction.
- **Team owner**: a per-team email/password account (`teams/{teamId}.ownerUid`, written only by `scripts/provision_team_accounts.py`, never by the client). Can bid in the live auction as that team, create trade drafts involving that team, and read/write that team's private `teamNotes` (svincolati star ratings/notes).
- **Anonymous**: auto-signed-in visitors bidding in the auction without an account. `isAuthenticated()` (anon included) gates auction bids and audit-log writes; `isAdmin()` gates everything sensitive; `isTeamOwner(teamId)` is a real server-side check via `get()`, unlike the client-side "which team am I" picker used for anonymous bidders.

`environment.adminEmail` / `environment.legaAdminUids` and the corresponding checks in `firestore.rules` (`isAdmin()`) are **duplicated by hand** — there is no way for rules to read `environment.ts`, so changing one requires changing the other.

### Firestore layout

```
league/{leagueId}                          # league config, taxBrackets, svincolati (free agents)
teams/{teamId}                             # one doc per team (10 teams)
teams/{teamId}/seasons/{season}/players    # roster, season is e.g. "2026-27"
teams/{teamId}/loanedPlayers                # players out on loan
teams/{teamId}/seasonFinance/{season}      # computed + input finance fields, one doc per season
asta/statoCorrente                          # SINGLE doc driving the whole live auction + /tv view
scambi/{scambioId}                          # trade drafts -> ufficializzata -> confermata/annullata
auditLog/{logId}                            # append-only history (update/delete always denied)
undoLog/{logId}                             # reversible-operation snapshots (see Undo below)
teamNotes/{teamId}/svincolati/{id}          # private per-team star ratings/notes on free agents
```

Reads are public everywhere; writes are locked down per the auth model above (see `firestore.rules` for the exact per-collection rules and their rationale — the comments there explain several non-obvious constraints).

### Core calculators — pure functions, no I/O, this is where the domain logic lives

`src/app/core/*-calculator.ts` (`finance-calculator.ts`, `scambi-calculator.ts`, `scambi-avanzati-calculator.ts`, `estrazioni-calculator.ts`, `undo-calculator.ts`) hold the actual rules of the league as pure, independently-testable functions. Services call these and then perform the Firestore writes. This split is why these are the only files with meaningful spec coverage (see Testing).

Key conventions to know before touching finance:
- `valoreAttuale = valoreIniziale × (quotazioneAttuale / quotazioneIniziale)`.
- Renewal percentages escalate through a fixed table (`PROSSIMA_PERC_MAP` in `finance-calculator.ts`): 60→85→115→155→215→290→400→550→760%, then stable.
- Taxes are progressive across `taxBrackets` with a **ratchet**: `applicaTassaMinimaStorica` never lets the tax owed drop below the historic max (`taxMinimumHistoric`), even though the taxable base (`spesaAnnuale`) itself is always recomputed fresh and can legitimately go down (e.g. after selling a player).
- `valoreIniziale`/`valoreAttuale` (V.I./V.A.) are always rounded to **1 decimal** (`round1`); most other money math uses `round2`. The advanced-trade calculator computes internally at 2-decimal precision and must be re-rounded to `round1` wherever its output becomes a V.I./V.A. write.
- Trade balancing (`scambi-calculator.ts`): the richer side's players go up in value by the difference, distributed proportionally to current quotazione, with rounding remainder assigned to the highest-quotazione player. A player can be sold for cash alone; his value only increases (never decreases) to match what was paid.

### Mantra roles (`core/roles.ts`)

`ROLE_ORDER` is the canonical role sequence (`Por, Dc, B, Dd, Ds, E, M, C, W, T, A, Pc`). Players can hold up to 3 roles as a `;`-joined string (e.g. `"Dd;Dc"`). `compareRuoli(a, b)` — used everywhere players are listed by role — sorts each player's own role indices ascending and compares the two sequences **lexicographically** (first role decides, ties fall through to the next), not by a single "best" or "worst" role number; this is what makes e.g. `Dd;Dc` sort right after pure `Dc` but `E;W` sort before `M;C`. `splitRoles`/role display order is unrelated and just preserves whatever order is stored in the `ruolo` string.

### The live auction (`asta.service.ts` + `features/asta/`)

Everything hangs off one Firestore document, `asta/statoCorrente`: `aperta`, current player/price/bidder, and (after a close) `ultimoEsito`/`ultimoVincitoreNome`/`ultimoPrezzo` for the TV voice announcements. `apriAsta()` does a full `batch.set` (not merge) specifically so stale fields from a previous close don't linger. `rilancia()` (bidding) is a Firestore transaction: it re-reads the live price server-side and rejects the bid if it no longer matches the price the client last saw (`prezzoAtteso`) — this is what makes two simultaneous bids resolve to "first one wins, second gets told to retry" instead of silently stacking.

"Apri asta random" (svincolati section) marks the opened auction `apertoDaRandom: true`; on `assegna()` (assign) or `chiudiAsta()` (close unsold), if that flag is set the service auto-opens the next random pick unless the admin unchecked the "keep going" checkbox in the confirmation dialog.

`/tv` (`tv-page.ts`) is a read-only realtime display of the same document, meant for a shared screen: it also does voice announcements via the Web Speech API. Chrome silently rejects `speechSynthesis.speak()` as `"not-allowed"` when it isn't triggered by a real user gesture on that page (exactly the case here, since announcements are triggered by Firestore events) — the page detects this and shows a one-click "unblock" banner. The player column width is user-resizable (drag handles, persisted to `localStorage`) and its type scale uses **container query units** (`cqw`), not `vw`, so it scales with the actual (resizable) column width rather than the full viewport.

### Undo system (`undo.service.ts` + `undo-calculator.ts`)

Certain operations (auction purchases, renewals, refunds/releases, trade confirmations) register a before/after snapshot batched atomically with the operation itself, so they can be reversed later from `/storico`. Not every operation is undoable — check `OperazioneAnnullabile` in `models.ts` for the covered set.

### Automation outside the Angular app (`scripts/*.py`, `.github/workflows/*.yml`)

- `update_quotazioni.py` scrapes fantacalcio.it daily (`update-quotazioni.yml`), updates every rostered player's Q.A./V.A., flags unmatched players `fuoriSerieA`, and rebuilds `league/{id}/svincolati` from whatever's on the listone but not in any roster. It does **not** touch a player's `ruolo` after initial import — role corrections are manual.
- `backup_firestore.py` / `restore_firestore.py` (`backup-firestore.yml`, daily cron) export/import the whole Firestore tree to/from the `data-backups` branch, since Scheduled Backups need the paid Blaze plan. Always dry-run `restore_firestore.py` before passing `--write`.
- `provision_team_accounts.py` / `reset_team_password.py` create/manage the per-team Firebase Auth accounts referenced by `teams/{teamId}.ownerUid`.

These scripts use `firebase-admin` and a service account (`scripts/serviceAccountKey.json` locally, or the `FIREBASE_SERVICE_ACCOUNT` secret in Actions) — full read/write access, bypassing `firestore.rules` entirely.

### Testing

Only the pure calculators under `src/app/core/*-calculator.ts` have spec files; there is no component or service test coverage (no Firestore/Auth test doubles in place). For changes to components, services, or anything touching Firestore, the working pattern is: `ng build` to catch type errors, then verify live against the dev server (`npm start`) — the app connects to the real Firebase project, so any manual testing that mutates data should be cleaned up afterward (the app's own `/storico` undo feature, when the action is undoable, is the safest way to do that).
