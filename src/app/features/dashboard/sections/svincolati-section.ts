import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AstaStato, Player, Svincolato, Team, ValutazioneSvincolato } from '../../../core/models';
import { ROLE_ORDER, roleColor, splitRoles } from '../../../core/roles';
import { AstaService } from '../../../core/services/asta.service';
import { AuthService } from '../../../core/services/auth.service';
import { TeamNotesService } from '../../../core/services/team-notes.service';
import { TeamService } from '../../../core/services/team.service';
import { normalize } from '../../../core/text-utils';
import { ConfirmDialog } from '../dialogs/confirm-dialog';
import { ExpandablePlayerCard } from '../../../shared/expandable-player-card';
import { SerieALogo } from '../../../shared/serie-a-logo';

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
    SerieALogo,
  ],
  template: `
    <div class="section-header">
      <div class="header-actions">
        @if (isAdmin()) {
          <button
            matButton="tonal"
            (click)="apriAstaRandom()"
            [disabled]="candidatiRandom().length === 0"
            [attr.aria-label]="'Apri asta random — ' + candidatiRandom().length + ' richiamabili'"
          >
            <mat-icon>casino</mat-icon>
            Apri asta random
          </button>
          @if (chiamatiCount() > 0) {
            <button matButton (click)="resetTutteLeChiamate()">
              <mat-icon>restart_alt</mat-icon>
              Reset chiamate ({{ chiamatiCount() }})
            </button>
          }
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

      <!-- Filtro multiplo per squadra di Serie A -->
      <mat-form-field appearance="fill" subscriptSizing="dynamic">
        <mat-label>Squadre</mat-label>
        <mat-select
          [value]="filterSquadre()"
          (selectionChange)="filterSquadre.set($event.value)"
          multiple
        >
          @for (squadra of squadreDisponibili(); track squadra) {
            <mat-option [value]="squadra">
              <app-serie-a-logo [sigla]="squadra" class="option-logo" />
              {{ squadra }}
            </mat-option>
          }
        </mat-select>
      </mat-form-field>

      <!-- Filtro "solo valutati": ha senso solo per chi ha fatto login come
           squadra (le stelle sono private, vedi TeamNotesService) -->
      @if (myTeam()) {
        <button
          type="button"
          matButton="tonal"
          class="filter-toggle"
          [class.active]="soloValutati()"
          [attr.aria-pressed]="soloValutati()"
          (click)="soloValutati.set(!soloValutati())"
        >
          <mat-icon>star</mat-icon>
          Solo valutati
        </button>
      }

      <!-- Ordina per stelle: mostrato solo se ha senso (esiste almeno una
           valutazione), altrimenti non cambierebbe nulla -->
      @if (myTeam() && esisteAlmenoUnaValutazione()) {
        <button
          type="button"
          matButton="tonal"
          class="filter-toggle"
          [class.active]="ordinaPerStelle()"
          [attr.aria-pressed]="ordinaPerStelle()"
          (click)="ordinaPerStelle.set(!ordinaPerStelle())"
        >
          <mat-icon>sort</mat-icon>
          Ordina per stelle
        </button>
      }

      <!-- Nascondi i già chiamati in asta (non assegnati, restano svincolati
           ma "bruciati" per il random): mostrato solo se ce n'è almeno uno,
           altrimenti non cambierebbe nulla. I giocatori assegnati non
           passano di qui: vengono tolti dagli svincolati alla chiusura
           dell'asta, vedi il commento su Svincolato.chiamato in models.ts. -->
      @if (chiamatiCount() > 0) {
        <button
          type="button"
          matButton="tonal"
          class="filter-toggle"
          [class.active]="nascondiChiamati()"
          [attr.aria-pressed]="nascondiChiamati()"
          (click)="nascondiChiamati.set(!nascondiChiamati())"
        >
          <mat-icon>visibility_off</mat-icon>
          Nascondi già chiamati
        </button>
      }

      <!-- Reset rapido filtri: visibile solo se qualche filtro è attivo -->
      @if (filterRuoli().length > 0 || filterSquadre().length > 0 || search() || soloValutati() || nascondiChiamati()) {
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
          <li [class.is-chiamato]="p.chiamato">
            <!-- L'intera riga è cliccabile per aprire/chiudere il pannello
                 (valutazione e/o "Apri asta"), quando c'è qualcosa da
                 mostrarci dentro — per i visitatori senza login resta un
                 div non interattivo, come prima. -->
            <div
              class="row"
              [class.row-clickable]="puoiEspandere()"
              [attr.role]="puoiEspandere() ? 'button' : null"
              [attr.tabindex]="puoiEspandere() ? 0 : null"
              [attr.aria-expanded]="puoiEspandere() ? pannelloAperto(p.id) : null"
              (click)="puoiEspandere() && togglePannello(p.id)"
              (keydown.enter)="puoiEspandere() && togglePannello(p.id)"
              (keydown.space)="puoiEspandere() && togglePannello(p.id); $event.preventDefault()"
            >
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
              <!-- Riepilogo stelle SOLO in lettura: solo le stelle DATE (es.
                   2/3 → 2 stelle piene, non 2 piene + 1 vuota). La
                   valutazione vera, con tutte e 3 le stelle visibili per
                   poterle cambiare, si fa nel pannello sotto. -->
              @if (myTeam() && stelleDi(p.id) > 0) {
                <span class="stars-summary" aria-hidden="true">
                  @for (s of STELLE; track s) {
                    @if (s <= stelleDi(p.id)) {
                      <mat-icon class="star-mini">star</mat-icon>
                    }
                  }
                </span>
              }
              <app-serie-a-logo [sigla]="p.squadra" class="row-logo" />
              <span class="quota">{{ p.quotazioneAttuale | number: '1.0-0' }}</span>
              <!-- Indicatore puramente visivo: il click che apre/chiude è
                   già sull'intera riga, non serve un bottone separato -->
              @if (puoiEspandere()) {
                <mat-icon class="panel-indicator" aria-hidden="true">{{
                  notaDi(p.id) ? 'sticky_note_2' : pannelloAperto(p.id) ? 'expand_less' : 'expand_more'
                }}</mat-icon>
              }
            </div>
            @if (puoiEspandere() && pannelloAperto(p.id)) {
              <div class="valutazione-panel">
                @if (myTeam(); as squadra) {
                  <span class="stars" role="radiogroup" aria-label="Valutazione">
                    @for (s of STELLE; track s) {
                      <button
                        type="button"
                        class="star-btn"
                        [attr.aria-label]="s + ' stelle'"
                        [attr.aria-pressed]="stelleDi(p.id) >= s"
                        (click)="toggleStella(squadra.id, p.id, s)"
                      >
                        <mat-icon>{{ stelleDi(p.id) >= s ? 'star' : 'star_border' }}</mat-icon>
                      </button>
                    }
                  </span>
                  <textarea
                    class="note-input"
                    placeholder="Nota privata — solo tu la vedi"
                    rows="2"
                    [value]="notaDi(p.id)"
                    (blur)="salvaNota(squadra.id, p.id, $any($event.target).value)"
                  ></textarea>
                }
                @if (isAdmin()) {
                  <!-- In fondo e a destra, staccato dalle stelle: se ci sono
                       entrambe le sezioni erano troppo vicine ed era facile
                       toccare "Apri asta" per sbaglio mentre si valuta -->
                  <button matButton="tonal" class="auction-btn" (click)="apriAsta(p)">
                    <mat-icon>gavel</mat-icon>
                    Apri asta
                  </button>
                }
              </div>
            }
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

    .filter-toggle {
      flex-shrink: 0;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
    }

    .filter-toggle.active {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
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
      padding: 6px 0;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      font-size: 0.875rem;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Giocatore già chiamato in asta (a prescindere dall'esito): stessa
       tinta usata per i giocatori fuori Serie A nella rosa, coerenza visiva
       tra le due sezioni. La classe è sull'<li> (vedi template), non su
       .row — da qui il selettore discendente invece di un semplice
       .row.is-chiamato, che non avrebbe mai trovato le due classi sullo
       stesso elemento. */
    li.is-chiamato > .row {
      background: rgba(252, 185, 203, 0.4);
    }

    /* Riepilogo stelle nella riga compatta: sola lettura, più piccolo delle
       stelle interattive del pannello */
    .stars-summary {
      display: inline-flex;
      flex-shrink: 0;
      color: var(--mat-sys-tertiary);
    }

    .star-mini {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .panel-indicator {
      flex-shrink: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .row-clickable {
      cursor: pointer;
      border-radius: 8px;

      &:hover {
        background: var(--mat-sys-surface-container-high, #f5f5f5);
      }

      &:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
    }

    .valutazione-panel {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px 0 8px;
    }

    .stars {
      display: inline-flex;
      flex-shrink: 0;
    }

    .star-btn {
      border: none;
      background: none;
      padding: 2px;
      line-height: 0;
      cursor: pointer;
      color: var(--mat-sys-tertiary);
    }

    .star-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .note-input {
      width: 100%;
      resize: vertical;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      padding: 8px 10px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      font: inherit;
      font-size: 0.82rem;
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

    .row-logo {
      width: 18px;
      height: 18px;
    }

    .option-logo {
      width: 18px;
      height: 18px;
      margin-right: 6px;
      vertical-align: middle;
    }

    .auction-btn {
      min-height: 40px;
      flex-shrink: 0;
      align-self: flex-end;
      margin-top: 6px;
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
  private readonly teamNotesService = inject(TeamNotesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly STELLE = [1, 2, 3] as const;

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

  /** Squadra di cui l'utente corrente è proprietario, se ha fatto login come squadra */
  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });

  /** true se la riga ha qualcosa da mostrare nel pannello espanso (valutazione e/o apri asta) */
  readonly puoiEspandere = computed(() => this.isAdmin() || !!this.myTeam());

  /**
   * Valutazioni PRIVATE della propria squadra sugli svincolati (vuoto se non
   * loggati come squadra). catchError qui è FONDAMENTALE: senza, un errore
   * sulla lettura (es. permessi Firestore non ancora propagati subito dopo
   * il login) farebbe fallire il signal in stato di errore — e siccome
   * viene letto nel template per OGNI riga (stelleDi/notaDi), un solo
   * errore spaccherebbe il rendering dell'intera lista svincolati, non solo
   * il pannello valutazione.
   */
  private readonly valutazioni = toSignal(
    toObservable(this.myTeam).pipe(
      switchMap((team) =>
        team
          ? this.teamNotesService.valutazioni$(team.id).pipe(
              catchError((err) => {
                console.error('Errore leggendo le valutazioni svincolati:', err);
                return of([] as ValutazioneSvincolato[]);
              }),
            )
          : of([] as ValutazioneSvincolato[]),
      ),
    ),
    { initialValue: [] as ValutazioneSvincolato[] },
  );

  private readonly valutazioniMap = computed(
    () => new Map(this.valutazioni().map((v) => [v.id, v] as const)),
  );

  /** Id degli svincolati con il pannello valutazione aperto (stato solo UI, non persistito) */
  private readonly pannelliAperti = signal<ReadonlySet<string>>(new Set());

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
  readonly filterSquadre = signal<string[]>([]);
  readonly search = signal('');
  /** true = mostra solo gli svincolati a cui la propria squadra ha dato almeno una stella */
  readonly soloValutati = signal(false);
  /** true = ordina per stelle (poi per quotazione a parità), invece che per sola quotazione */
  readonly ordinaPerStelle = signal(false);
  /** true = nasconde gli svincolati già chiamati in asta (non assegnati) */
  readonly nascondiChiamati = signal(false);

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

  /** Squadre di Serie A distinte presenti nella lista, in ordine alfabetico */
  readonly squadreDisponibili = computed(() => {
    const set = new Set<string>();
    for (const p of this.svincolati()) {
      if (p.squadra) {
        set.add(p.squadra);
      }
    }
    return [...set].sort();
  });

  /**
   * L'ordinamento per stelle ha senso mostrarlo solo se la propria squadra
   * ha già valutato almeno un giocatore (altrimenti sarebbe un pulsante
   * senza alcun effetto visibile).
   */
  readonly esisteAlmenoUnaValutazione = computed(() => this.svincolati().some((p) => this.stelleDi(p.id) > 0));

  /**
   * Lista filtrata, ordinata per quotazione decrescente — oppure, se
   * ordinaPerStelle è attivo, prima per stelle decrescenti (chi non è stato
   * valutato ha 0 stelle e scivola in fondo da solo, senza bisogno di un
   * ramo a parte) e a parità di stelle sempre per quotazione decrescente.
   */
  readonly filtered = computed(() => {
    const ruoli = this.filterRuoli();
    const squadre = this.filterSquadre();
    const term = normalize(this.search());
    const soloValutati = this.soloValutati();
    const perStelle = this.ordinaPerStelle();
    const nascondiChiamati = this.nascondiChiamati();
    return this.svincolati()
      .filter(
        (p) =>
          // il filtro matcha se il giocatore ha ALMENO UNO dei ruoli selezionati
          (!ruoli.length || splitRoles(p.ruolo).some((r) => ruoli.includes(r))) &&
          (!squadre.length || squadre.includes(p.squadra)) &&
          (!term || normalize(p.name).includes(term)) &&
          (!soloValutati || this.stelleDi(p.id) > 0) &&
          (!nascondiChiamati || !p.chiamato),
      )
      .sort((a, b) => {
        if (perStelle) {
          const diffStelle = this.stelleDi(b.id) - this.stelleDi(a.id);
          if (diffStelle !== 0) {
            return diffStelle;
          }
        }
        return b.quotazioneAttuale - a.quotazioneAttuale;
      });
  });

  /** Sottoinsieme di `filtered` non ancora chiamato — il pool del random */
  readonly candidatiRandom = computed(() => this.filtered().filter((p) => !p.chiamato));

  /** Quanti svincolati (in TUTTA la lista, non solo filtrata) sono segnati "chiamato" */
  readonly chiamatiCount = computed(() => this.svincolati().filter((p) => p.chiamato).length);

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

  stelleDi(svincolatoId: string): number {
    return this.valutazioniMap().get(svincolatoId)?.stelle ?? 0;
  }

  notaDi(svincolatoId: string): string {
    return this.valutazioniMap().get(svincolatoId)?.note ?? '';
  }

  pannelloAperto(svincolatoId: string): boolean {
    return this.pannelliAperti().has(svincolatoId);
  }

  togglePannello(svincolatoId: string): void {
    const aperti = new Set(this.pannelliAperti());
    if (!aperti.delete(svincolatoId)) {
      aperti.add(svincolatoId);
    }
    this.pannelliAperti.set(aperti);
  }

  /** Tocca la stessa stella già assegnata per togliere la valutazione */
  async toggleStella(teamId: string, svincolatoId: string, stelle: number): Promise<void> {
    const nuove = this.stelleDi(svincolatoId) === stelle ? 0 : stelle;
    try {
      await this.teamNotesService.setStelle(teamId, svincolatoId, nuove);
    } catch {
      this.snackBar.open('Errore salvando la valutazione', undefined, { duration: 3000 });
    }
  }

  async salvaNota(teamId: string, svincolatoId: string, nota: string): Promise<void> {
    if (nota === this.notaDi(svincolatoId)) {
      return;
    }
    try {
      await this.teamNotesService.setNota(teamId, svincolatoId, nota);
    } catch {
      this.snackBar.open('Errore salvando la nota', undefined, { duration: 3000 });
    }
  }

  /** Ruoli singoli di un giocatore, per i chip */
  rolesOf(player: { ruolo: string }): string[] {
    return splitRoles(player.ruolo);
  }

  /** Azzera i filtri ruoli, ricerca, "solo valutati" e "nascondi già chiamati" */
  azzeraFiltri(): void {
    this.filterRuoli.set([]);
    this.filterSquadre.set([]);
    this.search.set('');
    this.soloValutati.set(false);
    this.nascondiChiamati.set(false);
  }

  /**
   * Pick del random SOLO tra i non ancora chiamati (tra quelli filtrati):
   * evita di ripescare sempre gli stessi nomi finch\u00e9 non \u00e8 aperta
   * un'assegnazione o non c'\u00e8 un reset esplicito.
   */
  async apriAstaRandom(): Promise<void> {
    const candidati = this.candidatiRandom();
    if (candidati.length === 0) {
      return;
    }
    const scelto = candidati[Math.floor(Math.random() * candidati.length)];
    await this.apriAsta(scelto);
  }

  /**
   * Apre l'asta live sul giocatore scelto (segna anche "chiamato"), previa
   * conferma: \u00e8 un'azione pubblica e visibile a tutti in tempo reale, va
   * evitato un click accidentale (soprattutto per il pick da random, dove
   * il nome scelto non era prevedibile in anticipo).
   */
  async apriAsta(giocatore: Svincolato): Promise<void> {
    const confermato = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Apri asta',
            message: `Aprire l'asta su ${giocatore.name}? Sar\u00e0 visibile a tutti, partenza da 0 \u20ac.`,
            confirmLabel: 'Apri asta',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confermato) {
      return;
    }
    try {
      await this.astaService.apriAsta(giocatore);
      this.snackBar.open(`Asta aperta su ${giocatore.name}`, undefined, { duration: 3000 });
    } catch {
      this.snackBar.open('Errore durante l\u2019apertura dell\u2019asta', undefined, {
        duration: 3000,
      });
    }
  }

  /** Reset in blocco di tutti i "chiamato" correnti, previa conferma (tocca pi\u00f9 giocatori insieme) */
  async resetTutteLeChiamate(): Promise<void> {
    const n = this.chiamatiCount();
    const confermato = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Reset chiamate',
            message:
              `Rendere di nuovo richiamabili dal random tutti i ${n} giocatori ` +
              'gi\u00e0 chiamati?',
            confirmLabel: 'Reset',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confermato) {
      return;
    }
    try {
      await this.astaService.resetTutteLeChiamate();
      this.snackBar.open('Tutti i giocatori sono di nuovo richiamabili dal random', undefined, {
        duration: 3000,
      });
    } catch {
      this.snackBar.open('Errore durante il reset', undefined, { duration: 3000 });
    }
  }
}