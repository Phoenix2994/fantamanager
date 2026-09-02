import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { switchMap, of, take } from 'rxjs';
import { environment } from '../../../environments/environment';
import { round2 } from '../../core/finance-calculator';
import { AuthService } from '../../core/services/auth.service';
import { ScambiService } from '../../core/services/scambi.service';
import { TeamService } from '../../core/services/team.service';
import {
  BonusScambio,
  BonusScambioEventi,
  BonusScambioSoglia,
  DURATE_PRESTITO_SCAMBIO,
  DurataPrestitoScambio,
  Player,
  Scambio,
  ScambioAvanzatoDati,
  Team,
  TerminiGiocatoreAvanzato,
  TIPI_BONUS_EVENTI_SCAMBIO,
  TIPI_BONUS_SOGLIA_SCAMBIO,
  TipoBonusEventiScambio,
  TipoBonusSogliaScambio,
  TipoContrattoScambio,
} from '../../core/models';
import {
  GiocatoreAvanzato,
  calcolaScambioAvanzatoConTetto,
  etichettaContratto,
} from '../../core/scambi-avanzati-calculator';
import { giocatoriConBonusAttivo, possedutoATitoloDefinitivo } from '../../core/scambi-calculator';
import { roleColor, splitRoles } from '../../core/roles';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { DettagliContrattoSheet } from './dettagli-contratto-sheet';

/** Lato del form: A o B */
type Lato = 'A' | 'B';

let contatoreBonusId = 0;

/**
 * Trattativa AVANZATA (prestiti + bonus): schermata raggiungibile dalla
 * pagina Scambi. Stessa impalcatura del form semplice (due squadre, due
 * rose, selezione giocatori), ma per ogni giocatore selezionato si aprono
 * i termini del contratto (definitivo / prestito / diritto / obbligo,
 * durata, riscatto) e fino a N bonus attesi.
 *
 * Il calcolo live usa scambi-avanzati-calculator.ts — stesso modulo, stessi
 * numeri, usato anche al momento della conferma admin e di ogni ricalcolo
 * successivo (quando un evento bonus viene confermato).
 */
@Component({
  selector: 'app-scambi-avanzato-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    NavMenu,
    HeaderAuthStatus,
  ],
  templateUrl: './scambi-avanzato-page.html',
  styleUrls: ['../../core/nav/page-shell.scss', './scambi-page.scss', './scambi-avanzato-page.scss'],
})
export class ScambiAvanzatoPage {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly scambiService = inject(ScambiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly bottomSheet = inject(MatBottomSheet);

  readonly leagueName = environment.leagueName;
  readonly LATI: readonly Lato[] = ['A', 'B'];
  readonly TIPI_CONTRATTO: readonly TipoContrattoScambio[] = [
    'definitivo',
    'prestito',
    'prestitoDiritto',
    'prestitoObbligo',
  ];
  readonly DURATE = DURATE_PRESTITO_SCAMBIO;
  readonly TIPI_BONUS_EVENTI = TIPI_BONUS_EVENTI_SCAMBIO;
  readonly TIPI_BONUS_SOGLIA = TIPI_BONUS_SOGLIA_SCAMBIO;

  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });
  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  readonly squadraAId = signal<string | null>(null);
  readonly squadraBId = signal<string | null>(null);
  readonly selezioneA = signal<string[]>([]);
  readonly selezioneB = signal<string[]>([]);
  /** Termini per ciascun giocatore selezionato, chiave = playerId (unico tra le due squadre in una trattativa) */
  readonly termini = signal<Record<string, TerminiGiocatoreAvanzato>>({});
  readonly conguaglioA = signal(0);
  readonly conguaglioB = signal(0);
  /** Rosa espansa/richiusa (per liberare spazio dopo aver scelto i giocatori) — aperta di default */
  readonly rosaEspansaA = signal(true);
  readonly rosaEspansaB = signal(true);
  /** id della bozza in correzione (via ?edit=), null per una trattativa nuova */
  readonly editingId = signal<string | null>(null);

  constructor() {
    // Preseleziona (non blocca) la propria squadra su A — stesso pattern dello scambio semplice
    effect(() => {
      const mia = this.myTeam();
      if (mia && !this.squadraAId()) {
        this.squadraAId.set(mia.id);
      }
    });

    // Se si arriva da "Modifica" su una bozza avanzata esistente (/scambi/avanzato?edit=ID),
    // la ricarica nel form invece di partire da una trattativa vuota.
    const editId = this.route.snapshot.queryParamMap.get('edit');
    if (editId) {
      this.scambiService.scambi$.pipe(take(1)).subscribe((lista) => {
        const scambio = lista.find((s) => s.id === editId);
        if (!scambio || !scambio.avanzato) {
          this.snackBar.open('Bozza non trovata o non più modificabile.', 'Chiudi', { duration: 4000 });
          return;
        }
        this.caricaPerModifica(scambio);
      });
    }
  }

  private caricaPerModifica(scambio: Scambio): void {
    const av = scambio.avanzato!;
    this.editingId.set(scambio.id);
    this.squadraAId.set(scambio.squadraA.teamId);
    this.squadraBId.set(scambio.squadraB.teamId);
    this.selezioneA.set([...scambio.squadraA.playerIds]);
    this.selezioneB.set([...scambio.squadraB.playerIds]);
    this.conguaglioA.set(av.conguaglioA || 0);
    this.conguaglioB.set(av.conguaglioB || 0);
    const mappaTermini: Record<string, TerminiGiocatoreAvanzato> = {};
    for (const t of [...av.terminiA, ...av.terminiB]) {
      mappaTermini[t.playerId] = t;
    }
    this.termini.set(mappaTermini);
  }

  /** Esce dalla modalità modifica senza salvare, tornando a una trattativa nuova vuota */
  annullaModifica(): void {
    this.resetForm();
  }

  readonly rosterA = toSignal(
    toObservable(this.squadraAId).pipe(
      switchMap((id) => (id ? this.teamService.players$(id) : of([] as Player[]))),
    ),
    { initialValue: [] as Player[] },
  );
  readonly rosterB = toSignal(
    toObservable(this.squadraBId).pipe(
      switchMap((id) => (id ? this.teamService.players$(id) : of([] as Player[]))),
    ),
    { initialValue: [] as Player[] },
  );

  readonly opzioniA = computed(() => this.toOptions(this.rosterA()));
  readonly opzioniB = computed(() => this.toOptions(this.rosterB()));

  readonly nomeSquadraA = computed(() => this.teams().find((t) => t.id === this.squadraAId())?.name ?? '');
  readonly nomeSquadraB = computed(() => this.teams().find((t) => t.id === this.squadraBId())?.name ?? '');

  /** Trattative note (realtime), per escludere dalla selezione i giocatori con un bonus attivo — vedi toOptions */
  readonly trattative = toSignal(this.scambiService.scambi$, { initialValue: [] as Scambio[] });
  readonly bonusAttivoIds = computed(() => giocatoriConBonusAttivo(this.trattative(), environment.season));

  private toOptions(roster: Player[]): Player[] {
    const bonusAttivo = this.bonusAttivoIds();
    return roster
      .filter((p) => !p.fuoriSerieA && possedutoATitoloDefinitivo(p) && !bonusAttivo.has(p.id))
      .slice()
      .sort((a, b) => b.valoreAttuale - a.valoreAttuale);
  }

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }
  colorFor(role: string): string {
    return roleColor(role);
  }
  etichettaContratto(tipo: TipoContrattoScambio): string {
    return etichettaContratto(tipo);
  }

  giocatoreSelezionato(lato: Lato, playerId: string): boolean {
    return (lato === 'A' ? this.selezioneA() : this.selezioneB()).includes(playerId);
  }

  /**
   * Rosa da elencare nel picker: durante la simulazione mostra solo chi è
   * già coinvolto nella trattativa (più veloce ritrovarli per il tasto
   * "tune"), altrimenti l'intera rosa per poterne scegliere di nuovi.
   */
  rosaMostrata(lato: Lato): Player[] {
    const tutti = lato === 'A' ? this.opzioniA() : this.opzioniB();
    if (!this.simulazioneAttiva()) {
      return tutti;
    }
    return tutti.filter((p) => this.giocatoreSelezionato(lato, p.id));
  }

  rosaEspansa(lato: Lato): boolean {
    return (lato === 'A' ? this.rosaEspansaA : this.rosaEspansaB)();
  }
  setRosaEspansa(lato: Lato, espansa: boolean): void {
    (lato === 'A' ? this.rosaEspansaA : this.rosaEspansaB).set(espansa);
  }

  toggleGiocatore(lato: Lato, player: Player): void {
    const sel = lato === 'A' ? this.selezioneA : this.selezioneB;
    const attuale = sel();
    if (attuale.includes(player.id)) {
      sel.set(attuale.filter((id) => id !== player.id));
      const nuovi = { ...this.termini() };
      delete nuovi[player.id];
      this.termini.set(nuovi);
    } else {
      sel.set([...attuale, player.id]);
      this.termini.set({
        ...this.termini(),
        [player.id]: {
          playerId: player.id,
          tipoContratto: 'definitivo',
          quotazioneFinale: player.quotazioneAttuale,
        },
      });
      this.apriDettagliSheet(player);
    }
  }

  /** Apre il drawer con contratto, riscatto e bonus di un giocatore già selezionato */
  apriDettagliSheet(player: Player): void {
    this.bottomSheet.open(DettagliContrattoSheet, {
      data: { player, page: this },
      panelClass: 'dettagli-contratto-sheet-panel',
    });
  }

  squadraChange(lato: Lato, teamId: string): void {
    const idOrNull = teamId || null;
    const sig = lato === 'A' ? this.squadraAId : this.squadraBId;
    const selSig = lato === 'A' ? this.selezioneA : this.selezioneB;
    sig.set(idOrNull);
    for (const id of selSig()) {
      const nuovi = { ...this.termini() };
      delete nuovi[id];
      this.termini.set(nuovi);
    }
    selSig.set([]);
    const altroSig = lato === 'A' ? this.squadraBId : this.squadraAId;
    if (idOrNull && altroSig() === idOrNull) {
      altroSig.set(null);
      (lato === 'A' ? this.selezioneB : this.selezioneA).set([]);
    }
  }

  terminiDi(playerId: string): TerminiGiocatoreAvanzato {
    return (
      this.termini()[playerId] ?? {
        playerId,
        tipoContratto: 'definitivo',
        quotazioneFinale: 0,
      }
    );
  }

  private aggiornaTermini(playerId: string, patch: Partial<TerminiGiocatoreAvanzato>): void {
    const attuali = this.terminiDi(playerId);
    this.termini.set({ ...this.termini(), [playerId]: { ...attuali, ...patch } });
  }

  setTipoContratto(playerId: string, tipo: TipoContrattoScambio): void {
    this.aggiornaTermini(playerId, {
      tipoContratto: tipo,
      durataPrestito: tipo === 'definitivo' ? undefined : this.terminiDi(playerId).durataPrestito ?? 12,
      riscattato: tipo === 'prestitoDiritto' ? false : undefined,
      cifraRiscatto: tipo === 'definitivo' ? undefined : this.terminiDi(playerId).cifraRiscatto,
    });
  }
  setDurata(playerId: string, durata: DurataPrestitoScambio): void {
    this.aggiornaTermini(playerId, { durataPrestito: durata });
  }
  setRiscattato(playerId: string, riscattato: boolean): void {
    this.aggiornaTermini(playerId, { riscattato });
  }
  setCifraRiscatto(playerId: string, valore: number): void {
    this.aggiornaTermini(playerId, { cifraRiscatto: valore || 0 });
  }
  setQuotazioneFinale(playerId: string, valore: number): void {
    this.aggiornaTermini(playerId, { quotazioneFinale: valore || 0 });
  }

  aggiungiBonusEventi(playerId: string, tipo: TipoBonusEventiScambio): void {
    // eventiAttesi resta a 0: alla creazione non si specula su quanti eventi
    // ci saranno, si segnano solo quando accadono davvero (post-conferma).
    const nuovo: BonusScambioEventi = {
      id: `b${++contatoreBonusId}`,
      tipo,
      eventiAttesi: 0,
      eventiVerificati: 0,
      rewardPerEvento: 1,
    };
    const attuali = this.terminiDi(playerId);
    this.aggiornaTermini(playerId, { bonus: [...(attuali.bonus ?? []), nuovo] });
  }
  aggiungiBonusSoglia(playerId: string, tipo: TipoBonusSogliaScambio): void {
    const nuovo: BonusScambioSoglia = {
      id: `b${++contatoreBonusId}`,
      tipo,
      soglia: tipo === 'presenze' ? 15 : 6,
      verificato: false,
      rewardUnaTantum: 1,
    };
    const attuali = this.terminiDi(playerId);
    this.aggiornaTermini(playerId, { bonus: [...(attuali.bonus ?? []), nuovo] });
  }
  rimuoviBonus(playerId: string, bonusId: string): void {
    const attuali = this.terminiDi(playerId);
    this.aggiornaTermini(playerId, { bonus: (attuali.bonus ?? []).filter((b) => b.id !== bonusId) });
  }
  aggiornaBonus(playerId: string, bonusId: string, patch: Partial<BonusScambio>): void {
    const attuali = this.terminiDi(playerId);
    const bonusList = (attuali.bonus ?? []).map((b) => (b.id === bonusId ? ({ ...b, ...patch } as BonusScambio) : b));
    this.aggiornaTermini(playerId, { bonus: bonusList });
  }
  isBonusEventi(b: BonusScambio): b is BonusScambioEventi {
    return (TIPI_BONUS_EVENTI_SCAMBIO as readonly string[]).includes(b.tipo);
  }

  /** Etichetta sintetica di un bonus pattuito, per il riepilogo dell'anteprima */
  etichettaBonusRiga(b: BonusScambio): string {
    if (this.isBonusEventi(b)) {
      return `${b.tipo} ${b.rewardPerEvento}€/evento`;
    }
    return `${b.tipo} ≥${b.soglia} → ${b.rewardUnaTantum}€`;
  }

  /**
   * Converte i giocatori selezionati + i loro termini nel formato richiesto
   * dal calcolatore. Se `overrides` è passato (modalità simulazione), i
   * suoi valori si sovrappongono ai termini reali SOLO per questo calcolo —
   * non toccano mai la bozza vera (vedi `termini`).
   */
  private aGiocatoriAvanzati(
    roster: Player[],
    selezione: string[],
    overrides?: Record<string, Partial<TerminiGiocatoreAvanzato>>,
  ): GiocatoreAvanzato[] {
    const byId = new Map(roster.map((p) => [p.id, p] as const));
    return selezione.flatMap((id) => {
      const p = byId.get(id);
      const reali = this.termini()[id];
      if (!p || !reali) {
        return [];
      }
      const t = overrides?.[id] ? { ...reali, ...overrides[id] } : reali;
      return [
        {
          id: p.id,
          name: p.name,
          ruolo: p.ruolo,
          valoreAttuale: p.valoreAttuale,
          quotazioneAttuale: p.quotazioneAttuale,
          quotazioneFinale: t.quotazioneFinale || p.quotazioneAttuale,
          tipoContratto: t.tipoContratto,
          durataPrestito: t.durataPrestito,
          riscattato: t.riscattato,
          cifraRiscatto: t.cifraRiscatto,
          bonus: t.bonus,
        } satisfies GiocatoreAvanzato,
      ];
    });
  }

  readonly giocatoriA = computed(() => this.aGiocatoriAvanzati(this.rosterA(), this.selezioneA()));
  readonly giocatoriB = computed(() => this.aGiocatoriAvanzati(this.rosterB(), this.selezioneB()));

  /** Anteprima live: sempre in "fase iniziale" (bonus attesi, non ancora realizzati) */
  readonly anteprima = computed(() =>
    calcolaScambioAvanzatoConTetto(this.giocatoriA(), this.giocatoriB(), this.conguaglioA() || 0, this.conguaglioB() || 0, true),
  );

  valoreDopoDi(playerId: string): number | null {
    return this.risultatiMostrati().risultati.find((r) => r.giocatore.id === playerId)?.valoreDopo ?? null;
  }

  /** Riepilogo di TUTTI i giocatori coinvolti (entrambe le squadre), per il pannello "Anteprima dello scambio" */
  readonly riepilogoGiocatori = computed(() => {
    const risultati = this.risultatiMostrati().risultati;
    const trova = (id: string) => risultati.find((r) => r.giocatore.id === id);
    const riga = (g: GiocatoreAvanzato, squadra: string) => {
      const r = trova(g.id);
      return {
        id: g.id,
        name: g.name,
        ruolo: g.ruolo,
        squadra,
        contrattoLabel:
          etichettaContratto(g.tipoContratto) +
          (g.durataPrestito ? ` (${g.durataPrestito} mesi)` : '') +
          ((g.tipoContratto === 'prestitoDiritto' || g.tipoContratto === 'prestitoObbligo') && g.cifraRiscatto
            ? `, riscatto a ${g.cifraRiscatto}€`
            : ''),
        bonus: g.bonus ?? [],
        valorePrima: r?.valorePrima ?? g.valoreAttuale,
        valoreDopo: r?.valoreDopo ?? g.valoreAttuale,
        rivalutato: !!r && round2(r.valoreDopo) !== round2(r.valorePrima),
      };
    };
    return [
      ...this.giocatoriMostratiA().map((g) => riga(g, this.nomeSquadraA())),
      ...this.giocatoriMostratiB().map((g) => riga(g, this.nomeSquadraB())),
    ];
  });

  // ---------- Simulazione (facoltativa, non tocca mai la bozza vera) ----------
  // Prima di confermare non si sa ancora quanti eventi accadranno o se un
  // prestito verrà riscattato: questa modalità permette di provare delle
  // ipotesi e vedere i valori finali risultanti, senza salvarle nei termini
  // pattuiti (che restano quelli reali, vedi `termini`).
  readonly simulazioneAttiva = signal(false);
  readonly simOverrides = signal<Record<string, Partial<TerminiGiocatoreAvanzato>>>({});

  toggleSimulazione(): void {
    this.simulazioneAttiva.update((v) => !v);
  }

  /** Termini "effettivi" da mostrare nei campi di simulazione: reali + eventuale ipotesi sopra */
  terminiSimulati(playerId: string): TerminiGiocatoreAvanzato {
    const reali = this.terminiDi(playerId);
    return { ...reali, ...(this.simOverrides()[playerId] ?? {}) };
  }

  /** Bonus con l'eventuale ipotesi di simulazione applicata, per un dato id */
  bonusSimulato(playerId: string, bonusId: string): BonusScambio | undefined {
    return this.terminiSimulati(playerId).bonus?.find((b) => b.id === bonusId);
  }

  impostaSimRiscattato(playerId: string, riscattato: boolean): void {
    this.simOverrides.set({ ...this.simOverrides(), [playerId]: { ...this.simOverrides()[playerId], riscattato } });
  }

  /**
   * Quotazione finale simulata; il campo è prevalorizzato con quella reale
   * (vedi terminiSimulati). Un campo momentaneamente vuoto (mentre l'utente
   * cancella la cifra per scriverne un'altra) NON tocca la bozza: se
   * scrivessimo subito "nessuna ipotesi" qui, il valore mostrato tornerebbe
   * a quello reale a metà digitazione, impedendo di fatto la modifica.
   */
  impostaSimQuotazioneFinale(playerId: string, valore: string): void {
    if (valore === '') {
      return;
    }
    const numero = Number(valore);
    if (Number.isNaN(numero)) {
      return;
    }
    this.simOverrides.set({
      ...this.simOverrides(),
      [playerId]: { ...this.simOverrides()[playerId], quotazioneFinale: numero },
    });
  }

  /**
   * Legge la stringa grezza (non valueAsNumber): un input number mobile può
   * emettere un evento con valore vuoto mentre l'utente sta ancora digitando
   * (es. in blur sul tastierino) — se coercizzato subito a 0 sovrascriverebbe
   * silenziosamente il valore appena inserito, vedi impostaSimQuotazioneFinale.
   */
  impostaSimEventiVerificati(playerId: string, bonusId: string, valore: string): void {
    if (valore === '') {
      return;
    }
    const eventiVerificati = Math.max(0, Math.round(Number(valore) || 0));
    const bonusBase = this.terminiSimulati(playerId).bonus ?? [];
    const bonusAggiornato = bonusBase.map((b) => (b.id === bonusId ? { ...b, eventiVerificati } : b));
    this.simOverrides.set({
      ...this.simOverrides(),
      [playerId]: { ...this.simOverrides()[playerId], bonus: bonusAggiornato },
    });
  }

  impostaSimSogliaSuperata(playerId: string, bonusId: string, verificato: boolean): void {
    const bonusBase = this.terminiSimulati(playerId).bonus ?? [];
    const bonusAggiornato = bonusBase.map((b) => (b.id === bonusId ? { ...b, verificato } : b));
    this.simOverrides.set({
      ...this.simOverrides(),
      [playerId]: { ...this.simOverrides()[playerId], bonus: bonusAggiornato },
    });
  }

  annullaSimulazione(): void {
    this.simOverrides.set({});
  }

  private readonly giocatoriASimulati = computed(() =>
    this.aGiocatoriAvanzati(this.rosterA(), this.selezioneA(), this.simOverrides()),
  );
  private readonly giocatoriBSimulati = computed(() =>
    this.aGiocatoriAvanzati(this.rosterB(), this.selezioneB(), this.simOverrides()),
  );

  /** Anteprima simulata: usa i valori REALIZZATI (come farebbe un ricalcolo post-conferma) sulle ipotesi inserite */
  readonly anteprimaSimulata = computed(() =>
    calcolaScambioAvanzatoConTetto(
      this.giocatoriASimulati(),
      this.giocatoriBSimulati(),
      this.conguaglioA() || 0,
      this.conguaglioB() || 0,
      false,
    ),
  );

  /** Cosa mostra il pannello di anteprima: la simulazione se attiva, altrimenti l'anteprima reale */
  readonly risultatiMostrati = computed(() => (this.simulazioneAttiva() ? this.anteprimaSimulata() : this.anteprima()));
  private readonly giocatoriMostratiA = computed(() => (this.simulazioneAttiva() ? this.giocatoriASimulati() : this.giocatoriA()));
  private readonly giocatoriMostratiB = computed(() => (this.simulazioneAttiva() ? this.giocatoriBSimulati() : this.giocatoriB()));

  readonly erroreSquadre = computed(() => {
    if (!this.squadraAId() || !this.squadraBId()) {
      return null;
    }
    if (this.squadraAId() === this.squadraBId()) {
      return 'Le due squadre devono essere diverse.';
    }
    const mia = this.myTeam();
    if (mia && this.squadraAId() !== mia.id && this.squadraBId() !== mia.id) {
      return 'Una delle due squadre deve essere la tua.';
    }
    return null;
  });

  readonly puoiSalvare = computed(
    () =>
      !this.erroreSquadre() &&
      !this.anteprima().errore &&
      (this.selezioneA().length > 0 || this.selezioneB().length > 0) &&
      !!this.myTeam(),
  );

  async salvaBozza(): Promise<void> {
    if (!this.puoiSalvare() || !this.squadraAId() || !this.squadraBId()) {
      return;
    }
    const mia = this.myTeam();
    if (!mia) {
      this.snackBar.open('Accedi come la tua squadra per proporre uno scambio.', 'Chiudi', { duration: 4000 });
      return;
    }
    const risultati = this.anteprima().risultati;

    const avanzato: ScambioAvanzatoDati = {
      terminiA: this.selezioneA().map((id) => this.termini()[id]),
      terminiB: this.selezioneB().map((id) => this.termini()[id]),
      conguaglioA: this.conguaglioA() || 0,
      conguaglioB: this.conguaglioB() || 0,
    };

    const input = {
      squadraA: {
        teamId: this.squadraAId()!,
        playerIds: [...this.selezioneA()],
        ownerUid: this.ownerUidOf(this.squadraAId()!),
      },
      squadraB: {
        teamId: this.squadraBId()!,
        playerIds: [...this.selezioneB()],
        ownerUid: this.ownerUidOf(this.squadraBId()!),
      },
      conguaglio: (this.conguaglioA() || 0) + (this.conguaglioB() || 0),
      conguaglioPagante: (this.conguaglioA() || 0) > 0 ? ('A' as const) : (this.conguaglioB() || 0) > 0 ? ('B' as const) : null,
      snapshot: {
        nomeSquadraA: this.nomeSquadraA(),
        nomeSquadraB: this.nomeSquadraB(),
        giocatoriA: this.giocatoriA().map((g) => ({
          playerId: g.id,
          name: g.name,
          ruolo: g.ruolo,
          valoreAttuale: g.valoreAttuale,
          contrattoLabel: this.etichettaBreve(g.id),
        })),
        giocatoriB: this.giocatoriB().map((g) => ({
          playerId: g.id,
          name: g.name,
          ruolo: g.ruolo,
          valoreAttuale: g.valoreAttuale,
          contrattoLabel: this.etichettaBreve(g.id),
        })),
        valoreTotaleA: round2(this.giocatoriA().reduce((s, g) => s + g.valoreAttuale, 0)),
        valoreTotaleB: round2(this.giocatoriB().reduce((s, g) => s + g.valoreAttuale, 0)),
        rivalutazioni: risultati
          .filter((r) => round2(r.valoreDopo) !== round2(r.valorePrima))
          .map((r) => ({
            playerId: r.giocatore.id,
            playerName: r.giocatore.name,
            valorePrima: r.valorePrima,
            valoreDopo: r.valoreDopo,
          })),
      },
      avanzato,
    };

    try {
      const editId = this.editingId();
      if (editId) {
        await this.scambiService.aggiornaBozza(editId, input);
        this.snackBar.open('Bozza avanzata aggiornata.', 'OK', { duration: 3500 });
      } else {
        await this.scambiService.saveBozza(input);
        this.snackBar.open('Bozza avanzata salvata — visibile solo a te e alla controparte.', 'OK', { duration: 3500 });
      }
      this.resetForm();
    } catch (err) {
      console.error(err);
      this.snackBar.open(err instanceof Error ? err.message : 'Errore salvando la trattativa.', 'Chiudi', {
        duration: 4000,
      });
    }
  }

  /** Etichetta sintetica del contratto pattuito, per il riepilogo compatto nella riga giocatore */
  etichettaBreve(playerId: string): string {
    const t = this.termini()[playerId];
    if (!t || t.tipoContratto === 'definitivo') {
      return 'Definitivo';
    }
    const base = etichettaContratto(t.tipoContratto);
    const durata = t.durataPrestito ? ` (${t.durataPrestito} mesi)` : '';
    const cifra =
      (t.tipoContratto === 'prestitoDiritto' || t.tipoContratto === 'prestitoObbligo') && t.cifraRiscatto
        ? `, riscatto a ${t.cifraRiscatto}€`
        : '';
    return `${base}${durata}${cifra}`;
  }

  private ownerUidOf(teamId: string): string | null {
    return this.teams().find((t) => t.id === teamId)?.ownerUid ?? null;
  }

  private resetForm(): void {
    this.editingId.set(null);
    this.squadraAId.set(this.myTeam()?.id ?? null);
    this.squadraBId.set(null);
    this.selezioneA.set([]);
    this.selezioneB.set([]);
    this.termini.set({});
    this.conguaglioA.set(0);
    this.conguaglioB.set(0);
  }
}
