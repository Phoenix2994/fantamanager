import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { switchMap, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { ScambiService } from '../../core/services/scambi.service';
import { TeamService } from '../../core/services/team.service';
import { BonusScambio, Player, Scambio, Team, TerminiGiocatoreAvanzato } from '../../core/models';
import { RivalutazioneAvanzata } from '../../core/scambi-avanzati-calculator';
import { calcolaProssimaSpesaRinnovo } from '../../core/finance-calculator';
import { roleColor, splitRoles } from '../../core/roles';
import {
  LatoScambio,
  PERC_RINNOVO_SCAMBIO,
  ScambioAnteprima,
  calcolaAnteprima,
} from '../../core/scambi-calculator';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { TeamLogo } from '../../shared/team-logo';
import { ConfirmDialog } from '../dashboard/dialogs/confirm-dialog';

/** Giocatore mostrato nel selettore di una trattativa */
interface PlayerOption {
  id: string;
  name: string;
  ruolo: string;
  valoreAttuale: number;
}

/** Riga del riepilogo giocatori coinvolti, mostrata già nell'anteprima */
interface RiepilogoGiocatore {
  id: string;
  name: string;
  ruolo: string;
  squadra: string;
  valoreAttuale: number;
  valoreFinale: number;
  rivalutato: boolean;
  /** true se il giocatore ha già speso soldi quest'anno (acquisto o rinnovo) */
  giaRinnovato: boolean;
  /** Costo per rinnovarlo DOPO lo scambio, al valore finale e alla percentuale resettata (60%) */
  prossimaSpesaRinnovo: number;
}

/**
 * Pagina degli scambi (/scambi): preparazione delle trattative tra squadre.
 *
 * - L'admin seleziona le due squadre, i giocatori ceduti da ciascuna e un
 *   eventuale conguaglio; un'anteprima live mostra la rivalutazione della
 *   parte più "povera" (proporzionale alle quotazioni attuali).
 * - Le trattative sono salvate come BOZZE su Firestore (scambi/{id}) e
 *   possono essere confermate dall'admin in un secondo momento.
 * - I visitatori vedono l'elenco delle trattative in sola lettura.
 */
@Component({
  selector: 'app-scambi-page',
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    RouterLink,
    NavMenu,
    HeaderAuthStatus,
    TeamLogo,
  ],
  templateUrl: './scambi-page.html',
  styleUrls: ['../../core/nav/page-shell.scss', './scambi-page.scss'],
})
export class ScambiPage {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly scambiService = inject(ScambiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly leagueName = environment.leagueName;
  /** Percentuale di prossimo rinnovo applicata ai giocatori coinvolti */
  readonly percRinnovoScambio = PERC_RINNOVO_SCAMBIO;
  /** Lati della trattativa, per i cicli del template */
  readonly LATI: readonly LatoScambio[] = ['A', 'B'];

  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });
  /** Squadra di cui l'utente corrente è proprietario, se ha fatto login come squadra */
  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });
  /**
   * TEMPORANEO: solo permesso FRONTEND (nessuna regola Firestore toccata) per
   * far provare a Nicaragua Pacamara Gigante il pulsante "Trattativa avanzata",
   * normalmente visibile solo agli admin — vedi puoVedereAvanzato(). Da
   * togliere quando le prove sono finite (basta rimuovere questo blocco e
   * l'uso di TEAM_ID_TEST_AVANZATO in puoVedereAvanzato).
   */
  private readonly TEAM_ID_TEST_AVANZATO = 'nicaragua-pacamara-gigante';
  readonly puoVedereAvanzato = computed(
    () => this.isAdmin() || this.myTeam()?.id === this.TEAM_ID_TEST_AVANZATO,
  );
  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });
  readonly trattative = toSignal(this.scambiService.scambi$, { initialValue: [] as Scambio[] });
  /** Elenco visibile: le trattative annullate restano nello storico/undo ma non intasano questa lista */
  readonly trattativeVisibili = computed(() => this.trattative().filter((s) => s.stato !== 'annullata'));

  // ---------- Stato del form "nuova trattativa" ----------
  // Chi ha fatto login come squadra propone SEMPRE per la propria: Squadra A
  // è bloccata sulla propria squadra (vedi effect nel costruttore).
  readonly squadraAId = signal<string | null>(null);
  readonly squadraBId = signal<string | null>(null);
  readonly selezioneA = signal<string[]>([]);
  readonly selezioneB = signal<string[]>([]);
  readonly conguaglio = signal<number | null>(0);
  readonly pagatore = signal<LatoScambio | null>(null);
  /** Pannello "Dettagli rinnovo" nell'anteprima: chiuso di default, specie utile su mobile */
  readonly mostraDettagliRinnovo = signal(false);
  /** Rosa espansa/richiusa (per liberare spazio dopo aver scelto i giocatori) — aperta di default */
  readonly rosaEspansaA = signal(true);
  readonly rosaEspansaB = signal(true);

  /** Id delle trattative espanse nell'elenco: chiuse di default, mostrano solo squadre + stato */
  readonly trattativeEspanse = signal<Set<string>>(new Set());

  /** Id della bozza in modifica, se il form sta correggendo una bozza esistente invece di crearne una nuova */
  readonly editingId = signal<string | null>(null);

  constructor() {
    // Preseleziona la propria squadra su Squadra A appena si è loggati —
    // solo un punto di partenza comodo, NON un blocco: si può comunque
    // cambiarla (basta che almeno un lato resti la propria squadra al
    // salvataggio, vedi erroreSquadre()). Il guard "solo se non è ancora
    // stato scelto nulla" evita di sovrascrivere una scelta successiva
    // dell'utente ad ogni ricalcolo dell'effect.
    effect(() => {
      const mia = this.myTeam();
      if (mia && !this.squadraAId()) {
        this.squadraChange('A', mia.id);
      }
    });
  }

  /** Rose realtime delle squadre selezionate */
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

  /** Opzioni selezionabili: solo giocatori in Serie A, ordinati per V.A. */
  readonly opzioniA = computed(() => this.toOptions(this.rosterA()));
  readonly opzioniB = computed(() => this.toOptions(this.rosterB()));

  readonly nomeSquadraA = computed(
    () => this.teams().find((t) => t.id === this.squadraAId())?.name ?? '',
  );
  readonly nomeSquadraB = computed(
    () => this.teams().find((t) => t.id === this.squadraBId())?.name ?? '',
  );

  /** Errori di configurazione non coperti dall'anteprima */
  readonly erroreSquadre = computed(() => {
    if (!this.squadraAId() || !this.squadraBId()) {
      return null;
    }
    if (this.squadraAId() === this.squadraBId()) {
      return 'Le due squadre devono essere diverse.';
    }
    // Chi ha fatto login come squadra può proporre solo trattative in cui
    // almeno un lato è la propria squadra — stesso vincolo verificato dalle
    // security rules alla creazione della bozza (vedi firestore.rules).
    const mia = this.myTeam();
    if (mia && this.squadraAId() !== mia.id && this.squadraBId() !== mia.id) {
      return 'Una delle due squadre deve essere la tua.';
    }
    return null;
  });

  /** Anteprima live della trattativa corrente */
  readonly anteprima = computed<ScambioAnteprima>(() =>
    calcolaAnteprima(
      this.giocatoriSelezionati(this.rosterA(), this.selezioneA()),
      this.giocatoriSelezionati(this.rosterB(), this.selezioneB()),
      this.conguaglio() ?? 0,
      (this.conguaglio() ?? 0) > 0 ? this.pagatore() : null,
    ),
  );

  /**
   * Riepilogo di TUTTI i giocatori coinvolti (entrambe le squadre) col loro
   * valore finale — anche quelli che non cambiano valore, non solo i
   * rivalutati.
   */
  readonly riepilogoGiocatori = computed<RiepilogoGiocatore[]>(() => {
    const a = this.anteprima();
    const valoreFinalePerId = new Map(a.rivalutazioni.map((r) => [r.player.id, r.valoreDopo]));
    const riga = (p: Player, squadra: string): RiepilogoGiocatore => {
      const valoreFinale = valoreFinalePerId.get(p.id) ?? p.valoreAttuale;
      return {
        id: p.id,
        name: p.name,
        ruolo: p.ruolo,
        squadra,
        valoreAttuale: p.valoreAttuale,
        valoreFinale,
        rivalutato: valoreFinalePerId.has(p.id),
        giaRinnovato: p.acquistoRinnovoSpesa > 0,
        prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(valoreFinale, this.percRinnovoScambio),
      };
    };
    return [
      ...this.giocatoriSelezionati(this.rosterA(), this.selezioneA()).map((p) =>
        riga(p, this.nomeSquadraA()),
      ),
      ...this.giocatoriSelezionati(this.rosterB(), this.selezioneB()).map((p) =>
        riga(p, this.nomeSquadraB()),
      ),
    ];
  });


  /** Lato opposto a quello passato */
  altroLato(lato: LatoScambio): LatoScambio {
    return lato === 'A' ? 'B' : 'A';
  }

  /** Cambio squadra di un lato: resetta la selezione giocatori di quel lato */
  squadraChange(lato: LatoScambio, teamId: string): void {
    const idOrNull = teamId || null;
    if (lato === 'A') {
      this.squadraAId.set(idOrNull);
      this.selezioneA.set([]);
    } else {
      this.squadraBId.set(idOrNull);
      this.selezioneB.set([]);
    }
    // Se l'altro lato era la stessa squadra, va svuotato
    const altroId = lato === 'A' ? this.squadraBId() : this.squadraAId();
    if (idOrNull && altroId === idOrNull) {
      if (lato === 'A') {
        this.squadraBId.set(null);
        this.selezioneB.set([]);
      } else {
        this.squadraAId.set(null);
        this.selezioneA.set([]);
      }
    }
  }

  toggleGiocatore(lato: LatoScambio, playerId: string): void {
    const sig = lato === 'A' ? this.selezioneA : this.selezioneB;
    const current = sig();
    sig.set(
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId],
    );
  }

  rosaEspansa(lato: LatoScambio): boolean {
    return (lato === 'A' ? this.rosaEspansaA : this.rosaEspansaB)();
  }
  setRosaEspansa(lato: LatoScambio, espansa: boolean): void {
    (lato === 'A' ? this.rosaEspansaA : this.rosaEspansaB).set(espansa);
  }

  conguaglioChange(value: number | null): void {
    const safe = value && value > 0 ? value : 0;
    this.conguaglio.set(safe);
    if (!safe) {
      this.pagatore.set(null);
      return;
    }
    if (!this.pagatore()) {
      // Default: paga la parte di minor valore
      this.pagatore.set(
        this.anteprima().valoreTotaleA <= this.anteprima().valoreTotaleB ? 'A' : 'B',
      );
    }
  }

  /** Salva la bozza (nuova, oppure aggiorna quella in modifica — vedi editingId) */
  async salvaBozza(): Promise<void> {
    if (!this.squadraAId() || !this.squadraBId() || this.anteprima().errore) {
      return;
    }
    if (!this.myTeam()) {
      this.snackBar.open('Accedi come la tua squadra per proporre uno scambio.', 'Chiudi', {
        duration: 4000,
      });
      return;
    }
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
      conguaglio: this.conguaglio() ?? 0,
      conguaglioPagante: (this.conguaglio() ?? 0) > 0 ? this.pagatore() : null,
      snapshot: this.costruisciSnapshot(),
    };
    try {
      const editId = this.editingId();
      if (editId) {
        await this.scambiService.aggiornaBozza(editId, input);
        this.snackBar.open('Bozza aggiornata.', 'OK', { duration: 3500 });
      } else {
        await this.scambiService.saveBozza(input);
        this.snackBar.open('Bozza salvata — visibile solo a te e alla controparte.', 'OK', {
          duration: 3500,
        });
      }
      this.resetForm();
    } catch (err) {
      console.error(err);
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore salvando la trattativa.',
        'Chiudi',
        { duration: 4000 },
      );
    }
  }

  /** Ricarica una bozza propria nel form per correggerla, senza doverla rifare da zero */
  modifica(scambio: Scambio): void {
    this.editingId.set(scambio.id);
    this.squadraAId.set(scambio.squadraA.teamId);
    this.squadraBId.set(scambio.squadraB.teamId);
    this.selezioneA.set([...scambio.squadraA.playerIds]);
    this.selezioneB.set([...scambio.squadraB.playerIds]);
    this.conguaglio.set(scambio.conguaglio || 0);
    this.pagatore.set(scambio.conguaglio > 0 ? scambio.conguaglioPagante : null);
    // La lista trattative è sotto il form: senza scroll l'utente non
    // vedrebbe che la modifica è stata caricata
    document.querySelector('.nuova-trattativa')?.scrollIntoView({ behavior: 'smooth' });
  }

  /** Esce dalla modalità modifica senza salvare, tornando a una bozza nuova vuota */
  annullaModifica(): void {
    this.resetForm();
  }

  private ownerUidOf(teamId: string): string | null {
    return this.teams().find((t) => t.id === teamId)?.ownerUid ?? null;
  }

  private resetForm(): void {
    this.editingId.set(null);
    // Squadra A resta sulla propria squadra se si è loggati (l'effect nel
    // costruttore la rimetterebbe comunque, ma evita un flash a null).
    this.squadraAId.set(this.myTeam()?.id ?? null);
    this.squadraBId.set(null);
    this.selezioneA.set([]);
    this.selezioneB.set([]);
    this.conguaglio.set(0);
    this.pagatore.set(null);
  }

  /** Conferma definitiva della trattativa (solo admin) */
  conferma(scambio: Scambio): void {
    const riv = scambio.snapshot.rivalutazioni
      .map((r) => `${r.playerName}: ${r.valorePrima} → ${r.valoreDopo} €`)
      .join(', ');
    const message =
      `Confermare lo scambio ${scambio.snapshot.nomeSquadraA} ↔ ` +
      `${scambio.snapshot.nomeSquadraB}?` +
      `\n\nVerranno eseguiti:` +
      `\n• passaggio di ${
        scambio.snapshot.giocatoriA.length + scambio.snapshot.giocatoriB.length
      } giocatori;` +
      (riv ? `\n• rivalutazioni: ${riv};` : '') +
      `\n• prossima percentuale rinnovo al 60% per tutti i coinvolti` +
      (scambio.conguaglio > 0
        ? `;\n• conguaglio di ${scambio.conguaglio} € da ${
            scambio.conguaglioPagante === 'A'
              ? scambio.snapshot.nomeSquadraA
              : scambio.snapshot.nomeSquadraB
          }`
        : '') +
      (scambio.avanzato ? `\n• eventuali prestiti si spostano subito nella rosa di chi li riceve` : '') +
      '.';
    const ref = this.dialog.open(ConfirmDialog, {
      data: { title: 'Conferma scambio', message, confirmLabel: 'Conferma scambio' },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        if (scambio.avanzato) {
          await this.scambiService.confermaAvanzato(scambio);
        } else {
          await this.scambiService.conferma(scambio);
        }
        this.snackBar.open('Scambio confermato e registrato.', 'OK', { duration: 3500 });
      } catch (err) {
        console.error(err);
        this.snackBar.open(
          err instanceof Error ? err.message : 'Errore durante la conferma.',
          'Chiudi',
          { duration: 5000 },
        );
      }
    });
  }

  /** Ruoli singoli di una stringa ruolo composta ("M;C"), per i chip */
  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  /** Colore associato al gruppo di ruolo */
  colorFor(role: string): string {
    return roleColor(role);
  }

  /** true se la trattativa è espansa nell'elenco (mostra i dettagli sotto la riga) */
  espansaChe(id: string): boolean {
    return this.trattativeEspanse().has(id);
  }

  toggleTrattativa(id: string): void {
    const next = new Set(this.trattativeEspanse());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.trattativeEspanse.set(next);
  }

  statoLabel(stato: Scambio['stato']): string {
    switch (stato) {
      case 'bozza':
        return 'Bozza';
      case 'ufficializzata':
        return 'Ufficializzata';
      case 'confermata':
        return 'Confermata';
      case 'annullata':
        return 'Annullata';
    }
  }

  /** Rende la bozza visibile agli admin per la conferma finale (basta una delle due squadre) */
  async ufficializza(scambio: Scambio): Promise<void> {
    try {
      await this.scambiService.ufficializza(scambio);
      this.snackBar.open('Trattativa ufficializzata: ora la vedono anche gli admin.', 'OK', {
        duration: 3500,
      });
    } catch (err) {
      console.error(err);
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore ufficializzando la trattativa.',
        'Chiudi',
        { duration: 4000 },
      );
    }
  }

  elimina(scambio: Scambio): void {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Elimina trattativa',
        message: `Eliminare la bozza ${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}?`,
        confirmLabel: 'Elimina',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.elimina(scambio);
      } catch (err) {
        console.error(err);
        this.snackBar.open('Errore eliminando la trattativa.', 'Chiudi', { duration: 4000 });
      }
    });
  }

  // ---------- Trattative avanzate: prestiti + bonus ----------
  // (i metodi di sola lettura qui sotto sono visibili a chiunque veda la
  // trattativa — le due squadre coinvolte devono poter vedere subito i
  // termini pattuiti; solo le AZIONI più giù restano riservate all'admin)

  /** Tutti i giocatori coinvolti in una trattativa (entrambi i lati), per il template */
  giocatoriDellaTrattativa(scambio: Scambio) {
    return [...scambio.snapshot.giocatoriA, ...scambio.snapshot.giocatoriB];
  }

  /** Termini pattuiti di un giocatore in una trattativa avanzata, se presente */
  terminiDiGiocatore(scambio: Scambio, playerId: string): TerminiGiocatoreAvanzato | undefined {
    return (
      scambio.avanzato?.terminiA.find((t) => t.playerId === playerId) ??
      scambio.avanzato?.terminiB.find((t) => t.playerId === playerId)
    );
  }

  /** Etichetta sintetica di un bonus pattuito, per il riepilogo della trattativa (visibile a tutti) */
  etichettaBonus(b: BonusScambio): string {
    if (this.isBonusEventi(b)) {
      const be = b as BonusScambio & { rewardPerEvento: number };
      return `${b.tipo} ${be.rewardPerEvento}€/evento`;
    }
    const bs = b as BonusScambio & { soglia: number; rewardUnaTantum: number };
    return `${b.tipo} ≥${bs.soglia} → ${bs.rewardUnaTantum}€`;
  }

  /** true se il giocatore è ancora in prestito (non definitivo, non ancora rientrato) */
  puoRientrare(t: TerminiGiocatoreAvanzato): boolean {
    const eDefinitivo =
      t.tipoContratto === 'definitivo' ||
      t.tipoContratto === 'prestitoObbligo' ||
      (t.tipoContratto === 'prestitoDiritto' && t.riscattato === true);
    return !eDefinitivo && !t.prestitoConcluso;
  }

  /** Data prevista di fine prestito (confermata + durata in mesi), null se non calcolabile */
  scadenzaPrestito(scambio: Scambio, t: TerminiGiocatoreAvanzato): Date | null {
    if (!scambio.confirmedAt || !t.durataPrestito) {
      return null;
    }
    const scadenza = scambio.confirmedAt.toDate();
    scadenza.setMonth(scadenza.getMonth() + t.durataPrestito);
    return scadenza;
  }

  /** true se il prestito è ancora attivo e scade entro un mese (promemoria admin) */
  prestitoInScadenza(scambio: Scambio, t: TerminiGiocatoreAvanzato): boolean {
    if (!this.puoRientrare(t)) {
      return false;
    }
    const scadenza = this.scadenzaPrestito(scambio, t);
    if (!scadenza) {
      return false;
    }
    const unMesePrima = new Date(scadenza);
    unMesePrima.setMonth(unMesePrima.getMonth() - 1);
    return new Date() >= unMesePrima;
  }

  isBonusEventi(b: BonusScambio): boolean {
    return b.tipo === 'gol' || b.tipo === 'assist';
  }

  confermaRientro(scambio: Scambio, playerName: string, playerId: string): void {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Rientro dal prestito',
        message: `Confermare il rientro di ${playerName} alla squadra d'origine? Il giocatore si sposta subito, così com'è oggi.`,
        confirmLabel: 'Conferma rientro',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.confermaRientroPrestito(scambio, playerId);
        this.snackBar.open(`${playerName} è rientrato dal prestito.`, 'OK', { duration: 3500 });
      } catch (err) {
        console.error(err);
        this.snackBar.open(err instanceof Error ? err.message : 'Errore confermando il rientro.', 'Chiudi', {
          duration: 5000,
        });
      }
    });
  }

  aggiornaEventiBonus(scambio: Scambio, playerId: string, bonusId: string, nuoviEventi: number): void {
    const valore = Math.max(0, Math.round(nuoviEventi));
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Conferma evento bonus',
        message: `Impostare a ${valore} gli eventi confermati per questo bonus? La differenza si somma subito ai trasferimenti in finanza e i valori dei giocatori coinvolti vengono ricalcolati.`,
        confirmLabel: 'Conferma',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.confermaEventoBonus(scambio, playerId, bonusId, { eventiVerificati: valore });
        this.snackBar.open('Bonus aggiornato e valori ricalcolati.', 'OK', { duration: 3500 });
      } catch (err) {
        console.error(err);
        this.snackBar.open(err instanceof Error ? err.message : 'Errore aggiornando il bonus.', 'Chiudi', {
          duration: 5000,
        });
      }
    });
  }

  aggiornaSogliaBonus(scambio: Scambio, playerId: string, bonusId: string, verificato: boolean): void {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Conferma soglia bonus',
        message: verificato
          ? 'Confermare che la soglia è stata superata? Il bonus si somma subito ai trasferimenti in finanza e i valori dei giocatori coinvolti vengono ricalcolati.'
          : 'Annullare la conferma di questa soglia? L\'importo verrà tolto dai trasferimenti già registrati.',
        confirmLabel: 'Conferma',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.confermaEventoBonus(scambio, playerId, bonusId, { verificato });
        this.snackBar.open('Bonus aggiornato e valori ricalcolati.', 'OK', { duration: 3500 });
      } catch (err) {
        console.error(err);
        this.snackBar.open(err instanceof Error ? err.message : 'Errore aggiornando il bonus.', 'Chiudi', {
          duration: 5000,
        });
      }
    });
  }

  // ---------- Modifica termini post-conferma (riscatto, QF) + simulazione ----------

  /** Bozza locale di modifiche non ancora applicate, chiave = playerId */
  readonly draftTermini = signal<Record<string, Partial<TerminiGiocatoreAvanzato>>>({});
  /** Ultimo esito di "Simula": risultati per scambioId, non salvati */
  readonly anteprimaSimulazione = signal<Record<string, RivalutazioneAvanzata[]>>({});
  readonly simulazioneInCorso = signal<string | null>(null);

  /** Termini "effettivi" mostrati nel form: quelli reali + eventuale bozza sopra */
  terminiConDraft(scambio: Scambio, playerId: string): TerminiGiocatoreAvanzato | undefined {
    const reali = this.terminiDiGiocatore(scambio, playerId);
    if (!reali) {
      return undefined;
    }
    return { ...reali, ...(this.draftTermini()[playerId] ?? {}) };
  }

  /** Bonus con l'eventuale ipotesi "Sim:" applicata, per un dato id (solo per "Simula", non per "Applica") */
  bonusConDraft(scambio: Scambio, playerId: string, bonusId: string): BonusScambio | undefined {
    return this.terminiConDraft(scambio, playerId)?.bonus?.find((b) => b.id === bonusId);
  }

  /**
   * Legge la stringa grezza (non valueAsNumber): un input number mobile può
   * emettere un evento con valore vuoto mentre l'utente sta ancora digitando
   * — se coercizzato subito a 0 sovrascriverebbe silenziosamente il valore
   * appena inserito, vedi impostaDraftQuotazioneFinale.
   */
  impostaDraftEventiVerificati(scambio: Scambio, playerId: string, bonusId: string, valore: string): void {
    if (valore === '') {
      return;
    }
    const eventiVerificati = Math.max(0, Math.round(Number(valore) || 0));
    const bonusBase = this.terminiConDraft(scambio, playerId)?.bonus ?? [];
    const bonusAggiornato = bonusBase.map((b) => (b.id === bonusId ? { ...b, eventiVerificati } : b));
    this.draftTermini.set({
      ...this.draftTermini(),
      [playerId]: { ...this.draftTermini()[playerId], bonus: bonusAggiornato },
    });
  }

  impostaDraftSogliaSuperata(scambio: Scambio, playerId: string, bonusId: string, verificato: boolean): void {
    const bonusBase = this.terminiConDraft(scambio, playerId)?.bonus ?? [];
    const bonusAggiornato = bonusBase.map((b) => (b.id === bonusId ? { ...b, verificato } : b));
    this.draftTermini.set({
      ...this.draftTermini(),
      [playerId]: { ...this.draftTermini()[playerId], bonus: bonusAggiornato },
    });
  }

  haDraftPendente(playerId: string): boolean {
    return !!this.draftTermini()[playerId] && Object.keys(this.draftTermini()[playerId]).length > 0;
  }

  impostaDraftRiscattato(playerId: string, riscattato: boolean): void {
    this.draftTermini.set({ ...this.draftTermini(), [playerId]: { ...this.draftTermini()[playerId], riscattato } });
  }
  impostaDraftCifraRiscatto(playerId: string, cifraRiscatto: number): void {
    this.draftTermini.set({
      ...this.draftTermini(),
      [playerId]: { ...this.draftTermini()[playerId], cifraRiscatto: cifraRiscatto || 0 },
    });
  }
  /**
   * Quotazione finale simulata (solo "Simula cambio valori": nei ricalcoli
   * reali si usa sempre quella attuale, vedi ScambiService). Campo vuoto =
   * nessuna ipotesi: la simulazione userà quella attuale, come farebbe un
   * aggiornamento vero.
   */
  impostaDraftQuotazioneFinale(playerId: string, valore: string): void {
    const attuale = { ...this.draftTermini()[playerId] };
    const numero = valore === '' ? NaN : Number(valore);
    if (Number.isNaN(numero)) {
      delete attuale.quotazioneFinale;
    } else {
      attuale.quotazioneFinale = numero;
    }
    this.draftTermini.set({ ...this.draftTermini(), [playerId]: attuale });
  }

  annullaDraft(playerId: string): void {
    const nuovo = { ...this.draftTermini() };
    delete nuovo[playerId];
    this.draftTermini.set(nuovo);
    const nuovaAnteprima = { ...this.anteprimaSimulazione() };
    delete nuovaAnteprima[playerId];
    this.anteprimaSimulazione.set(nuovaAnteprima);
  }

  /** Valore simulato per un giocatore, se è stata eseguita una simulazione con la bozza corrente */
  valoreSimulato(scambio: Scambio, playerId: string): number | null {
    return this.anteprimaSimulazione()[scambio.id]?.find((r) => r.giocatore.id === playerId)?.valoreDopo ?? null;
  }

  async simulaCambioValori(scambio: Scambio): Promise<void> {
    this.simulazioneInCorso.set(scambio.id);
    try {
      const risultato = await this.scambiService.simulaRicalcoloAvanzato(scambio, this.draftTermini());
      if (risultato.errore) {
        this.snackBar.open(risultato.errore, 'Chiudi', { duration: 5000 });
        return;
      }
      this.anteprimaSimulazione.set({ ...this.anteprimaSimulazione(), [scambio.id]: risultato.risultati });
    } catch (err) {
      console.error(err);
      this.snackBar.open(err instanceof Error ? err.message : 'Errore nella simulazione.', 'Chiudi', {
        duration: 5000,
      });
    } finally {
      this.simulazioneInCorso.set(null);
    }
  }

  applicaTermini(scambio: Scambio, playerName: string, playerId: string): void {
    const draft = this.draftTermini()[playerId];
    if (!draft) {
      return;
    }
    // Solo riscatto e cifra sono termini "reali" applicabili qui: la
    // quotazione finale e i bonus drafted sopra servono solo alla
    // simulazione (vedi impostaDraftQuotazioneFinale, impostaDraftEventiVerificati,
    // impostaDraftSogliaSuperata) — per confermare davvero un bonus si usano
    // i pulsanti/il checkbox principali della riga bonus.
    const patch: { riscattato?: boolean; cifraRiscatto?: number } = {};
    if (draft.riscattato !== undefined) {
      patch.riscattato = draft.riscattato;
    }
    if (draft.cifraRiscatto !== undefined) {
      patch.cifraRiscatto = draft.cifraRiscatto;
    }
    if (Object.keys(patch).length === 0) {
      this.snackBar.open(
        'Le ipotesi "Sim:" (quotazione finale, eventi bonus) non si applicano da qui: servono solo a "Simula cambio valori". Per confermare davvero un bonus usa i pulsanti/il checkbox sulla riga del bonus; per riscatto e cifra modifica quei campi.',
        'Chiudi',
        { duration: 6000 },
      );
      return;
    }
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Applica modifica ai termini',
        message: `Aggiornare davvero i termini di ${playerName}? I valori dei giocatori coinvolti si ricalcolano e l'eventuale differenza sulla cifra di riscatto si sposta subito nei trasferimenti in finanza.`,
        confirmLabel: 'Applica',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.aggiornaTerminiAvanzati(scambio, playerId, patch);
        this.snackBar.open('Termini aggiornati e valori ricalcolati.', 'OK', { duration: 3500 });
        this.annullaDraft(playerId);
      } catch (err) {
        console.error(err);
        this.snackBar.open(err instanceof Error ? err.message : 'Errore aggiornando i termini.', 'Chiudi', {
          duration: 5000,
        });
      }
    });
  }

  // ---------- Helper ----------

  private toOptions(roster: Player[]): PlayerOption[] {
    return roster
      .filter((p) => !p.fuoriSerieA)
      .slice()
      .sort((a, b) => b.valoreAttuale - a.valoreAttuale)
      .map((p) => ({
        id: p.id,
        name: p.name,
        ruolo: p.ruolo,
        valoreAttuale: p.valoreAttuale,
      }));
  }

  private giocatoriSelezionati(roster: Player[], ids: string[]): Player[] {
    const byId = new Map(roster.map((p) => [p.id, p] as const));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    });
  }

  private costruisciSnapshot() {
    const a = this.anteprima();
    return {
      nomeSquadraA: this.nomeSquadraA(),
      nomeSquadraB: this.nomeSquadraB(),
      giocatoriA: this.opzioniA()
        .filter((p) => this.selezioneA().includes(p.id))
        .map((p) => ({ name: p.name, ruolo: p.ruolo, valoreAttuale: p.valoreAttuale })),
      giocatoriB: this.opzioniB()
        .filter((p) => this.selezioneB().includes(p.id))
        .map((p) => ({ name: p.name, ruolo: p.ruolo, valoreAttuale: p.valoreAttuale })),
      valoreTotaleA: a.valoreTotaleA,
      valoreTotaleB: a.valoreTotaleB,
      rivalutazioni: a.rivalutazioni.map((r) => ({
        playerId: r.player.id,
        playerName: r.player.name,
        valorePrima: r.valorePrima,
        valoreDopo: r.valoreDopo,
      })),
    };
  }
}
