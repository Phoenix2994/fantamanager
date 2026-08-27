import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatButtonModule } from '@angular/material/button';
import {
  CONTRACT_TYPES,
  ContractType,
  LoanedPlayer,
  Player,
  Team,
} from '../../../core/models';
import { calcolaValoreAttuale, round2 } from '../../../core/finance-calculator';
import { roleColor, roleSortKey, splitRoles } from '../../../core/roles';
import { AuthService } from '../../../core/services/auth.service';
import { FinanceService } from '../../../core/services/finance.service';
import { TeamSelectionService } from '../../../core/services/team-selection.service';
import { TeamService } from '../../../core/services/team.service';
import { ExpandablePlayerCard } from '../../../shared/expandable-player-card';
import { ConfirmDialog } from '../dialogs/confirm-dialog';
import { LoanDialog } from '../dialogs/loan-dialog';
import {
  PlayerDialog,
  ProvenienzaAcquisto,
} from '../dialogs/player-dialog';
import { ReimborsoDialog } from '../dialogs/reimborso-dialog';
import { RenewDialog } from '../dialogs/renew-dialog';
import { RenewPreviewDialog } from '../dialogs/renew-preview-dialog';


@Component({
  selector: 'app-players-section',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTableModule,
    ExpandablePlayerCard,
  ],
  template: `
    <div class="section-header">
      <div class="header-actions">
        @if (canPreviewRinnovi()) {
          <button matButton="tonal" (click)="openRenewPreview()">
            <mat-icon>calculate</mat-icon>
            Anteprima rinnovi
          </button>
        }
        @if (isAdmin()) {
          <button matButton="tonal" (click)="openAddPlayer()" [disabled]="!selectedTeamId()">
            <mat-icon>person_add</mat-icon>
            Aggiungi
          </button>
        }
      </div>
    </div>

    @if (teams().length === 0) {
      <p class="empty-state">
        Nessuna squadra trovata. I dati verranno popolati con l'import iniziale
        (script Python da ROSE.xlsx) o manualmente.
      </p>
    } @else {
      <div class="filters">
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

        <!-- <mat-form-field appearance="fill" subscriptSizing="dynamic">
          <mat-label>Contratto</mat-label>
          <mat-select [value]="filterContratto()" (selectionChange)="filterContratto.set($event.value)">
            <mat-option value="">Tutti</mat-option>
            @for (tipo of contractTypes; track tipo) {
              <mat-option [value]="tipo">{{ tipo }}</mat-option>
            }
          </mat-select>
        </mat-form-field> -->

        <!-- Reset rapido filtri: visibile solo se qualche filtro è attivo -->
        @if (filterRuoli().length > 0) {
          <button matIconButton aria-label="Azzera filtri" class="reset-filters" (click)="azzeraFiltri()">
            <mat-icon>filter_alt_off</mat-icon>
          </button>
        }
      </div>

      <div class="rosa-summary">
        Valore rosa:
        <strong>{{ valoreRosa() | number: '1.2-2' }} €</strong>
        · {{ players().length }} giocatori
      </div>

      <!-- MOBILE: card espandibili -->
      @if (isMobile()) {
        <div class="cards">
          @for (player of filteredPlayers(); track player.id) {
            <app-expandable-player-card [player]="player">
              @if (isAdmin()) {
                <div cardActions class="card-actions">
                  <button matButton="tonal" (click)="openEditPlayer(player)">
                    <mat-icon>edit</mat-icon> Modifica
                  </button>
                  <button matButton="tonal" (click)="openRenewPlayer(player)">
                    <mat-icon>autorenew</mat-icon> Rinnova
                  </button>
                  <button matButton="tonal" (click)="openReimborso(player)">
                    <mat-icon>currency_exchange</mat-icon> Rimborso
                  </button>
                  <button matButton="tonal" (click)="confirmDeletePlayer(player)">
                    <mat-icon>delete</mat-icon> Elimina
                  </button>
                </div>
              }
            </app-expandable-player-card>
          } @empty {
            <p class="empty-state">Nessun giocatore corrisponde ai filtri.</p>
          }
        </div>
      } @else {
        <!-- DESKTOP/TABLET: tabella completa -->
        <div class="table-scroll">
          <table mat-table [dataSource]="filteredPlayers()">
            <ng-container matColumnDef="ruolo">
              <th mat-header-cell *matHeaderCellDef>Ruolo</th>
              <td mat-cell *matCellDef="let player" class="ruolo">
                <span class="chips">
                  @for (r of rolesOf(player); track r) {
                    <span
                      class="chip small"
                      [style.border-color]="colorFor(r)"
                      [style.color]="colorFor(r)"
                    >{{ r }}</span>
                  }
                </span>
              </td>
            </ng-container>

            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Giocatore</th>
              <td mat-cell *matCellDef="let player" class="player-name">{{ player.name }}</td>
            </ng-container>

            <ng-container matColumnDef="speso">
              <th mat-header-cell *matHeaderCellDef>Speso €</th>
              <td mat-cell *matCellDef="let player">{{ player.acquistoRinnovoSpesa | number: '1.2-2' }}</td>
            </ng-container>

            <ng-container matColumnDef="contratto">
              <th mat-header-cell *matHeaderCellDef>Contratto</th>
              <td mat-cell *matCellDef="let player">{{ player.contractType }}</td>
            </ng-container>

            <ng-container matColumnDef="perc">
              <th mat-header-cell *matHeaderCellDef>% Rinn.</th>
              <td mat-cell *matCellDef="let player">{{ perc(player.prossimaPercRinnovo) }}</td>
            </ng-container>

            <ng-container matColumnDef="spesaRinnovo">
              <th mat-header-cell *matHeaderCellDef>Spesa rinnovo €</th>
              <td mat-cell *matCellDef="let player">{{ player.prossimaSpesaRinnovo | number: '1.2-2' }}</td>
            </ng-container>

            <ng-container matColumnDef="qi">
              <th mat-header-cell *matHeaderCellDef>Q.I.</th>
              <td mat-cell *matCellDef="let player">{{ player.quotazioneIniziale | number: '1.0-2' }}</td>
            </ng-container>

            <ng-container matColumnDef="qa">
              <th mat-header-cell *matHeaderCellDef>Q.A.</th>
              <td mat-cell *matCellDef="let player">{{ player.quotazioneAttuale | number: '1.0-2' }}</td>
            </ng-container>

            <ng-container matColumnDef="vi">
              <th mat-header-cell *matHeaderCellDef>V.I. €</th>
              <td mat-cell *matCellDef="let player">{{ player.valoreIniziale | number: '1.2-2' }}</td>
            </ng-container>

            <ng-container matColumnDef="va">
              <th mat-header-cell *matHeaderCellDef>V.A. €</th>
              <td mat-cell *matCellDef="let player" class="va">{{ player.valoreAttuale | number: '1.2-2' }}</td>
            </ng-container>

            @if (isAdmin()) {
              <ng-container matColumnDef="azioni">
                <th mat-header-cell *matHeaderCellDef>Azioni</th>
                <td mat-cell *matCellDef="let player" class="actions">
                  <button matIconButton aria-label="Modifica" (click)="openEditPlayer(player)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button matIconButton aria-label="Rinnova" (click)="openRenewPlayer(player)">
                    <mat-icon>autorenew</mat-icon>
                  </button>
                  <button matIconButton aria-label="Rimborso" (click)="openReimborso(player)">
                    <mat-icon>currency_exchange</mat-icon>
                  </button>
                  <button matIconButton aria-label="Elimina" (click)="confirmDeletePlayer(player)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </td>
              </ng-container>
            }

                        <tr mat-header-row *matHeaderRowDef="displayedColumns()"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns()"
                [class.is-fuori-serie-a]="row.fuoriSerieA"></tr>
            <tr class="mat-mdc-row" *matNoDataRow>
              <td class="mat-mdc-cell empty-state" [attr.colspan]="displayedColumns().length">
                Nessun giocatore corrisponde ai filtri.
              </td>
            </tr>
          </table>
        </div>
      }

      <!-- Giocatori ceduti in prestito -->
      <div class="loans-header">
        <h3>Ceduti in prestito</h3>
        @if (isAdmin()) {
          <button matButton="tonal" (click)="openAddLoan()" [disabled]="!selectedTeamId()">
            <mat-icon>swap_horiz</mat-icon>
            Prestito
          </button>
        }
      </div>
      @if (loans().length === 0) {
        <p class="empty-state">Nessun giocatore ceduto in prestito.</p>
      } @else {
        <ul class="loans-list">
          @for (loan of loans(); track loan.id) {
            <li>
              <span>
                <strong>{{ loan.playerName }}</strong>
                → {{ loan.toTeam }}
                <span class="loan-type">({{ loan.contractType }})</span>
              </span>
              @if (isAdmin()) {
                <button matIconButton aria-label="Elimina prestito" (click)="confirmDeleteLoan(loan)">
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
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
      flex-wrap: wrap;
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

    /* ---------- Chip ruoli (contorno colorato) ---------- */
    .chips {
      display: inline-flex;
      gap: 4px;
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

    .chip.small {
      padding: 1px 6px;
      font-size: 0.68rem;
    }

    /* ---------- Card mobile (vedi app-expandable-player-card) ---------- */
    .cards {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Giocatore fuori Serie A (non in alcun listone), riga della tabella desktop */
    tr.is-fuori-serie-a {
      background: rgba(252, 185, 203, 0.4);
    }

    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    /* ---------- Tabella desktop ---------- */
    .table-scroll {
      overflow-x: auto;
    }

    table {
      width: 100%;
      min-width: 760px;
    }

    th {
      font-size: 0.75rem;
      white-space: nowrap;
    }

    td {
      font-size: 0.85rem;
      white-space: nowrap;
    }

    .player-name {
      font-weight: 500;
    }

    .va {
      font-weight: 600;
    }

    .actions {
      display: flex;
      gap: 2px;
    }

    .actions button {
      width: 36px;
      height: 36px;
    }

    .rosa-summary {
      margin: 12px 0;
      font-size: 0.9rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .loans-header {
      margin: 12px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .loans-list {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: 0.875rem;
    }

    .loans-list li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
    }

    .loan-type {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `,
})
export class PlayersSection {
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly selection = inject(TeamSelectionService);

  /** Layout mobile (<640px): card espandibili invece della tabella */
  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 639.98px)').pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  /** Ruoli SINGOLI distinti nella rosa corrente, nell'ordine canonico */
  readonly ruoliDisponibili = computed(() => {
    const set = new Set<string>();
    for (const p of this.players()) {
      for (const r of splitRoles(p.ruolo)) {
        set.add(r);
      }
    }
    return [...set].sort((a, b) => roleSortKey(a) - roleSortKey(b));
  });

  readonly contractTypes = CONTRACT_TYPES;

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });
  readonly selectedTeamId = this.selection.selectedTeamId;

  readonly players = toSignal(
    toObservable(this.selectedTeamId).pipe(
      switchMap((id) => (id ? this.teamService.players$(id) : of([] as Player[]))),
    ),
    { initialValue: [] as Player[] },
  );

  readonly loans = toSignal(
    toObservable(this.selectedTeamId).pipe(
      switchMap((id) =>
        id ? this.teamService.loanedPlayers$(id) : of([] as LoanedPlayer[]),
      ),
    ),
    { initialValue: [] as LoanedPlayer[] },
  );

  /** true se l'utente ha effettuato il login come admin */
  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  /**
   * Squadra di cui l'utente corrente è proprietario (myTeam$) INSIEME a un
   * flag che dice se quell'osservabile ha già emesso almeno una volta.
   * Serve perché myTeam$ dipende dallo stato di autenticazione di Firebase,
   * che su una navigazione "fresca" (es. subito dopo il login) può risolversi
   * un tick DOPO che teams() è già popolato: senza questo flag l'effect di
   * auto-selezione qui sotto rischia di scegliere la prima squadra della
   * lista prima ancora di sapere se l'utente ha una squadra propria, e non
   * ha più occasione di correggersi (vedi guardia sotto). Un solo toSignal
   * su un solo observable garantisce che valore e flag siano sempre in sync.
   */
  private readonly myTeamState = toSignal(
    this.authService.myTeam$.pipe(map((team) => ({ resolved: true, team }))),
    { initialValue: { resolved: false, team: null as Team | null } },
  );

  /** Squadra di cui l'utente corrente è proprietario, se ha fatto login come squadra */
  readonly myTeam = computed(() => this.myTeamState().team);

  /**
   * Anteprima aggregata dei rinnovi: utile a chi ha fatto login come
   * squadra sulla PROPRIA rosa, ma anche all'admin su qualunque rosa stia
   * guardando (per pianificare più rinnovi prima di eseguirli uno a uno —
   * resta comunque solo un calcolo, l'esecuzione vera resta sempre admin).
   */
  readonly canPreviewRinnovi = computed(() => {
    if (!this.selectedTeamId()) {
      return false;
    }
    if (this.isAdmin()) {
      return true;
    }
    const mia = this.myTeam();
    return !!mia && mia.id === this.selectedTeamId();
  });

  /** Colonne della tabella: la colonna azioni compare solo per gli admin */
  readonly displayedColumns = computed(() => [
    'ruolo',
    'name',
    'speso',
    'contratto',
    'perc',
    'spesaRinnovo',
    'qi',
    'qa',
    'vi',
    'va',
    ...(this.isAdmin() ? (['azioni'] as const) : []),
  ]);

  /** Ruoli selezionati nel filtro (vuoto = tutti) */
  readonly filterRuoli = signal<string[]>([]);
  readonly filterContratto = signal<ContractType | ''>('');

  readonly filteredPlayers = computed(() => {
    const ruoli = this.filterRuoli();
    const contratto = this.filterContratto();

    return this.players()
      .filter(
        (p) =>
          // il filtro matcha se il giocatore ha ALMENO UNO dei ruoli selezionati
          (!ruoli.length || splitRoles(p.ruolo).some((r) => ruoli.includes(r))) &&
          (!contratto || p.contractType === contratto),
      )
      .sort(
        (a, b) =>
          roleSortKey(a.ruolo) - roleSortKey(b.ruolo) || a.name.localeCompare(b.name),
      );
  });

  readonly valoreRosa = computed(() =>
    Math.round(this.players().reduce((sum, p) => sum + (p.valoreAttuale || 0), 0) * 100) / 100,
  );

  constructor() {
    // Auto-selezione all'apertura, in ordine di preferenza:
    // 1. la squadra con cui si è fatto login (account squadra vero);
    // 2. l'ultima squadra scelta per l'asta (persistita in localStorage);
    // 3. la prima disponibile.
    effect(() => {
      const teams = this.teams();
      const { resolved, team: mia } = this.myTeamState();
      if (this.selectedTeamId() || teams.length === 0 || !resolved) {
        return;
      }
      if (mia) {
        this.selection.select(mia.id);
        return;
      }
      try {
        const raw = localStorage.getItem('asta.miaSquadra');
        if (raw) {
          const salvata = JSON.parse(raw) as Team;
          const match = teams.find((t) => t.id === salvata.id);
          if (match) {
            this.selection.select(match.id);
            return;
          }
        }
      } catch {
        // localStorage non disponibile o JSON invalido: fallback sotto
      }
      this.selection.select(teams[0].id);
    });
  }

  /** Azzera il filtro ruoli */
  azzeraFiltri(): void {
    this.filterRuoli.set([]);
  }

  // ------------------------------------------------------------- giocatori

  async openAddPlayer(): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open(PlayerDialog, { data: { mode: 'create' }, width: '95vw', maxWidth: '520px' })
        .afterClosed(),
    );
    if (!result || !this.selectedTeamId()) {
      return;
    }

    // Mappa la provenienza sulla voce di spesa da incrementare
    const CAMPO_PROVENIENZA = {
      astaSettembre: 'acquistiAstaSettembre',
      infrasettimanale: 'acquistiMercatoInfrasettimanale',
      astaGennaio: 'acquistiAstaGennaio',
      trasferimenti: 'trasferimentiUscita',
    } as const;

    try {
      await this.teamService.addPlayer(this.selectedTeamId()!, result);

      // Somma i soldi spesi alla voce di spesa della provenienza scelta
      if (result.acquistoRinnovoSpesa > 0) {
        const vaNuovo = calcolaValoreAttuale(
          result.valoreIniziale,
          result.quotazioneIniziale,
          result.quotazioneAttuale,
        );
        const nuovaRosa =
          Math.round((this.valoreRosa() + (vaNuovo || 0)) * 100) / 100;
        await this.financeService.addAcquisto(
          this.selectedTeamId()!,
          CAMPO_PROVENIENZA[result.provenienza as ProvenienzaAcquisto],
          result.acquistoRinnovoSpesa,
          nuovaRosa,
          result.name,
        );
      }

      this.snackBar.open('Giocatore aggiunto', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante il salvataggio', undefined, { duration: 3000 });
    }
  }

  async openEditPlayer(player: Player): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open(PlayerDialog, {
          data: { mode: 'edit', player },
          width: '95vw',
          maxWidth: '520px',
        })
        .afterClosed(),
    );
    if (!result || !this.selectedTeamId()) {
      return;
    }
    try {
      await this.teamService.updatePlayer(this.selectedTeamId()!, player.id, result);
      this.snackBar.open('Giocatore aggiornato', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante il salvataggio', undefined, { duration: 3000 });
    }
  }

  async openRenewPlayer(player: Player): Promise<void> {
    const nuovaPerc = await firstValueFrom(
      this.dialog
        .open(RenewDialog, { data: { player }, width: '95vw', maxWidth: '440px' })
        .afterClosed(),
    );
    // Procede SOLO con una percentuale valida: null/undefined = annullato
    if (
      typeof nuovaPerc !== 'number' ||
      !Number.isFinite(nuovaPerc) ||
      nuovaPerc <= 0 ||
      !this.selectedTeamId()
    ) {
      return;
    }
    try {
      // Giocatore + finanze in un unico batch atomico e annullabile
      const rinnovo = await this.teamService.eseguiRinnovo(
        this.selectedTeamId()!,
        player.id,
        nuovaPerc,
        this.valoreRosa(),
      );

      this.snackBar.open(
        `${player.name} rinnovato: +${round2(rinnovo)} € ai rinnovi`,
        undefined,
        { duration: 3000 },
      );
    } catch {
      this.snackBar.open('Errore durante il rinnovo', undefined, { duration: 3000 });
    }
  }

  /**
   * Anteprima aggregata del costo di rinnovo: apre il dialog con SOLO i
   * giocatori non ancora rinnovati quest'anno (acquistoRinnovoSpesa === 0,
   * stessa condizione usata per l'evidenziazione "già rinnovato" altrove).
   * Puramente informativo: nessuna scrittura, il rinnovo resta admin.
   */
  openRenewPreview(): void {
    // Nome della squadra di cui è visibile la rosa: per l'admin può essere
    // una qualunque, per una squadra loggata è già garantita essere la
    // propria (vedi canPreviewRinnovi).
    const team = this.teams().find((t) => t.id === this.selectedTeamId());
    if (!team) {
      return;
    }
    const daRinnovare = this.players().filter((p) => !(p.acquistoRinnovoSpesa > 0));
    this.dialog.open(RenewPreviewDialog, {
      data: { teamName: team.name, players: daRinnovare },
      width: '95vw',
      maxWidth: '560px',
    });
  }

  /**
   * Rimborso/rescissione completa:
   * 1. elimina il giocatore dalla rosa
   * 2. somma alle spese: rimborso (% × speso) ai Rimborsi,
   *    indennizzo (% × V.A.) agli Indennizzi sett/gen a scelta,
   *    rinnovo (% rinnovo × V.A.) ai Rinnovi
   * 3. ricalcola tutti i derivati (tasse comprese)
   */
  async openReimborso(player: Player): Promise<void> {
    const params = await firstValueFrom(
      this.dialog
        .open(ReimborsoDialog, { data: { player }, width: '95vw', maxWidth: '480px' })
        .afterClosed(),
    );
    if (!params || !this.selectedTeamId()) {
      return;
    }
    try {
      // Valore rosa aggiornato (senza il giocatore ceduto)
      const nuovaRosa =
        Math.round((this.valoreRosa() - (player.valoreAttuale || 0)) * 100) / 100;

      // Eliminazione + rimborso/indennizzo in un unico batch atomico e annullabile
      const riepilogo = await this.teamService.eseguiRimborso(
        this.selectedTeamId()!,
        player.id,
        params,
        nuovaRosa,
      );

      this.snackBar.open(
        `Rimborso ${player.name}: +${round2(riepilogo.rimborso)} € rimborsi, ` +
          `+${round2(riepilogo.indennizzo)} € indennizzi ${params.mese}`,
        undefined,
        { duration: 4500 },
      );
    } catch {
      this.snackBar.open('Errore durante il rimborso', undefined, { duration: 3000 });
    }
  }

  async confirmDeletePlayer(player: Player): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Elimina giocatore',
            message: `Eliminare ${player.name} dalla rosa? L'operazione è registrata nello storico.`,
            confirmLabel: 'Elimina',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confirmed || !this.selectedTeamId()) {
      return;
    }

    // Chiede se addebitare la rescissione (costo fisso di 1,50 €)
    const addebitaRescissione = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Rescissione',
            message:
              'Addebitare il costo di rescissione di 1,50 € alla voce Rescissioni?',
            confirmLabel: 'Sì, addebita',
            cancelLabel: 'No, solo elimina',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );

    try {
      // Valore rosa aggiornato (senza il giocatore ceduto)
      const nuovaRosa =
        Math.round((this.valoreRosa() - (player.valoreAttuale || 0)) * 100) / 100;

      // Eliminazione + eventuale rescissione in un unico batch atomico e annullabile
      await this.teamService.eseguiEliminazione(
        this.selectedTeamId()!,
        player.id,
        addebitaRescissione ? 1.5 : 0,
        nuovaRosa,
      );

      this.snackBar.open('Giocatore eliminato', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante l\u2019eliminazione', undefined, { duration: 3000 });
    }
  }

  // --------------------------------------------------------------- prestiti

  async openAddLoan(): Promise<void> {
    const teamNames = this.teams().map((t) => t.name);
    const result = await firstValueFrom(
      this.dialog
        .open(LoanDialog, { data: { teamNames }, width: '95vw', maxWidth: '420px' })
        .afterClosed(),
    );
    if (!result || !this.selectedTeamId()) {
      return;
    }
    try {
      await this.teamService.addLoan(this.selectedTeamId()!, result);
      this.snackBar.open('Prestito registrato', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante il salvataggio', undefined, { duration: 3000 });
    }
  }

  async confirmDeleteLoan(loan: LoanedPlayer): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Rimuovi prestito',
            message: `Rimuovere il prestito di ${loan.playerName} a ${loan.toTeam}?`,
            confirmLabel: 'Rimuovi',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confirmed || !this.selectedTeamId()) {
      return;
    }
    try {
      await this.teamService.deleteLoan(this.selectedTeamId()!, loan.id);
      this.snackBar.open('Prestito rimosso', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante la rimozione', undefined, { duration: 3000 });
    }
  }

  /** Ruoli singoli di un giocatore, per i chip */
  rolesOf(player: Player): string[] {
    return splitRoles(player.ruolo);
  }

  /** Colore associato al gruppo di ruolo */
  colorFor(role: string): string {
    return roleColor(role);
  }

  /** 1.45 → "145%" */
  perc(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }
}