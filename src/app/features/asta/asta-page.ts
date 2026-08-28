import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { combineLatest, firstValueFrom, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { AstaStato, Team, ValutazioneSvincolato } from '../../core/models';
import { residuoAlleMulte } from '../../core/finance-calculator';
import { roleColor, splitRoles } from '../../core/roles';
import { slugify } from '../../core/text-utils';
import { TeamNotesService } from '../../core/services/team-notes.service';
import {
  AstaStatsPanel,
  estraiAcquistiAsta,
  TeamStatAsta,
} from './asta-stats-panel';
import {
  ConfirmAssegnazioneDialog,
  ConfirmAssegnazioneData,
} from './confirm-assegnazione-dialog';
import {
  AstaService,
  MAX_GIOCATORI,
  minIncremento,
  ProvenienzaAsta,
} from '../../core/services/asta.service';
import { AuthService } from '../../core/services/auth.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { TeamLogo } from '../../shared/team-logo';
import { FinanceService } from '../../core/services/finance.service';
import { TeamService } from '../../core/services/team.service';
import { environment } from '../../../environments/environment';

const STORAGE_KEY = 'asta.miaSquadra';

/** Incrementi di rilancio disponibili */
const INCREMENTI = [0.1, 0.2, 0.5, 1] as const;

/** Statistica di una squadra per il pannello dell'asta */
type TeamStat = TeamStatAsta;

/**
 * Pagina dell'asta live per i partecipanti (/asta).
 *
 * L'admin autenticato vede SEMPRE il pannello di controllo (assegna/chiudi)
 * in cima, e sotto può comunque partecipare come squadra (scelta o rilancio).
 * Su mobile il contenuto è organizzato in tab: "Asta" e "Statistiche".
 * Il markup è duplicato tra le due ramificazioni responsive (pattern
 * collaudato nell'app): niente NgTemplateOutlet che con i form field
 * di Material crea problemi di istanziazione viste.
 */
@Component({
  selector: 'app-asta-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatTabsModule,
    RouterLink,
    NavMenu,
    AstaStatsPanel,
    HeaderAuthStatus,
    TeamLogo,
  ],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <img src="icons/logo-emblema.png" class="header-logo" alt="" />
        <h1 class="app-title">Asta live</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">

      <!-- MOBILE: tab Asta / Statistiche -->
      @if (isMobile()) {
        <mat-tab-group animationDuration="0ms" dynamicHeight>
          <mat-tab label="Asta">
            <div class="tab-content">
              @if (isAdmin()) {
                <mat-card class="panel">
                  <h2 class="panel-title">
                    <mat-icon>admin_panel_settings</mat-icon>
                    Controllo asta (admin)
                  </h2>
                  @if (stato(); as s) {
                    @if (s.aperta) {
                      <div class="giocatore-box">
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
                          <div class="rilanciante"><app-team-logo [name]="s.rilanciatoDaTeamName" class="rilanciante-logo" />Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                        }
                      </div>

                      <!-- Valutazione PRIVATA della propria squadra: solo per chi ha
                           fatto login come squadra (non per la scelta squadra anonima) -->
                      @if (myTeam() && valutazioneAttuale(); as v) {
                        @if (v.stelle > 0 || v.note) {
                          <div class="mia-valutazione">
                            @if (v.stelle > 0) {
                              <span class="stars readonly">
                                @for (s2 of STELLE; track s2) {
                                  <mat-icon>{{ v.stelle >= s2 ? 'star' : 'star_border' }}</mat-icon>
                                }
                              </span>
                            }
                            @if (v.note) {
                              <p class="nota-privata">{{ v.note }}</p>
                            }
                          </div>
                        }
                      }

                      <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                        <mat-label>Assegna alla squadra vincitrice</mat-label>
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

                      <!-- Prezzo prevalorizzato al prezzo corrente, modificabile dall'admin -->
                      <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                        <mat-label>Prezzo di assegnazione (€)</mat-label>
                        <input
                          matInput
                          type="number"
                          step="0.1"
                          min="0.1"
                          [value]="assegnaPrezzo()"
                          (input)="onPrezzoInput($any($event.target).valueAsNumber || 0)"
                        />
                      </mat-form-field>

                      <div class="admin-actions">
                        <button matButton="filled" color="primary" (click)="assegnaVincitore()">
                          <mat-icon>gavel</mat-icon>
                          Assegna
                        </button>
                        <button matButton (click)="chiudi()">
                          <mat-icon>close</mat-icon>
                          Chiudi senza assegnare
                        </button>
                      </div>
                    } @else {
                      <p class="empty-state">L'asta è chiusa. Aprila dalla sezione Svincolati della dashboard.</p>
                    }
                  } @else {
                    <p class="empty-state">Nessuna asta in corso. Aprila dalla sezione Svincolati della dashboard.</p>
                  }
                </mat-card>
              }

              @if (!miaSquadra()) {
                <mat-card class="panel">
                  <h2>Chi sei?</h2>
                  <p class="hint">
                    Seleziona la tua squadra per partecipare ai rilanci.
                    La scelta verrà ricordata su questo dispositivo.
                  </p>
                  <div class="team-grid">
                    @for (team of teams(); track team.id) {
                      <button matButton="tonal" class="team-btn" (click)="scegliSquadra(team)">
                        <app-team-logo [name]="team.name" class="team-btn-logo" />
                        {{ team.name }}
                      </button>
                    }
                  </div>
                </mat-card>
              }

              @if (miaSquadra(); as squadra) {
                <mat-card class="panel">
                  <div class="squadra-bar">
                    <app-team-logo [name]="squadra.name" class="squadra-logo" />
                    <span>Stai rilanciando per:</span>
                    <strong>{{ squadra.name }}</strong>
                    @if (isAdmin()) {
                      <button matButton (click)="cambiaSquadra()">Cambia</button>
                    }
                  </div>

                  @if (stato(); as s) {
                    @if (s.aperta) {
                      <div class="giocatore-box">
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
                          <div class="rilanciante"><app-team-logo [name]="s.rilanciatoDaTeamName" class="rilanciante-logo" />Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                        }
                      </div>

                      <!-- Valutazione PRIVATA della propria squadra: solo per chi ha
                           fatto login come squadra (non per la scelta squadra anonima) -->
                      @if (myTeam() && valutazioneAttuale(); as v) {
                        @if (v.stelle > 0 || v.note) {
                          <div class="mia-valutazione">
                            @if (v.stelle > 0) {
                              <span class="stars readonly">
                                @for (s2 of STELLE; track s2) {
                                  <mat-icon>{{ v.stelle >= s2 ? 'star' : 'star_border' }}</mat-icon>
                                }
                              </span>
                            }
                            @if (v.note) {
                              <p class="nota-privata">{{ v.note }}</p>
                            }
                          </div>
                        }
                      }

                      <div class="bids">
                        @for (inc of incrementi; track inc) {
                          <button
                            matButton="filled"
                            class="bid-btn"
                            [disabled]="sonoUltimoRilanciante() || inCooldown() || squadraPiena() || inc < minInc()"
                            (click)="rilancia(inc)"
                          >
                            +{{ inc | number: '1.1-1' }} €
                          </button>
                        }
                      </div>

                      <p class="hint">
                        Rilancio minimo attuale: {{ minInc() | number: '1.2-2' }} € ·
                        Giocatori squadra: {{ mieiGiocatori() }}/28 ·
                        Il rilancio custom deve superare il prezzo attuale
                      </p>

                      <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                        <mat-label>Rilancio custom (€)</mat-label>
                        <input
                          matInput
                          type="number"
                          step="0.1"
                          min="0.1"
                          [value]="customBid()"
                          (input)="customBid.set($any($event.target).valueAsNumber || 0)"
                        />
                      </mat-form-field>
                      <button
                        matButton="filled"
                        class="bid-btn custom-bid-btn"
                        [disabled]="!customValida() || inCooldown() || squadraPiena()"
                        (click)="rilanciaCustom()"
                      >
                        Rilancia {{ customBid() | number: '1.2-2' }} €
                      </button>

                      @if (inCooldown()) {
                        <p class="hint warn">Rilancio registrato: attendi un istante…</p>
                      } @else if (sonoUltimoRilanciante()) {
                        <p class="hint warn">La tua squadra è già l'ultima rilanciante: attendi una controparte.</p>
                      } @else if (squadraPiena()) {
                        <p class="hint warn">Hai raggiunto il limite di 28 giocatori: non puoi rilanciare.</p>
                      }
                    } @else {
                      <p class="empty-state">L'asta è chiusa. Attendi che l'amministratore ne apra una nuova.</p>
                    }
                  } @else {
                    <p class="empty-state">Nessuna asta in corso. Attendi l'apertura.</p>
                  }
                </mat-card>
              }
            </div>
          </mat-tab>
          <mat-tab label="Statistiche">
            <div class="tab-content">
              <mat-card class="panel">
                <h2 class="panel-title">
                  <mat-icon>bar_chart</mat-icon>
                  Statistiche squadre
                </h2>
                @if (stats().length === 0) {
                  <p class="empty-state">Caricamento statistiche…</p>
                } @else {
                  <app-asta-stats-panel [stats]="stats()" />
                }
              </mat-card>
            </div>
          </mat-tab>
        </mat-tab-group>
      } @else {
        <!-- DESKTOP/TABLET: sezioni impilate -->

        <!-- Statistiche -->
        <mat-card class="panel">
          <h2 class="panel-title">
            <mat-icon>bar_chart</mat-icon>
            Statistiche squadre
          </h2>
          @if (stats().length === 0) {
            <p class="empty-state">Caricamento statistiche…</p>
          } @else {
            <app-asta-stats-panel [stats]="stats()" />
          }
        </mat-card>

        <!-- Pannello admin -->
        @if (isAdmin()) {
          <mat-card class="panel">
            <h2 class="panel-title">
              <mat-icon>admin_panel_settings</mat-icon>
              Controllo asta (admin)
            </h2>
            @if (stato(); as s) {
              @if (s.aperta) {
                <div class="giocatore-box">
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
                    <div class="rilanciante"><app-team-logo [name]="s.rilanciatoDaTeamName" class="rilanciante-logo" />Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                  }
                </div>

                <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                  <mat-label>Assegna alla squadra vincitrice</mat-label>
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

                <!-- Prezzo prevalorizzato al prezzo corrente, modificabile dall'admin -->
                <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                  <mat-label>Prezzo di assegnazione (€)</mat-label>
                  <input
                    matInput
                    type="number"
                    step="0.1"
                    min="0.1"
                    [value]="assegnaPrezzo()"
                    (input)="onPrezzoInput($any($event.target).valueAsNumber || 0)"
                  />
                </mat-form-field>

                <div class="admin-actions">
                  <button matButton="filled" color="primary" (click)="assegnaVincitore()">
                    <mat-icon>gavel</mat-icon>
                    Assegna
                  </button>
                  <button matButton (click)="chiudi()">
                    <mat-icon>close</mat-icon>
                    Chiudi senza assegnare
                  </button>
                </div>
              } @else {
                <p class="empty-state">L'asta è chiusa. Aprila dalla sezione Svincolati della dashboard.</p>
              }
            } @else {
              <p class="empty-state">Nessuna asta in corso. Aprila dalla sezione Svincolati della dashboard.</p>
            }
          </mat-card>
        }

        <!-- Scelta squadra -->
        @if (!miaSquadra()) {
          <mat-card class="panel">
            <h2>Chi sei?</h2>
            <p class="hint">
              Seleziona la tua squadra per partecipare ai rilanci.
              La scelta verrà ricordata su questo dispositivo.
            </p>
            <div class="team-grid">
              @for (team of teams(); track team.id) {
                <button matButton="tonal" class="team-btn" (click)="scegliSquadra(team)">
                  <app-team-logo [name]="team.name" class="team-btn-logo" />
                  {{ team.name }}
                </button>
              }
            </div>
          </mat-card>
        }

        <!-- Pannello rilancio -->
        @if (miaSquadra(); as squadra) {
          <mat-card class="panel">
            <div class="squadra-bar">
              <app-team-logo [name]="squadra.name" class="squadra-logo" />
              <span>Stai rilanciando per:</span>
              <strong>{{ squadra.name }}</strong>
              @if (isAdmin()) {
                <button matButton (click)="cambiaSquadra()">Cambia</button>
              }
            </div>

            @if (stato(); as s) {
              @if (s.aperta) {
                <div class="giocatore-box">
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
                    <div class="rilanciante"><app-team-logo [name]="s.rilanciatoDaTeamName" class="rilanciante-logo" />Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                  }
                </div>

                <div class="bids">
                  @for (inc of incrementi; track inc) {
                    <button
                      matButton="filled"
                      class="bid-btn"
                      [disabled]="sonoUltimoRilanciante() || inCooldown() || squadraPiena() || inc < minInc()"
                      (click)="rilancia(inc)"
                    >
                      +{{ inc | number: '1.1-1' }} €
                    </button>
                  }
                </div>

                <p class="hint">
                  Rilancio minimo attuale: {{ minInc() | number: '1.2-2' }} € ·
                  Giocatori squadra: {{ mieiGiocatori() }}/28 ·
                  Il rilancio custom deve superare il prezzo attuale
                </p>

                <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                  <mat-label>Rilancio custom (€)</mat-label>
                  <input
                    matInput
                    type="number"
                    step="0.1"
                    min="0.1"
                    [value]="customBid()"
                    (input)="customBid.set($any($event.target).valueAsNumber || 0)"
                  />
                </mat-form-field>
                <button
                  matButton="filled"
                  class="bid-btn custom-bid-btn"
                  [disabled]="!customValida() || inCooldown() || squadraPiena()"
                  (click)="rilanciaCustom()"
                >
                  Rilancia {{ customBid() | number: '1.2-2' }} €
                </button>

                @if (inCooldown()) {
                  <p class="hint warn">Rilancio registrato: attendi un istante…</p>
                } @else if (sonoUltimoRilanciante()) {
                  <p class="hint warn">La tua squadra è già l'ultima rilanciante: attendi una controparte.</p>
                } @else if (squadraPiena()) {
                  <p class="hint warn">Hai raggiunto il limite di 28 giocatori: non puoi rilanciare.</p>
                }
              } @else {
                <p class="empty-state">L'asta è chiusa. Attendi che l'amministratore ne apra una nuova.</p>
              }
            } @else {
              <p class="empty-state">Nessuna asta in corso. Attendi l'apertura.</p>
            }
          </mat-card>
        }
      }

      <footer class="asta-footer">
        <a matButton routerLink="/tv" target="_blank">
          <mat-icon>tv</mat-icon>
          Apri vista TV
        </a>
      </footer>
      </main>
    </div>
  `,
  styles: `
    /* Colonna unica e stretta: qui si segue un'asta live, non si naviga
       una dashboard — il resto (header, .panel, .empty-state) viene da
       page-shell.scss, condiviso con le altre pagine a schermo intero. */
    .content {
      max-width: 560px;
      margin: 0 auto;
      padding: 16px;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 1.15rem;
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1rem;
    }

    .tab-content {
      padding-top: 16px;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 16px;
    }

    .giocatore-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 20px 12px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
    }

    .chips {
      display: inline-flex;
      gap: 4px;
    }

    .chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      border: 1.5px solid currentColor;
      font-size: 0.78rem;
      font-weight: 700;
    }

    .nome {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
    }

    .prezzo {
      font-size: 2.6rem;
      font-weight: 800;
      color: var(--mat-sys-primary);
      line-height: 1;
    }

    .squadra-giocatore {
      font-size: 1rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }

    .rilanciante {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .rilanciante-logo {
      width: 18px;
      height: 18px;
    }

    .mia-valutazione {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin: 8px 0 0;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--mat-sys-secondary-container);
      text-align: center;
    }

    .stars.readonly {
      display: inline-flex;
      color: var(--mat-sys-tertiary);
    }

    .stars.readonly mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .nota-privata {
      margin: 0;
      font-size: 0.85rem;
      font-style: italic;
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

    .hint.warn {
      color: var(--mat-sys-error);
      text-align: center;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.95rem;
      text-align: center;
      padding: 12px 0;
    }

    .team-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .team-btn {
      min-height: 56px;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .team-btn-logo {
      width: 24px;
      height: 24px;
    }

    .squadra-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .squadra-logo {
      width: 24px;
      height: 24px;
    }

    .squadra-bar strong {
      color: var(--mat-sys-on-surface);
    }

    .bids {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .bid-btn {
      min-height: 64px;
      font-size: 1.25rem;
      font-weight: 700;
    }

    .custom-bid-btn {
      width: 100%;
    }

    .asta-footer {
      display: flex;
      justify-content: center;
      margin-top: 16px;
    }
  `,
})
export class AstaPage {
  private readonly astaService = inject(AstaService);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);
  private readonly teamNotesService = inject(TeamNotesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly leagueName = environment.leagueName;
  readonly incrementi = INCREMENTI;
  readonly STELLE = [1, 2, 3] as const;

  /** Layout mobile (<640px): tab Asta/Statistiche invece di sezioni impilate */
  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 639.98px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });
  private readonly dialog = inject(MatDialog);

  readonly stato = toSignal(this.astaService.stato$, { initialValue: undefined as AstaStato | undefined });

  /** Squadra di cui l'utente corrente è proprietario, se ha fatto login come squadra */
  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });

  /** Valutazioni PRIVATE della propria squadra sugli svincolati (vuoto se non loggati come squadra) */
  private readonly valutazioni = toSignal(
    toObservable(this.myTeam).pipe(
      switchMap((team) =>
        team ? this.teamNotesService.valutazioni$(team.id) : of([] as ValutazioneSvincolato[]),
      ),
    ),
    { initialValue: [] as ValutazioneSvincolato[] },
  );

  /**
   * Valutazione della propria squadra sul giocatore attualmente in asta —
   * stesso id/slug con cui è salvato lo svincolato (vedi AstaService.assegna).
   */
  readonly valutazioneAttuale = computed<ValutazioneSvincolato | undefined>(() => {
    const s = this.stato();
    if (!s?.aperta) {
      return undefined;
    }
    const id = slugify(s.giocatoreNome);
    return this.valutazioni().find((v) => v.id === id);
  });

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  /** Squadra del partecipante corrente (persistita in localStorage) */
  readonly miaSquadra = signal<Team | null>(this.leggiSquadraSalvata());

  /**
   * Statistiche di tutte le squadre: numero giocatori (su 28) e
   * bilancio societario stagionale corrente.
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
          : of([] as TeamStat[]),
      ),
    ),
    { initialValue: [] as TeamStat[] },
  );

  /** Selezione admin per l'assegnazione */
  readonly assegnaA = signal<string>('');
  readonly provenienza = signal<ProvenienzaAsta>('acquistiAstaSettembre');

  /**
   * Prezzo con cui assegnare il giocatore: prevalorizzato al prezzo corrente
   * dell'asta e modificabile dall'admin prima della conferma.
   */
  readonly assegnaPrezzo = signal(0);
  /** true dopo la prima modifica manuale del prezzo: smette di seguire il live */
  private readonly prezzoModificato = signal(false);
  /** Giocatore attualmente all'asta: al cambio si resetta il prezzo */
  private readonly giocatoreCorrente = signal<string | null>(null);

  onPrezzoInput(value: number): void {
    this.prezzoModificato.set(true);
    this.assegnaPrezzo.set(value);
  }

  /** Rilancio custom (importo libero) */
  readonly customBid = signal<number>(0);

  /** Cooldown anti-race: dopo un rilancio i pulsanti restano disabilitati 1s */
  readonly inCooldown = signal(false);

  constructor() {
    // Se la squadra salvata non esiste più nel DB, resetta la scelta.
    // Attenzione: teams parte da [] (initialValue) — resetta SOLO quando
    // la lista è stata effettivamente caricata (length > 0).
    toObservable(this.teams).subscribe((teams) => {
      const salvata = this.miaSquadra();
      if (salvata && teams.length > 0 && !teams.some((t) => t.id === salvata.id)) {
        this.miaSquadra.set(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    });

    // Pre-valorizza la squadra vincitrice con l'ultimo rilanciante
    effect(() => {
      const s = this.stato();
      if (s?.aperta && s.rilanciatoDaTeamId) {
        this.assegnaA.set(s.rilanciatoDaTeamId);
      }
    });

    // Al cambio di giocatore all'asta: reset del prezzo manuale
    effect(() => {
      const s = this.stato();
      const nome = s?.aperta ? s.giocatoreNome : null;
      if (nome !== this.giocatoreCorrente()) {
        this.giocatoreCorrente.set(nome);
        this.prezzoModificato.set(false);
      }
    });

    // Finché l'admin non modifica manualmente il campo, il prezzo di
    // assegnazione segue il prezzo corrente dell'asta
    effect(() => {
      if (!this.prezzoModificato()) {
        this.assegnaPrezzo.set(this.stato()?.prezzoAttuale ?? 0);
      }
    });
  }

  /** true se la mia squadra è l'ultima rilanciante */
  readonly sonoUltimoRilanciante = computed(
    () => this.stato()?.rilanciatoDaTeamId === this.miaSquadra()?.id,
  );

  /** Incremento minimo consentito al prezzo corrente dell'asta */
  readonly minInc = computed(() => minIncremento(this.stato()?.prezzoAttuale ?? 0));

  /** Numero di giocatori della mia squadra */
  readonly mieiGiocatori = computed(
    () => this.stats().find((t) => t.id === this.miaSquadra()?.id)?.giocatori ?? 0,
  );

  /** true se la mia squadra ha raggiunto il limite di giocatori */
  readonly squadraPiena = computed(() => this.mieiGiocatori() >= MAX_GIOCATORI);

  leggiSquadraSalvata(): Team | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Team) : null;
    } catch {
      return null;
    }
  }

  async scegliSquadra(team: Team): Promise<void> {
    try {
      // Se non c'è già una sessione (admin o anonima), crea un login anonimo.
      // Se l'utente è già autenticato (es. admin), NON sovrascrivere la sessione.
      const user = await firstValueFrom(this.authService.user$);
      if (!user) {
        await this.authService.loginAnonymous();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
      this.miaSquadra.set(team);
    } catch {
      this.snackBar.open(
        'Errore di accesso. Verifica che Anonymous Auth sia abilitato in Firebase.',
        undefined,
        { duration: 5000 },
      );
    }
  }

  cambiaSquadra(): void {
    this.miaSquadra.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  /** true se il rilancio custom è valido (> prezzo attuale + minimo) */
  readonly customValida = computed(() => {
    const prezzo = this.stato()?.prezzoAttuale ?? 0;
    return this.customBid() + 1e-9 >= prezzo + this.minInc();
  });

  async rilancia(incremento: number): Promise<void> {
    await this.eseguiRilancio(incremento);
  }

  async rilanciaCustom(): Promise<void> {
    if (!this.customValida()) {
      return;
    }
    await this.eseguiRilancio(this.customBid() - (this.stato()?.prezzoAttuale ?? 0));
  }

  private async eseguiRilancio(incremento: number): Promise<void> {
    const team = this.miaSquadra();
    if (!team || this.inCooldown()) {
      return;
    }
    try {
      await this.astaService.rilancia(team.id, team.name, incremento, this.mieiGiocatori());
      // Cooldown di 1 secondo: evita doppi click/race tra partecipanti
      this.inCooldown.set(true);
      setTimeout(() => this.inCooldown.set(false), 1000);
    } catch (e) {
      this.snackBar.open(
        e instanceof Error ? e.message : 'Errore durante il rilancio',
        undefined,
        { duration: 3000 },
      );
    }
  }

  async assegnaVincitore(): Promise<void> {
    const teamId = this.assegnaA();
    if (!teamId) {
      this.snackBar.open('Seleziona la squadra vincitrice', undefined, { duration: 2500 });
      return;
    }
    const team = this.teams().find((t) => t.id === teamId);
    // Only admins can assign a winning player
    if (!this.isAdmin()) {
      this.snackBar.open('Solo amministratore può assegnare il vincitore', undefined, { duration: 3000 });
      return;
    }

    // Modale di conferma: riepilogo squadra vincitrice e cifra finale
    // prima di finalizzare l'assegnazione (operazione non reversibile)
    const stato = this.stato();
    const data: ConfirmAssegnazioneData = {
      giocatoreNome: stato?.giocatoreNome ?? '',
      squadra: stato?.squadra,
      teamName: team?.name ?? '',
      prezzo: this.assegnaPrezzo(),
      provenienzaLabel:
        this.provenienza() === 'acquistiAstaSettembre'
          ? 'Asta settembre'
          : 'Asta infrasettimanale',
    };
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmAssegnazioneDialog, {
          data,
          width: '95vw',
          maxWidth: '420px',
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return;
    }

    try {
      await this.astaService.assegna(teamId, team?.name ?? '', this.provenienza(), this.assegnaPrezzo());
      this.snackBar.open('Giocatore assegnato', undefined, { duration: 3000 });
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

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }
}