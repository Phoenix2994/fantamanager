import { Component, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import {
  RisultatoAiutiDiStato,
  RisultatoGironi,
  SquadraInLotteria,
  SquadraSorteggio,
  VincitaAiutoDiStato,
  estraiAiutiDiStato,
  sorteggiaGironi,
} from '../../core/estrazioni-calculator';
import { AuthService } from '../../core/services/auth.service';
import { EstrazioniService } from '../../core/services/estrazioni.service';
import { TeamService } from '../../core/services/team.service';
import { Team } from '../../core/models';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { ConfirmDialog } from '../dashboard/dialogs/confirm-dialog';

/** Pausa promisificata, per scandire la rivelazione delle estrazioni */
function attesa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Le 7 posizioni candidate agli aiuti di stato (dal regolamento, cap. 6) */
const POSIZIONI_CANDIDATE = [4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Nomi (sotto-stringa, case-insensitive) usati per pre-compilare la
 * posizione di ciascuna squadra: SOLO un comodo default, sempre
 * correggibile a mano — l'app non ha una sezione classifica, quindi ogni
 * anno la posizione reale va confermata dall'admin.
 */
const DEFAULT_POSIZIONE_PER_NOME: Record<string, number> = {
  barurumon: 10,
  phoenix: 9,
  granchi: 8,
  haus: 7,
  ciaccati: 6,
  nicaragua: 5,
  jonica: 4,
};

@Component({
  selector: 'app-estrazioni-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    NavMenu,
    HeaderAuthStatus,
  ],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <mat-icon class="header-logo" aria-hidden="true">sports_soccer</mat-icon>
        <h1 class="app-title">Estrazioni</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">
        @if (!isAdmin()) {
          <section class="panel">
            <p class="solo-admin">Accedi come admin per usare le estrazioni di lega.</p>
          </section>
        } @else {
          <mat-tab-group>
            <!-- ============ TAB 1: sorteggio gironi di Coppa ============ -->
            <mat-tab label="Gironi di Coppa">
              <section class="panel tab-panel">
                <p class="hint">
                  Sorteggio puramente casuale delle 10 squadre in 2 gironi da 5
                  per la Coppa. Ogni volta che lo lanci è un'estrazione nuova:
                  non viene salvato nulla, è solo per lo spettacolo dal vivo.
                </p>

                @if (teamsPerGironi().length !== 10) {
                  <p class="errore">
                    <mat-icon>error_outline</mat-icon>
                    Servono esattamente 10 squadre in lega per formare 2 gironi da 5
                    (trovate: {{ teamsPerGironi().length }}).
                  </p>
                }

                <button
                  matButton="filled"
                  type="button"
                  [disabled]="gironiInCorso() || teamsPerGironi().length !== 10"
                  (click)="sorteggiaGironiClick()"
                >
                  <mat-icon>casino</mat-icon>
                  {{ gironiRisultato() ? 'Sorteggia di nuovo' : 'Sorteggia i gironi' }}
                </button>

                @if (gironiRisultato()) {
                  <div class="gironi-grid">
                    <div class="girone-card">
                      <h3>Girone A</h3>
                      <ul class="girone-list">
                        @for (s of gironeRivelato('A'); track s.id) {
                          <li class="reveal-in">{{ s.name }}</li>
                        }
                        @if (gironiInCorso()) {
                          @for (slot of slotsVuoti('A'); track slot) {
                            <li class="slot-vuoto">?</li>
                          }
                        }
                      </ul>
                    </div>
                    <div class="girone-card">
                      <h3>Girone B</h3>
                      <ul class="girone-list">
                        @for (s of gironeRivelato('B'); track s.id) {
                          <li class="reveal-in">{{ s.name }}</li>
                        }
                        @if (gironiInCorso()) {
                          @for (slot of slotsVuoti('B'); track slot) {
                            <li class="slot-vuoto">?</li>
                          }
                        }
                      </ul>
                    </div>
                  </div>
                  @if (gironiInCorso()) {
                    @if (gironiCountdown(); as n) {
                      <div class="countdown reveal-in">{{ n }}</div>
                    } @else {
                      <p class="estraendo">
                        <mat-spinner diameter="18" />
                        Sto per rivelare la prossima squadra...
                      </p>
                    }
                  }
                }
              </section>
            </mat-tab>

            <!-- ============ TAB 2: aiuti di stato ============ -->
            <mat-tab label="Aiuti di stato">
              <section class="panel tab-panel">
                <p class="hint">
                  Le ultime 7 in classifica si giocano 6 bonus (spendibili solo
                  all'asta di settembre), estratti uno alla volta: il primo
                  estratto vince il bonus più alto, e così via — chi resta per
                  ultimo non vince nulla. Conferma le posizioni prima di
                  estrarre; la conferma finale scrive i bonus vinti negli
                  indennizzi di settembre delle squadre coinvolte.
                </p>

                <mat-form-field appearance="fill" subscriptSizing="dynamic" class="montepremi-input">
                  <mat-label>Montepremi stagione precedente (€)</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    step="0.01"
                    [value]="montepremiPrecedente()"
                    (input)="montepremiPrecedente.set($any($event.target).valueAsNumber || 0)"
                  />
                </mat-form-field>

                <div class="posizioni-grid">
                  @for (pos of posizioni; track pos) {
                    <mat-form-field appearance="fill" subscriptSizing="dynamic">
                      <mat-label>{{ pos }}ª posizione</mat-label>
                      <mat-select
                        [value]="posizioneSelezione()[pos] ?? null"
                        (selectionChange)="setPosizione(pos, $event.value)"
                      >
                        @for (team of teams(); track team.id) {
                          <mat-option [value]="team.id">{{ team.name }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  }
                </div>

                @if (erroreAiuti(); as err) {
                  <p class="errore">
                    <mat-icon>error_outline</mat-icon>
                    {{ err }}
                  </p>
                }

                <button
                  matButton="filled"
                  type="button"
                  [disabled]="aiutiInCorso() || !!erroreAiuti()"
                  (click)="estraiAiutiClick()"
                >
                  <mat-icon>casino</mat-icon>
                  {{ aiutiRisultato() ? 'Estrai di nuovo' : 'Estrai i bonus' }}
                </button>

                @if (aiutiRivelati().length > 0) {
                  <ol class="aiuti-list">
                    @for (v of aiutiRivelati(); track v.teamId) {
                      <li class="reveal-in">
                        <span class="ordine">{{ v.ordineEstrazione }}°</span>
                        <span class="nome">{{ v.teamName }}</span>
                        <span class="posizione">({{ v.posizione }}ª)</span>
                        <span class="bonus">
                          +{{ v.bonusEuro | number: '1.2-2' }} € ({{ v.bonusPerc * 100 | number: '1.2-2' }}%)
                        </span>
                      </li>
                    }
                  </ol>
                }
                @if (esclusaRivelata(); as esc) {
                  <p class="esclusa reveal-in">
                    <mat-icon>sentiment_dissatisfied</mat-icon>
                    <strong>{{ esc.teamName }}</strong> ({{ esc.posizione }}ª) resta senza bonus.
                  </p>
                }
                @if (aiutiInCorso()) {
                  @if (aiutiCountdown(); as n) {
                    <div class="countdown reveal-in">{{ n }}</div>
                  } @else {
                    <p class="estraendo">
                      <mat-spinner diameter="18" />
                      Sto per estrarre il bonus da {{ prossimoBonusPerc() | number: '1.2-2' }}%...
                    </p>
                  }
                }

                @if (aiutiRisultato() && !aiutiInCorso()) {
                  <div class="conferma-box">
                    @if (aiutiConfermati()) {
                      <p class="confermato">
                        <mat-icon>check_circle</mat-icon>
                        Bonus scritti negli indennizzi di settembre.
                      </p>
                    } @else {
                      <button matButton="filled" type="button" (click)="confermaAiuti()">
                        <mat-icon>save</mat-icon>
                        Conferma e scrivi negli indennizzi di settembre
                      </button>
                    }
                  </div>
                }
              </section>
            </mat-tab>
          </mat-tab-group>
        }
      </main>
    </div>
  `,
  styles: `
    .solo-admin {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }

    .tab-panel {
      padding-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .hint {
      margin: 0;
      font-size: 0.88rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface-variant);
    }

    .errore {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-error, #b3261e);
      font-weight: 500;
      margin: 0;
    }

    .estraendo {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-primary);
      font-weight: 500;
      margin: 0;
    }

    .countdown {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 84px;
      height: 84px;
      margin: 4px auto;
      border-radius: 50%;
      border: 3px solid var(--mat-sys-primary);
      font-size: 2.75rem;
      font-weight: 800;
      color: var(--mat-sys-primary);
      font-variant-numeric: tabular-nums;
      animation: battito 0.7s ease-in-out;
    }

    @keyframes battito {
      0% {
        transform: scale(1.35);
        opacity: 0;
      }
      35% {
        transform: scale(1);
        opacity: 1;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .countdown {
        animation: none;
      }
    }

    /* ---------- Tab gironi ---------- */
    .gironi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }

    .girone-card {
      border: 2px solid var(--mat-sys-primary);
      border-radius: 16px;
      padding: 16px;
      background: var(--mat-sys-surface-container-low);

      h3 {
        margin: 0 0 12px;
      }
    }

    .girone-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 220px;
    }

    .girone-list li {
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
      font-weight: 600;
    }

    .slot-vuoto {
      color: var(--mat-sys-on-surface-variant);
      opacity: 0.4;
      text-align: center;
    }

    /* ---------- Tab aiuti di stato ---------- */
    .montepremi-input {
      max-width: 280px;
    }

    .posizioni-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }

    .aiuti-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .aiuti-list li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container-high);
    }

    .aiuti-list .ordine {
      flex-shrink: 0;
      font-weight: 700;
      color: var(--mat-sys-primary);
      min-width: 1.6em;
    }

    .aiuti-list .nome {
      flex: 1;
      font-weight: 600;
    }

    .aiuti-list .posizione {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
    }

    .aiuti-list .bonus {
      flex-shrink: 0;
      font-weight: 700;
      color: var(--mat-sys-primary);
      font-variant-numeric: tabular-nums;
    }

    .esclusa {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .conferma-box {
      margin-top: 4px;
    }

    .confermato {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-primary);
      font-weight: 500;
      margin: 0;
    }

    @keyframes rivela {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    .reveal-in {
      animation: rivela 0.35s ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .reveal-in {
        animation: none;
      }
    }
  `,
})
export class EstrazioniPage {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly estrazioniService = inject(EstrazioniService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });
  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });
  readonly posizioni = POSIZIONI_CANDIDATE;

  // ---------- Tab 1: gironi ----------
  readonly teamsPerGironi = computed<SquadraSorteggio[]>(() =>
    this.teams().map((t) => ({ id: t.id, name: t.name })),
  );
  readonly gironiRisultato = signal<RisultatoGironi | null>(null);
  readonly gironiRivelateOrdine = signal<SquadraSorteggio[]>([]);
  readonly gironiInCorso = signal(false);
  readonly gironiCountdown = signal<number | null>(null);

  gironeRivelato(lato: 'A' | 'B'): SquadraSorteggio[] {
    const risultato = this.gironiRisultato();
    if (!risultato) {
      return [];
    }
    const insieme = lato === 'A' ? risultato.gironeA : risultato.gironeB;
    const idInsieme = new Set(insieme.map((s) => s.id));
    return this.gironiRivelateOrdine().filter((s) => idInsieme.has(s.id));
  }

  slotsVuoti(lato: 'A' | 'B'): number[] {
    const rivelati = this.gironeRivelato(lato).length;
    return Array.from({ length: Math.max(0, 5 - rivelati) }, (_, i) => i);
  }

  async sorteggiaGironiClick(): Promise<void> {
    if (this.gironiInCorso() || this.teamsPerGironi().length !== 10) {
      return;
    }
    this.gironiInCorso.set(true);
    this.gironiRivelateOrdine.set([]);
    const risultato = sorteggiaGironi(this.teamsPerGironi());
    this.gironiRisultato.set(risultato);

    for (const squadra of risultato.ordine) {
      await this.contaAllaRovescia(this.gironiCountdown);
      this.gironiRivelateOrdine.set([...this.gironiRivelateOrdine(), squadra]);
      await attesa(900); // tempo per "assaporare" la rivelazione prima della prossima
    }
    this.gironiInCorso.set(false);
  }

  /** Conto alla rovescia 3-2-1 su un signal dedicato, per rallentare e drammatizzare una rivelazione */
  private async contaAllaRovescia(
    sig: WritableSignal<number | null>,
    da = 3,
    stepMs = 800,
  ): Promise<void> {
    for (let n = da; n >= 1; n--) {
      sig.set(n);
      await attesa(stepMs);
    }
    sig.set(null);
  }

  // ---------- Tab 2: aiuti di stato ----------
  readonly montepremiPrecedente = signal(2591.75);
  readonly posizioneSelezione = signal<Record<number, string | null>>(this.defaultPosizioni());
  readonly aiutiRisultato = signal<RisultatoAiutiDiStato | null>(null);
  readonly aiutiRivelati = signal<VincitaAiutoDiStato[]>([]);
  readonly esclusaRivelata = signal<SquadraInLotteria | null>(null);
  readonly aiutiInCorso = signal(false);
  readonly aiutiConfermati = signal(false);
  readonly aiutiCountdown = signal<number | null>(null);

  private defaultPosizioni(): Record<number, string | null> {
    // Solo un default comodo per l'anno corrente: sempre correggibile a mano.
    const risultato: Record<number, string | null> = {};
    for (const pos of POSIZIONI_CANDIDATE) {
      risultato[pos] = null;
    }
    return risultato;
  }

  /** Solo per bloccare il primo autofill dopo il primo tentativo: non un signal apposta, per non creare un giro effect -> write -> effect */
  private defaultGiaTentato = false;

  /** Precompila le posizioni per nome (solo default comodo, sempre correggibile a mano) */
  private applicaDefaultPosizioni(): void {
    const nuovo = { ...this.posizioneSelezione() };
    for (const team of this.teams()) {
      const nomeLower = team.name.toLowerCase();
      for (const [chiave, pos] of Object.entries(DEFAULT_POSIZIONE_PER_NOME)) {
        if (nomeLower.includes(chiave) && nuovo[pos] === null) {
          nuovo[pos] = team.id;
        }
      }
    }
    this.posizioneSelezione.set(nuovo);
  }

  constructor() {
    // teams() arriva async da Firestore: appena la lista è popolata (una
    // volta sola, vedi defaultGiaTentato — evita un giro infinito visto che
    // la scrittura qui sotto tocca un signal letto dallo stesso effect),
    // prova a precompilare le posizioni per nome.
    effect(() => {
      if (!this.defaultGiaTentato && this.teams().length > 0) {
        this.defaultGiaTentato = true;
        this.applicaDefaultPosizioni();
      }
    });
  }

  setPosizione(pos: number, teamId: string): void {
    this.posizioneSelezione.set({ ...this.posizioneSelezione(), [pos]: teamId });
  }

  readonly erroreAiuti = computed(() => {
    const sel = this.posizioneSelezione();
    const mancanti = POSIZIONI_CANDIDATE.filter((p) => !sel[p]);
    if (mancanti.length > 0) {
      return `Manca la squadra per la posizione: ${mancanti.map((p) => `${p}ª`).join(', ')}.`;
    }
    const idScelti = POSIZIONI_CANDIDATE.map((p) => sel[p]);
    if (new Set(idScelti).size !== idScelti.length) {
      return 'Ogni squadra può occupare una sola posizione.';
    }
    if (!this.montepremiPrecedente() || this.montepremiPrecedente() <= 0) {
      return 'Inserisci il montepremi della stagione precedente.';
    }
    return null;
  });

  readonly prossimoBonusPerc = computed(() => {
    const n = this.aiutiRivelati().length;
    const bonusList = [0.0185, 0.0115, 0.0072, 0.0045, 0.0027, 0.0015];
    return (bonusList[n] ?? 0) * 100;
  });

  async estraiAiutiClick(): Promise<void> {
    if (this.aiutiInCorso() || this.erroreAiuti()) {
      return;
    }
    const sel = this.posizioneSelezione();
    const squadre: SquadraInLotteria[] = POSIZIONI_CANDIDATE.map((pos) => {
      const teamId = sel[pos]!;
      const team = this.teams().find((t) => t.id === teamId);
      return { teamId, teamName: team?.name ?? '(sconosciuta)', posizione: pos };
    });

    this.aiutiInCorso.set(true);
    this.aiutiRivelati.set([]);
    this.esclusaRivelata.set(null);
    this.aiutiConfermati.set(false);

    const risultato = estraiAiutiDiStato(squadre, this.montepremiPrecedente());
    this.aiutiRisultato.set(risultato);

    for (const vincita of risultato.vincite) {
      await this.contaAllaRovescia(this.aiutiCountdown, 3, 900);
      this.aiutiRivelati.set([...this.aiutiRivelati(), vincita]);
      await attesa(1400); // tempo per leggere il nome e la cifra vinta
    }
    // Anche la squadra esclusa merita il suo momento di suspense
    await this.contaAllaRovescia(this.aiutiCountdown, 3, 900);
    this.esclusaRivelata.set(risultato.esclusa);
    this.aiutiInCorso.set(false);
  }

  confermaAiuti(): void {
    const risultato = this.aiutiRisultato();
    if (!risultato || this.aiutiConfermati()) {
      return;
    }
    const elenco = risultato.vincite
      .map((v) => `${v.teamName}: +${v.bonusEuro.toFixed(2)} €`)
      .join('\n');
    const totale = risultato.vincite.reduce((s, v) => s + v.bonusEuro, 0);
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Conferma aiuti di stato',
        message:
          `Scrivere questi bonus negli indennizzi di settembre?\n\n${elenco}` +
          `\n\nTotale: ${totale.toFixed(2)} €. Non è annullabile da qui: va corretto a mano se serve.`,
        confirmLabel: 'Conferma e scrivi',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confermato) => {
      if (!confermato) {
        return;
      }
      try {
        await this.estrazioniService.confermaAiutiDiStato(risultato.vincite);
        this.aiutiConfermati.set(true);
        this.snackBar.open('Bonus scritti negli indennizzi di settembre.', 'OK', {
          duration: 4000,
        });
      } catch (err) {
        console.error(err);
        this.snackBar.open(
          err instanceof Error ? err.message : "Errore scrivendo gli aiuti di stato.",
          'Chiudi',
          { duration: 5000 },
        );
      }
    });
  }
}
