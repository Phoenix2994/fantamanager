import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AstaStato, Team } from '../../core/models';
import { residuoAlleMulte } from '../../core/finance-calculator';
import { roleColor, splitRoles } from '../../core/roles';
import { AstaService, ProvenienzaAsta } from '../../core/services/asta.service';
import { AuthService } from '../../core/services/auth.service';
import { FinanceService } from '../../core/services/finance.service';
import { TeamService } from '../../core/services/team.service';
import {
  AstaStatsPanel,
  estraiAcquistiAsta,
  TeamStatAsta,
} from './asta-stats-panel';
import { TeamLogo } from '../../shared/team-logo';

/**
 * Vista TV dell'asta live (/tv): display in grande aggiornato realtime.
 * Sola lettura per tutti; l'admin autenticato vede inoltre un pannello
 * di controllo per assegnare il giocatore (conferma acquisto per la rosa
 * e per la cifra battuta all'asta) o chiudere senza assegnare.
 */
@Component({
  selector: 'app-tv-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
    AstaStatsPanel,
    TeamLogo,
  ],
  template: `
    <div class="tv">
      <!-- Accesso admin: visibile solo se non si è già admin -->
      @if (!isAdmin()) {
        <a matButton class="admin-login" routerLink="/login">
          <mat-icon>admin_panel_settings</mat-icon>
          Accedi come admin
        </a>
      }
      <div class="stage">
        <div class="main">
        @if (stato(); as s) {
          @if (s.aperta) {
            <div class="content">
              <div class="chips">
                @for (r of rolesOf(s.ruolo); track r) {
                  <span
                    class="chip"
                    [style.border-color]="colorFor(r)"
                    [style.color]="colorFor(r)"
                  >{{ r }}</span>
                }
              </div>
              <div class="nome">{{ s.giocatoreNome }}</div>
              @if (s.squadra) {
                <div class="squadra-giocatore">{{ s.squadra }}</div>
              }
              <div class="prezzo">{{ s.prezzoAttuale | number: '1.2-2' }} €</div>
              @if (s.rilanciatoDaTeamName) {
                <div class="rilancio">
                  <span class="label">Rilancia</span>
                  <app-team-logo [name]="s.rilanciatoDaTeamName" class="rilancio-logo" />
                  <span class="team">{{ s.rilanciatoDaTeamName }}</span>
                </div>
              } @else {
                <div class="rilancio">
                  <span class="label">Prezzo di partenza</span>
                </div>
              }
            </div>
          } @else {
            <div class="content waiting">
              <div class="waiting-text">Asta chiusa</div>
            </div>
          }
        } @else {
          <div class="content waiting">
            <div class="waiting-text">In attesa dell'asta…</div>
          </div>
        }
        </div>

        <!-- Statistiche asta (solo desktop): squadre con acquisti per esteso -->
        <aside class="tv-stats">
          <h2>
            <mat-icon>bar_chart</mat-icon>
            Statistiche asta
          </h2>
          <app-asta-stats-panel [stats]="stats()" [sempreAperto]="true" [colonne]="true" />
        </aside>
      </div>

      <!-- Pannello admin: visibile solo all'admin autenticato -->
      @if (isAdmin()) {
        <mat-card class="admin-panel">
          <h3>
            <mat-icon>admin_panel_settings</mat-icon>
            Controllo asta (admin)
          </h3>
          @if (stato()?.aperta) {
            <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
              <mat-label>Squadra vincitrice</mat-label>
              <mat-select [value]="assegnaA()" (selectionChange)="assegnaA.set($event.value)">
                @for (team of teams(); track team.id) {
                  <mat-option [value]="team.id">{{ team.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
              <mat-label>Voce di spesa</mat-label>
              <mat-select [value]="provenienza()" (selectionChange)="provenienza.set($event.value)">
                <mat-option value="acquistiAstaSettembre">Asta settembre</mat-option>
                <mat-option value="acquistiMercatoInfrasettimanale">Asta infrasettimanale</mat-option>
              </mat-select>
            </mat-form-field>

            <div class="admin-actions">
              <button matButton="filled" color="primary" (click)="assegnaVincitore()">
                <mat-icon>gavel</mat-icon>
                Assegna e conferma acquisto
              </button>
              <button matButton (click)="chiudi()">
                <mat-icon>close</mat-icon>
                Chiudi senza assegnare
              </button>
            </div>
          } @else {
            <p class="hint">L'asta è chiusa. Aprila dalla sezione Svincolati della dashboard.</p>
          }
        </mat-card>
      }
    </div>
  `,
  styles: `
    .tv {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      background: var(--mat-sys-surface-container-lowest, #fafafa);
      padding: 24px;
    }

    .admin-login {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 10;
    }

    .main {
      width: 100%;
    }

    /* Stage: giocatore in alto, statistiche sotto */
    .stage {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      max-width: 1700px;
    }

    /* Statistiche sotto il giocatore: una colonna per squadra,
       con scorrimento orizzontale se non entrano nello schermo */
    .tv-stats {
      width: 100%;
      text-align: left;
      padding: 20px 24px;
      border-radius: 16px;
      background: var(--mat-sys-surface-container, #fff);
      box-sizing: border-box;
      overflow-x: auto;
    }

    .tv-stats h2 {
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.25rem;
    }

    .content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      text-align: center;
    }

    .chips {
      display: inline-flex;
      gap: 8px;
    }

    .chip {
      display: inline-block;
      padding: 6px 20px;
      border-radius: 999px;
      border: 3px solid currentColor;
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--mat-sys-primary);
    }

    .nome {
      font-size: clamp(3rem, 10vw, 7rem);
      font-weight: 900;
      line-height: 1.05;
    }

    .squadra-giocatore {
      font-size: clamp(1.5rem, 4vw, 2.5rem);
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }

    .prezzo {
      font-size: clamp(5rem, 18vw, 13rem);
      font-weight: 900;
      color: var(--mat-sys-primary);
      line-height: 1;
    }

    .rilancio {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rilancio .label {
      font-size: 1.6rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .rilancio-logo {
      width: clamp(3rem, 8vw, 5.5rem);
      height: clamp(3rem, 8vw, 5.5rem);
    }

    .rilancio .team {
      font-size: clamp(2rem, 6vw, 4rem);
      font-weight: 800;
    }

    .waiting-text {
      font-size: clamp(2rem, 6vw, 4rem);
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }

    /* ---------- Pannello admin ---------- */
    .admin-panel {
      width: min(480px, 100%);
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }

    .admin-panel h3 {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1rem;
    }

    .full-width {
      width: 100%;
    }

    .admin-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .hint {
      margin: 0;
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class TvPage {
  private readonly astaService = inject(AstaService);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);
  private readonly snackBar = inject(MatSnackBar);

  readonly stato = toSignal(this.astaService.stato$, {
    initialValue: undefined as AstaStato | undefined,
  });

  /** true solo per l'admin autenticato con email/password */
  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  /**
   * Statistiche di tutte le squadre: giocatori su 28, bilancio e acquisti
   * fatti durante l'asta (stessa pipeline della pagina /asta).
   *
   * Usa combineLatest (NON forkJoin): gli osservabili Firestore non
   * completano mai, quindi forkJoin non emetterebbe mai nulla.
   */
  readonly stats = toSignal(
    this.teamService.teams$.pipe(
      switchMap((teams) =>
        teams.length
          ? combineLatest(
              teams.map((team) =>
                combineLatest([
                  this.teamService.players$(team.id),
                  this.financeService.seasonFinance$(team.id),
                  this.financeService.taxBrackets$,
                ]).pipe(
                  map(([players, finance, brackets]) => ({
                    id: team.id,
                    name: team.name,
                    giocatori: players.length,
                    bilancio: finance?.bilancioSocietarioStagionale ?? 0,
                    residuoAlleMulte: residuoAlleMulte(finance?.spesaAnnuale ?? 0, brackets),
                    acquisti: estraiAcquistiAsta(players),
                  })),
                ),
              ),
            )
          : of([] as TeamStatAsta[]),
      ),
    ),
    { initialValue: [] as TeamStatAsta[] },
  );

  readonly assegnaA = signal<string>('');
  readonly provenienza = signal<ProvenienzaAsta>('acquistiAstaSettembre');

  constructor() {
    // Pre-valorizza la squadra vincitrice con l'ultimo rilanciante
    effect(() => {
      const s = this.stato();
      if (s?.aperta && s.rilanciatoDaTeamId) {
        this.assegnaA.set(s.rilanciatoDaTeamId);
      }
    });
  }

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }

  async assegnaVincitore(): Promise<void> {
    const teamId = this.assegnaA();
    if (!teamId) {
      this.snackBar.open('Seleziona la squadra vincitrice', undefined, { duration: 2500 });
      return;
    }
    const team = this.teams().find((t) => t.id === teamId);
    try {
      await this.astaService.assegna(teamId, team?.name ?? '', this.provenienza());
      this.snackBar.open('Acquisto confermato', undefined, { duration: 3000 });
    } catch (e) {
      this.snackBar.open(
        e instanceof Error ? e.message : 'Errore durante l\u2019assegnazione',
        undefined,
        { duration: 4000 },
      );
    }
  }

  async chiudi(): Promise<void> {
    try {
      await this.astaService.chiudiAsta();
    } catch {
      this.snackBar.open('Errore durante la chiusura', undefined, { duration: 3000 });
    }
  }
}