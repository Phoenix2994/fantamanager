import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AstaStato, Team } from '../../core/models';
import { AstaService, ProvenienzaAsta } from '../../core/services/asta.service';
import { AuthService } from '../../core/services/auth.service';
import { TeamService } from '../../core/services/team.service';

const STORAGE_KEY = 'asta.miaSquadra';

/** Incrementi di rilancio disponibili */
const INCREMENTI = [0.1, 0.2, 0.5, 1] as const;

/** Colore del bordo/chip per gruppo di ruolo */
const ROLE_COLORS: Record<string, string> = {
  Por: '#f9a825',
  B: '#2e7d32',
  Dd: '#2e7d32',
  Dc: '#2e7d32',
  Ds: '#2e7d32',
  M: '#508af4',
  C: '#508af4',
  E: '#508af4',
  W: '#6a1b9a',
  T: '#6a1b9a',
  A: '#c62828',
  Pc: '#c62828',
};

/**
 * Pagina dell'asta live per i partecipanti (/asta).
 *
 * L'admin autenticato vede SEMPRE il pannello di controllo (assegna/chiudi)
 * in cima, e sotto può comunque partecipare come squadra (scelta o rilancio).
 * I partecipanti vedono solo il flusso squadra → rilancio.
 */
@Component({
  selector: 'app-asta-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
  ],
  template: `
    <div class="asta-page">
      <header class="asta-header">
        <h1>Asta live</h1>
        <span class="spacer"></span>
        @if (isAdmin()) {
          <a matButton routerLink="/dashboard">
            <mat-icon>dashboard</mat-icon>
            Dashboard
          </a>
        } @else {
          <a matButton routerLink="/login">
            <mat-icon>admin_panel_settings</mat-icon>
            Accedi come admin
          </a>
        }
      </header>

      <!-- PANNELLO ADMIN (sempre visibile per l'admin) -->
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
                  <div class="rilanciante">Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                }
              </div>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
                <mat-label>Assegna alla squadra vincitrice</mat-label>
                <mat-select [value]="assegnaA()" (selectionChange)="assegnaA.set($event.value)">
                  @for (team of teams(); track team.id) {
                    <mat-option [value]="team.id">{{ team.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
                <mat-label>Voce di spesa</mat-label>
                <mat-select [value]="provenienza()" (selectionChange)="provenienza.set($event.value)">
                  <mat-option value="acquistiAstaSettembre">Asta settembre</mat-option>
                  <mat-option value="acquistiMercatoInfrasettimanale">Asta infrasettimanale</mat-option>
                </mat-select>
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

      <!-- SCEGLI SQUADRA (partecipanti non ancora identificati) -->
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
                {{ team.name }}
              </button>
            }
          </div>
        </mat-card>
      }

      <!-- PANNELLO RILANCIO (partecipante identificato) -->
      @if (miaSquadra(); as squadra) {
        <mat-card class="panel">
          <div class="squadra-bar">
            <span>Stai rilanciando per:</span>
            <strong>{{ squadra.name }}</strong>
            <button matButton (click)="cambiaSquadra()">Cambia</button>
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
                  <div class="rilanciante">Ultimo rilancio: {{ s.rilanciatoDaTeamName }}</div>
                }
              </div>

              <div class="bids">
                @for (inc of incrementi; track inc) {
                  <button
                    matButton="filled"
                    class="bid-btn"
                    [disabled]="sonoUltimoRilanciante() || inCooldown()"
                    (click)="rilancia(inc)"
                  >
                    +{{ inc | number: '1.1-1' }} €
                  </button>
                }
              </div>

              <!-- Rilancio custom: importo libero superiore al prezzo attuale -->
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
                <mat-label>Rilancio custom (€)</mat-label>
                <input
                  matInput
                  type="number"
                  step="0.1"
                  min="0.1"
                  [value]="customBid()"
                  (input)="customBid.set($any($event.target).valueAsNumber || 0)"
                />
                <mat-hint>Deve essere superiore a {{ stato()?.prezzoAttuale ?? 0 | number: '1.2-2' }} €</mat-hint>
              </mat-form-field>
              <button
                matButton="filled"
                class="bid-btn custom-bid-btn"
                [disabled]="!customValida() || inCooldown()"
                (click)="rilanciaCustom()"
              >
                Rilancia {{ customBid() | number: '1.2-2' }} €
              </button>

              @if (inCooldown()) {
                <p class="hint warn">Rilancio registrato: attendi un istante…</p>
              } @else if (sonoUltimoRilanciante()) {
                <p class="hint warn">La tua squadra è già l'ultima rilanciante: attendi una controparte.</p>
              }
            } @else {
              <p class="empty-state">L'asta è chiusa. Attendi che l'amministratore ne apra una nuova.</p>
            }
          } @else {
            <p class="empty-state">Nessuna asta in corso. Attendi l'apertura.</p>
          }
        </mat-card>
      }

      <footer class="asta-footer">
        <a matButton routerLink="/tv" target="_blank">
          <mat-icon>tv</mat-icon>
          Apri vista TV
        </a>
      </footer>
    </div>
  `,
  styles: `
    .asta-page {
      max-width: 560px;
      margin: 0 auto;
      padding: 16px;
    }

    .asta-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-size: 1.4rem;
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

    .spacer {
      flex: 1;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
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
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
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
    }

    .squadra-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
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
  private readonly snackBar = inject(MatSnackBar);

  readonly incrementi = INCREMENTI;

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  readonly stato = toSignal(this.astaService.stato$, { initialValue: undefined as AstaStato | undefined });

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  /** Squadra del partecipante corrente (persistita in localStorage) */
  readonly miaSquadra = signal<Team | null>(this.leggiSquadraSalvata());

  /** Selezione admin per l'assegnazione */
  readonly assegnaA = signal<string>('');
  readonly provenienza = signal<ProvenienzaAsta>('acquistiAstaSettembre');

  /** Rilancio custom (importo libero) */
  readonly customBid = signal<number>(0);

  /** Cooldown anti-race: dopo un rilancio i pulsanti restano disabilitati 1s */
  readonly inCooldown = signal(false);

  constructor() {
    // Se la squadra salvata non esiste più nel DB, resetta la scelta.
    // Attenzione: teams parte da [] (initialValue) — resetta SOLO quando
    // la lista è stata effettivamente caricata (length > 0), altrimenti
    // cancellerebbe la squadra appena salvata a ogni refresh.
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
  }

  /** true se la mia squadra è l'ultima rilanciante */
  readonly sonoUltimoRilanciante = computed(
    () => this.stato()?.rilanciatoDaTeamId === this.miaSquadra()?.id,
  );

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
      // Se non c'è già una sessione (admin o anonima), crea un login anonimo
      // per poter scrivere su asta/statoCorrente. Se invece l'utente è già
      // autenticato (es. admin), NON sovrascrivere la sessione: salva solo
      // la squadra in localStorage.
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

  /** true se il rilancio custom è valido (> prezzo attuale) */
  readonly customValida = computed(
    () => this.customBid() > (this.stato()?.prezzoAttuale ?? 0),
  );

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
      await this.astaService.rilancia(team.id, team.name, incremento);
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
    try {
      await this.astaService.assegna(teamId, team?.name ?? '', this.provenienza());
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
    return ruolo.split(';').map((r) => r.trim()).filter(Boolean);
  }

  colorFor(role: string): string {
    return ROLE_COLORS[role] ?? 'var(--mat-sys-on-surface-variant)';
  }
}
