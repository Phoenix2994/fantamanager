import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import { SeasonFinance } from '../../core/models';
import { round2 } from '../../core/finance-calculator';
import { FinanceService } from '../../core/services/finance.service';
import { TeamService } from '../../core/services/team.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';

/** Riga della tabella premi: posizione finale e quota % sul montepremi totale */
interface RigaPremio {
  posizione: string;
  percentuale: number;
}

/** Ripartizione del montepremi per piazzamento in campionato */
const CAMPIONATO: readonly RigaPremio[] = [
  { posizione: '1°', percentuale: 27.4 },
  { posizione: '2°', percentuale: 18.1 },
  { posizione: '3°', percentuale: 12.2 },
  { posizione: '4°', percentuale: 8.3 },
  { posizione: '5°', percentuale: 5.7 },
  { posizione: '6°', percentuale: 3.9 },
  { posizione: '7°', percentuale: 2.6 },
  { posizione: '8°', percentuale: 1.7 },
];

/** Ripartizione del montepremi per piazzamento in coppa e minicoppa */
const COPPA_E_MINICOPPA: readonly RigaPremio[] = [
  { posizione: '1° coppa', percentuale: 10.3 },
  { posizione: '2° coppa', percentuale: 4.6 },
  { posizione: '3° coppa', percentuale: 1.9 },
  { posizione: '4° coppa', percentuale: 0.7 },
  { posizione: '1° minicoppa', percentuale: 2.6 },
];

/**
 * Pagina pubblica (nessun login richiesto) con la ripartizione del
 * montepremi di fine stagione: percentuali fisse da regolamento, ma il
 * valore in € è calcolato dal vivo sulla somma dei bilanci societari
 * stagionali di TUTTE le squadre (stesso campo bilancioSocietarioStagionale
 * mostrato in "Spese societarie" di ciascuna squadra) — non un dato fisso,
 * si aggiorna da solo man mano che le squadre muovono soldi durante l'anno.
 */
@Component({
  selector: 'app-montepremi-page',
  imports: [DecimalPipe, MatIconModule, NavMenu, HeaderAuthStatus],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <mat-icon class="header-logo" aria-hidden="true">sports_soccer</mat-icon>
        <h1 class="app-title">Montepremi</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">
        <div class="totale-box">
          <span>Montepremi totale (somma bilanci stagionali)</span>
          <strong>{{ montepremiTotale() | number: '1.2-2' }} €</strong>
        </div>

        <div class="groups">
          <section class="group">
            <h2>Campionato</h2>
            @for (r of campionato(); track r.posizione) {
              <div class="row">
                <span>{{ r.posizione }}</span>
                <span class="perc">{{ r.percentuale | number: '1.1-2' }}%</span>
                <strong>{{ r.valore | number: '1.2-2' }} €</strong>
              </div>
            }
            <div class="row totale">
              <span>Totale campionato</span>
              <span class="perc">{{ totaleCampionatoPerc | number: '1.1-2' }}%</span>
              <strong>{{ totaleCampionatoValore() | number: '1.2-2' }} €</strong>
            </div>
          </section>

          <section class="group">
            <h2>Coppa e minicoppa</h2>
            @for (r of coppaEMinicoppa(); track r.posizione) {
              <div class="row">
                <span>{{ r.posizione }}</span>
                <span class="perc">{{ r.percentuale | number: '1.1-2' }}%</span>
                <strong>{{ r.valore | number: '1.2-2' }} €</strong>
              </div>
            }
            <div class="row totale">
              <span>Totale coppa e minicoppa</span>
              <span class="perc">{{ totaleCoppaPerc | number: '1.1-2' }}%</span>
              <strong>{{ totaleCoppaValore() | number: '1.2-2' }} €</strong>
            </div>
          </section>
        </div>
      </main>
    </div>
  `,
  styles: `
    .totale-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 16px;
      background: var(--mat-sys-surface-container-high);
      font-size: 0.9rem;
    }

    .totale-box strong {
      font-size: 1.2rem;
      color: var(--mat-sys-primary);
    }

    .groups {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .group {
      background: var(--mat-sys-surface-container-low, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
      border-radius: 16px;
      box-shadow: var(--mat-sys-level1, 0 1px 3px rgba(0, 0, 0, 0.3));
      padding: 16px;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 1rem;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 0.9rem;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
    }

    .row:last-of-type {
      border-bottom: none;
    }

    .row span {
      color: var(--mat-sys-on-surface-variant);
    }

    .row span:first-child {
      flex: 1;
    }

    .row .perc {
      flex-shrink: 0;
      min-width: 4.5em;
      text-align: right;
    }

    .row strong {
      flex-shrink: 0;
      min-width: 6em;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .row.totale {
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      border-bottom: none;
    }

    .row.totale span,
    .row.totale strong {
      color: var(--mat-sys-primary);
      font-weight: 700;
    }
  `,
})
export class MontepremiPage {
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);

  readonly leagueName = environment.leagueName;

  readonly totaleCampionatoPerc = CAMPIONATO.reduce((sum, r) => sum + r.percentuale, 0);
  readonly totaleCoppaPerc = COPPA_E_MINICOPPA.reduce((sum, r) => sum + r.percentuale, 0);

  /** Bilancio stagionale di ogni squadra, in realtime (undefined finché non c'è ancora un documento) */
  private readonly bilanciSquadre = toSignal(
    this.teamService.teams$.pipe(
      switchMap((teams) =>
        teams.length
          ? combineLatest(teams.map((t) => this.financeService.seasonFinance$(t.id)))
          : of([] as (SeasonFinance | undefined)[]),
      ),
    ),
    { initialValue: [] as (SeasonFinance | undefined)[] },
  );

  /** Somma dei bilanci stagionali di TUTTE le squadre: il montepremi totale */
  readonly montepremiTotale = computed(() =>
    round2(
      -this.bilanciSquadre().reduce(
        (sum, f) => sum + (f?.bilancioSocietarioStagionale || 0),
        0,
      ),
    ),
  );

  readonly campionato = computed(() => this.conValore(CAMPIONATO));
  readonly coppaEMinicoppa = computed(() => this.conValore(COPPA_E_MINICOPPA));

  readonly totaleCampionatoValore = computed(() =>
    round2((this.totaleCampionatoPerc / 100) * this.montepremiTotale()),
  );
  readonly totaleCoppaValore = computed(() =>
    round2((this.totaleCoppaPerc / 100) * this.montepremiTotale()),
  );

  private conValore(righe: readonly RigaPremio[]) {
    const totale = this.montepremiTotale();
    return righe.map((r) => ({ ...r, valore: round2((r.percentuale / 100) * totale) }));
  }
}
