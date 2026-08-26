import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AstaStato, Player, Svincolato } from '../../../core/models';
import { ROLE_ORDER, roleColor, splitRoles } from '../../../core/roles';
import { AstaService } from '../../../core/services/asta.service';
import { AuthService } from '../../../core/services/auth.service';
import { TeamService } from '../../../core/services/team.service';
import { normalize } from '../../../core/text-utils';
import { ExpandablePlayerCard } from '../../../shared/expandable-player-card';

/** Giocatore di rosa, con il nome della squadra che lo possiede */
interface RosterEntry {
  player: Player;
  teamId: string;
  teamName: string;
}

/**
 * Sezione "Svincolati": giocatori presenti nel listone fantacalcio.it
 * ma non in nessuna rosa. Filtri per nome e ruolo, ordinati per quotazione.
 * I giocatori possono avere fino a 3 ruoli (es. "M;C").
 * Gli admin possono aprire l'asta live su un giocatore.
 */
@Component({
  selector: 'app-svincolati-section',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    ExpandablePlayerCard,
  ],
  template: `
    <div class="section-header">
      <h2>Svincolati</h2>
      <div class="header-actions">
        @if (isAdmin()) {
          <button matButton="tonal" (click)="apriAstaRandom()" [disabled]="filtered().length === 0">
            <mat-icon>casino</mat-icon>
            Apri asta random
          </button>
        }
        <span class="count">{{ filtered().length }} giocatori</span>
      </div>
    </div>

    @if (astaAperta(); as s) {
      <p class="asta-banner">
        Asta in corso su <strong>{{ s.giocatoreNome }}</strong> —
        <a routerLink="/asta">vai alla pagina asta</a>
      </p>
    }

    <div class="filters">
      <mat-form-field appearance="fill" subscriptSizing="dynamic">
        <mat-label>Cerca giocatore</mat-label>
        <input matInput [value]="search()" (input)="search.set($any($event.target).value)" />
        <mat-icon matPrefix>search</mat-icon>
      </mat-form-field>

      <!-- Filtro multiplo: si possono selezionare più ruoli insieme -->
      <mat-form-field appearance="fill" subscriptSizing="dynamic">
        <mat-label>Ruoli</mat-label>
        <mat-select
          [value]="filterRuoli()"
          (selectionChange)="filterRuoli.set($event.value)"
          multiple
        >
          @for (ruolo of ruoliDisponibili(); track ruolo) {
            <mat-option [value]="ruolo">{{ ruolo }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <!-- Reset rapido filtri: visibile solo se qualche filtro è attivo -->
      @if (filterRuoli().length > 0 || search()) {
        <button matIconButton aria-label="Azzera filtri" class="reset-filters" (click)="azzeraFiltri()">
          <mat-icon>filter_alt_off</mat-icon>
        </button>
      }
    </div>

    @if (filtered().length === 0) {
      <p class="empty-state">
        Nessun svincolato corrisponde ai filtri. La lista viene popolata
        automaticamente dallo script di aggiornamento quotazioni.
      </p>
    } @else {
      <ul class="list">
        @for (p of filtered(); track p.id) {
          <li>
            <span class="chips">
              @for (r of rolesOf(p); track r) {
                <span
                  class="chip"
                  [style.border-color]="colorFor(r)"
                  [style.color]="colorFor(r)"
                >{{ r }}</span>
              }
            </span>
            <span class="name">{{ p.name }}</span>
            <span class="team">{{ p.squadra }}</span>
            @if (isAdmin()) {
              <button matButton="tonal" class="auction-btn" (click)="apriAsta(p)">
                <mat-icon>gavel</mat-icon>
                Apri asta
              </button>
            }
            <span class="quota">{{ p.quotazioneAttuale | number: '1.0-0' }}</span>
          </li>
        }
      </ul>
    }

    <!-- Ricerca estesa alle rose: compare solo con ricerca o filtro ruoli
         attivi (la lista sopra resta il "mercato" degli svincolati,
         sfogliabile senza filtri) -->
    @if (search() || filterRuoli().length > 0) {
      <h3>Nelle rose</h3>
      @if (risultatiRosa().length === 0) {
        <p class="empty-state">Nessun giocatore di rosa corrisponde alla ricerca.</p>
      } @else {
        <div class="cards">
          @for (r of risultatiRosa(); track r.player.id) {
            <app-expandable-player-card
              [player]="r.player"
              [extraLabel]="r.teamName"
              [compact]="true"
            />
          }
        </div>
      }
    }
  `,
  styles: `
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    h3 {
      margin: 16px 0 8px;
      font-size: 0.95rem;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .count {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .asta-banner {
      margin: 0 0 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--mat-sys-primary-container);
      font-size: 0.9rem;
    }

    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .filters mat-form-field {
      flex: 1;
      min-width: 140px;
    }

    .reset-filters {
      align-self: center;
      flex-shrink: 0;
    }

    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1.5px solid currentColor;
      font-size: 0.72rem;
      font-weight: 700;
      line-height: 1.4;
      white-space: nowrap;
    }

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .list li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      font-size: 0.875rem;
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .chips {
      flex-shrink: 0;
      min-width: 36px;
    }

    .name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .team {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
      white-space: nowrap;
    }

    .auction-btn {
      min-height: 40px;
      flex-shrink: 0;
    }

    .quota {
      font-weight: 700;
      color: var(--mat-sys-primary);
      white-space: nowrap;
      min-width: 32px;
      text-align: right;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `,
})
export class SvincolatiSection {
  private readonly teamService = inject(TeamService);
  private readonly astaService = inject(AstaService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);

  readonly svincolati = toSignal(this.teamService.svincolati$, {
    initialValue: [] as Svincolato[],
  });

  /**
   * Tutti i giocatori di tutte le rose, con la squadra proprietaria — usato
   * solo per la ricerca "Nelle rose" (non per il mercato svincolati sopra).
   */
  private readonly rosterEntries = toSignal(
    this.teamService.teams$.pipe(
      switchMap((teams) =>
        teams.length
          ? combineLatest(
              teams.map((team) =>
                this.teamService.players$(team.id).pipe(
                  map((players) =>
                    players.map((player) => ({ player, teamId: team.id, teamName: team.name })),
                  ),
                ),
              ),
            ).pipe(map((perTeam) => perTeam.flat()))
          : of([] as RosterEntry[]),
      ),
    ),
    { initialValue: [] as RosterEntry[] },
  );

  /** true se l'utente ha effettuato il login come admin (non anonimo) */
  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  /** Stato dell'asta: per mostrare il banner quando è aperta */
  private readonly statoAsta = toSignal(this.astaService.stato$, {
    initialValue: undefined as AstaStato | undefined,
  });
  readonly astaAperta = computed(() => {
    const s = this.statoAsta();
    return s && s.aperta ? s : null;
  });

  /** Ruoli selezionati nel filtro (vuoto = tutti) */
  readonly filterRuoli = signal<string[]>([]);
  readonly search = signal('');

  /** Ruoli distinti presenti nella lista, nell'ordine canonico */
  readonly ruoliDisponibili = computed(() => {
    const set = new Set<string>();
    for (const p of this.svincolati()) {
      for (const r of splitRoles(p.ruolo)) {
        set.add(r);
      }
    }
    return [...set].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  });

  /** Lista filtrata e ordinata per quotazione decrescente */
  readonly filtered = computed(() => {
    const ruoli = this.filterRuoli();
    const term = normalize(this.search());
    return this.svincolati()
      .filter(
        (p) =>
          // il filtro matcha se il giocatore ha ALMENO UNO dei ruoli selezionati
          (!ruoli.length || splitRoles(p.ruolo).some((r) => ruoli.includes(r))) &&
          (!term || normalize(p.name).includes(term)),
      )
      .sort((a, b) => b.quotazioneAttuale - a.quotazioneAttuale);
  });

  /**
   * Giocatori di rosa che corrispondono a nome e/o ruoli cercati — vuoto se
   * non c'è alcun filtro attivo (la lista svincolati sopra resta quella di
   * default).
   */
  readonly risultatiRosa = computed(() => {
    const term = normalize(this.search());
    const ruoli = this.filterRuoli();
    if (!term && ruoli.length === 0) {
      return [];
    }
    return this.rosterEntries()
      .filter(
        (r) =>
          normalize(r.player.name).includes(term) &&
          (!ruoli.length || splitRoles(r.player.ruolo).some((ruolo) => ruoli.includes(ruolo))),
      )
      .sort((a, b) => b.player.quotazioneAttuale - a.player.quotazioneAttuale);
  });

  colorFor(role: string): string {
    return roleColor(role);
  }

  /** Ruoli singoli di un giocatore, per i chip */
  rolesOf(player: { ruolo: string }): string[] {
    return splitRoles(player.ruolo);
  }

  /** Azzera i filtri ruoli e ricerca */
  azzeraFiltri(): void {
    this.filterRuoli.set([]);
    this.search.set('');
  }

  /** Apre l'asta live su un giocatore svincolato a caso */
  async apriAstaRandom(): Promise<void> {
    const candidati = this.filtered();
    if (candidati.length === 0) {
      return;
    }
    const scelto = candidati[Math.floor(Math.random() * candidati.length)];
    await this.apriAsta(scelto);
  }

  /** Apre l'asta live sul giocatore scelto */
  async apriAsta(giocatore: Svincolato): Promise<void> {
    try {
      await this.astaService.apriAsta(giocatore);
      this.snackBar.open(`Asta aperta su ${giocatore.name}`, undefined, { duration: 3000 });
    } catch {
      this.snackBar.open('Errore durante l\u2019apertura dell\u2019asta', undefined, {
        duration: 3000,
      });
    }
  }
}