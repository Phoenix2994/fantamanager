import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { round2 } from '../finance-calculator';
import {
  AuditEntityType,
  Player,
  Scambio,
  ScambioAvanzatoDati,
  ScambioSide,
  ScambioSnapshot,
  TerminiGiocatoreAvanzato,
} from '../models';
import { AuthService } from './auth.service';
import { FinanceService } from './finance.service';
import { calcolaAnteprima, patchGiocatore } from '../scambi-calculator';
import {
  GiocatoreAvanzato,
  RivalutazioneAvanzata,
  calcolaScambioAvanzatoConTetto,
} from '../scambi-avanzati-calculator';
import { AuditService } from './audit.service';
import { UndoService } from './undo.service';

/** Input per salvare una bozza di trattativa */
export interface NuovoScambioInput {
  squadraA: ScambioSide;
  squadraB: ScambioSide;
  conguaglio: number;
  conguaglioPagante: 'A' | 'B' | null;
  snapshot: ScambioSnapshot;
  /** presente solo per le trattative avanzate (prestiti + bonus) */
  avanzato?: ScambioAvanzatoDati;
}

/** Millisecondi di un Timestamp Firestore (0 se assente/scrittura pending) */
function timestampMillis(ts: { toMillis: () => number } | null | undefined): number {
  return ts ? ts.toMillis() : 0;
}

/**
 * Rimuove ricorsivamente le chiavi con valore `undefined` da oggetti e
 * array — Firestore rifiuta `undefined` in scrittura (a differenza di
 * `null`), e i termini di una trattativa avanzata ne hanno spesso alcuni
 * (es. `riscattato`/`cifraRiscatto` non pertinenti per un prestito
 * semplice). Non tocca istanze non plain-object (es. Timestamp).
 */
function rimuoviUndefined<T>(valore: T): T {
  if (Array.isArray(valore)) {
    return valore.map((v) => rimuoviUndefined(v)) as unknown as T;
  }
  if (valore !== null && typeof valore === 'object' && valore.constructor === Object) {
    const risultato: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valore as Record<string, unknown>)) {
      if (v !== undefined) {
        risultato[k] = rimuoviUndefined(v);
      }
    }
    return risultato as T;
  }
  return valore;
}

/**
 * Gestione delle trattative di scambio (scambi/{id}):
 * - CRUD delle bozze (realtime);
 * - conferma dell'admin come operazione atomica (write batch):
 *   1. spostamento dei giocatori tra le rose della stagione corrente;
 *   2. rivalutazione dei giocatori della parte più "povera"
 *      (valoreIniziale = nuovo valore, quotazioneIniziale = quotazioneAttuale);
 *   3. prossimaPercRinnovo = 60% per TUTTI i giocatori coinvolti;
 *   4. conguaglio: trasferimentiUscita per chi paga, trasferimentiEntrata per
 *      chi incassa, con ricalcolo completo di tasse/spese/bilancio e
 *      valore rosa aggiornato post-scambio;
 *   5. voci nello storico operazioni (auditLog).
 */
@Injectable({ providedIn: 'root' })
export class ScambiService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);
  private readonly finance = inject(FinanceService);
  private readonly audit = inject(AuditService);
  private readonly undo = inject(UndoService);
  private readonly authService = inject(AuthService);

  /**
   * Tutte le trattative visibili, dalla più recente:
   * - ufficializzata/confermata/annullata: pubbliche, come prima;
   * - bozza: PRIVATA — visibile solo se si è loggati come una delle due
   *   squadre coinvolte. Per questo non è più un'unica query: le bozze
   *   private richiedono due query aggiuntive filtrate su ownerUid
   *   (le security rules non possono validare una query "list" che si
   *   appoggi a una get() indiretta, quindi ownerUid è duplicato sul
   *   documento apposta — vedi ScambioSide in models.ts).
   */
  readonly scambi$: Observable<Scambio[]> = runInInjectionContext(this.injector, () =>
    this.authService.myTeam$.pipe(
      switchMap((team) => {
        const pubbliche$ = collectionData(
          query(
            this.scambiCollection(),
            where('stato', 'in', ['ufficializzata', 'confermata', 'annullata']),
          ),
          { idField: 'id' },
        ) as Observable<Scambio[]>;

        const uid = team ? this.auth.currentUser?.uid : undefined;
        if (!uid) {
          return pubbliche$;
        }

        const mieComeA$ = collectionData(
          query(
            this.scambiCollection(),
            where('stato', '==', 'bozza'),
            where('squadraA.ownerUid', '==', uid),
          ),
          { idField: 'id' },
        ) as Observable<Scambio[]>;
        const mieComeB$ = collectionData(
          query(
            this.scambiCollection(),
            where('stato', '==', 'bozza'),
            where('squadraB.ownerUid', '==', uid),
          ),
          { idField: 'id' },
        ) as Observable<Scambio[]>;

        return combineLatest([pubbliche$, mieComeA$, mieComeB$]).pipe(
          map(([pubbliche, mieA, mieB]) => {
            const byId = new Map<string, Scambio>();
            for (const s of [...pubbliche, ...mieA, ...mieB]) {
              byId.set(s.id, s);
            }
            return [...byId.values()];
          }),
        );
      }),
      map((list) =>
        list.slice().sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)),
      ),
    ),
  );

  private scambiCollection() {
    return collection(this.firestore, 'scambi');
  }

  private scambioRef(id: string) {
    return doc(this.firestore, `scambi/${id}`);
  }

  private playerPath(teamId: string, playerId: string): string {
    return `teams/${teamId}/seasons/${environment.season}/players/${playerId}`;
  }

  private financePath(teamId: string): string {
    return `teams/${teamId}/seasonFinance/${environment.season}`;
  }

  /**
   * Salva una nuova bozza di trattativa. Richiede di essere loggati come
   * una delle due squadre coinvolte (controllo anche lato client, oltre
   * che nelle security rules: qui fallisce prima, con un messaggio chiaro).
   */
  async saveBozza(input: NuovoScambioInput): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid || (input.squadraA.ownerUid !== uid && input.squadraB.ownerUid !== uid)) {
      throw new Error('Devi accedere come una delle due squadre per proporre uno scambio.');
    }

    const ref = await addDoc(this.scambiCollection(), {
      season: environment.season,
      squadraA: input.squadraA,
      squadraB: input.squadraB,
      conguaglio: input.conguaglio,
      conguaglioPagante: input.conguaglioPagante,
      stato: 'bozza',
      snapshot: input.snapshot,
      createdAt: serverTimestamp(),
      createdBy: this.auth.currentUser?.uid ?? 'unknown',
      // Firestore non accetta `undefined`: il campo va del tutto omesso per
      // le trattative semplici, e ripulito dai campi non pertinenti (es.
      // cifraRiscatto per un prestito semplice) per quelle avanzate.
      ...(input.avanzato ? { avanzato: rimuoviUndefined(input.avanzato) } : {}),
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: input.squadraA.teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: ref.id,
      operation: 'create',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: {
        squadraA: input.snapshot.nomeSquadraA,
        squadraB: input.snapshot.nomeSquadraB,
        conguaglio: input.conguaglio,
      },
      changeSummary:
        `Bozza scambio ${input.snapshot.nomeSquadraA} ↔ ${input.snapshot.nomeSquadraB}` +
        (input.conguaglio > 0 ? ` (conguaglio ${input.conguaglio} €)` : ''),
    });
    return ref.id;
  }

  /**
   * Aggiorna una bozza ESISTENTE (resta bozza): giocatori, conguaglio e/o
   * squadre coinvolte possono cambiare — utile per correggere una
   * trattativa senza doverla eliminare e ricreare da zero. Richiede di
   * essere stati coinvolti nella bozza originale (le security rules
   * verificano anche lato server sia questo sia gli ownerUid dichiarati).
   */
  async aggiornaBozza(scambioId: string, input: NuovoScambioInput): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid || (input.squadraA.ownerUid !== uid && input.squadraB.ownerUid !== uid)) {
      throw new Error('Devi accedere come una delle due squadre per modificare questo scambio.');
    }

    await updateDoc(this.scambioRef(scambioId), {
      squadraA: input.squadraA,
      squadraB: input.squadraB,
      conguaglio: input.conguaglio,
      conguaglioPagante: input.conguaglioPagante,
      snapshot: input.snapshot,
      updatedAt: serverTimestamp(),
      ...(input.avanzato ? { avanzato: rimuoviUndefined(input.avanzato) } : {}),
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: input.squadraA.teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: scambioId,
      operation: 'update',
      fieldModified: 'squadraA, squadraB, conguaglio, snapshot',
      valueBefore: null,
      valueAfter: {
        squadraA: input.snapshot.nomeSquadraA,
        squadraB: input.snapshot.nomeSquadraB,
        conguaglio: input.conguaglio,
      },
      changeSummary: `Bozza modificata: ${input.snapshot.nomeSquadraA} ↔ ${input.snapshot.nomeSquadraB}`,
    });
  }

  /**
   * Elimina una trattativa (solo bozze non ancora ufficializzate). Se il
   * documento è arrivato fin qui è già garantito che sia una bozza propria
   * (le security rules non fanno leggere bozze altrui).
   */
  async elimina(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'bozza') {
      throw new Error('Una trattativa ufficializzata non può essere eliminata.');
    }
    await deleteDoc(this.scambioRef(scambio.id));

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: scambio.squadraA.teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: scambio.id,
      operation: 'delete',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: null,
      changeSummary: `Eliminata bozza scambio ${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}`,
    });
  }

  /**
   * Ufficializza una bozza: la rende visibile agli admin per la conferma
   * finale. Basta che una delle due squadre coinvolte la prema (non serve
   * il consenso esplicito di entrambe).
   */
  async ufficializza(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'bozza') {
      throw new Error('Solo una bozza può essere ufficializzata.');
    }
    await updateDoc(this.scambioRef(scambio.id), {
      stato: 'ufficializzata',
      ufficializzataAt: serverTimestamp(),
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: scambio.squadraA.teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: scambio.id,
      operation: 'update',
      fieldModified: 'stato',
      valueBefore: { stato: 'bozza' },
      valueAfter: { stato: 'ufficializzata' },
      changeSummary: `Trattativa ufficializzata: ${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}`,
    });
  }

  /**
   * CONFERMA dell'admin: esegue lo scambio come operazione atomica.
   *
   * Rilegge TUTTI i dati freschi da Firestore (rose, finanze), ricalcola
   * l'anteprima sui dati correnti e scrive in un unico write batch:
   * spostamenti/rivalutazioni giocatori + finanze del conguaglio +
   * passaggio della trattativa a stato "confermata".
   */
  async conferma(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'ufficializzata') {
      throw new Error('La trattativa deve essere ufficializzata prima di poter essere confermata.');
    }
    const { teamIdA, teamIdB } = this.validaSquadre(scambio);

    // --- 1. Lettura FRESCA di rose e finanze ---
    const [rosterA, rosterB] = await Promise.all([
      this.leggiRoster(teamIdA),
      this.leggiRoster(teamIdB),
    ]);

    const selezionatiA = this.estraiGiocatori(rosterA, scambio.squadraA.playerIds, teamIdA);
    const selezionatiB = this.estraiGiocatori(rosterB, scambio.squadraB.playerIds, teamIdB);

    const conguaglio = scambio.conguaglio || 0;
    const anteprima = calcolaAnteprima(
      selezionatiA,
      selezionatiB,
      conguaglio,
      conguaglio > 0 ? scambio.conguaglioPagante : null,
    );
    if (anteprima.errore) {
      throw new Error(`Scambio non più valido: ${anteprima.errore}`);
    }

    return this.eseguiBatch(scambio, {
      teamIdA,
      teamIdB,
      rosterA,
      rosterB,
      selezionatiA,
      selezionatiB,
      conguaglio,
      rivalutazioni: anteprima.rivalutazioni,
    });
  }

  /**
   * CONFERMA di una trattativa AVANZATA (prestiti + bonus): stessa logica
   * di conferma() sopra, ma i valori finali vengono dal modulo di calcolo
   * avanzato (vedi core/scambi-avanzati-calculator.ts) e i giocatori in
   * prestito si spostano FISICAMENTE nella rosa di chi li riceve, come
   * quelli a titolo definitivo — il rientro alla squadra d'origine resta
   * sempre un passo MANUALE dell'admin (vedi confermaRientroPrestito).
   */
  async confermaAvanzato(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'ufficializzata') {
      throw new Error('La trattativa deve essere ufficializzata prima di poter essere confermata.');
    }
    if (!scambio.avanzato) {
      throw new Error('Questa trattativa non ha dati di scambio avanzato.');
    }
    const { teamIdA, teamIdB } = this.validaSquadre(scambio);
    const avanzato = scambio.avanzato;

    const [rosterA, rosterB] = await Promise.all([this.leggiRoster(teamIdA), this.leggiRoster(teamIdB)]);
    const selezionatiA = this.estraiGiocatori(rosterA, scambio.squadraA.playerIds, teamIdA);
    const selezionatiB = this.estraiGiocatori(rosterB, scambio.squadraB.playerIds, teamIdB);

    const giocatoriA = this.aGiocatoriAvanzati(selezionatiA, avanzato.terminiA);
    const giocatoriB = this.aGiocatoriAvanzati(selezionatiB, avanzato.terminiB);

    // Congela la quotazione iniziale (QI) di ciascun giocatore ORA, al
    // momento della prima conferma: i ricalcoli futuri (evento bonus,
    // modifica termini) la useranno così com'è invece di rileggerla live,
    // che nel frattempo potrebbe essere cambiata (aggiornamento settimanale
    // delle quotazioni Serie A).
    const congelaQi = (
      termini: readonly TerminiGiocatoreAvanzato[],
      giocatori: readonly GiocatoreAvanzato[],
    ): TerminiGiocatoreAvanzato[] => {
      const qiById = new Map(giocatori.map((g) => [g.id, g.quotazioneAttuale] as const));
      return termini.map((t) => ({
        ...t,
        quotazioneInizialeConfermata: qiById.get(t.playerId) ?? t.quotazioneInizialeConfermata,
      }));
    };
    const avanzatoConQiCongelata: ScambioAvanzatoDati = {
      ...avanzato,
      terminiA: congelaQi(avanzato.terminiA, giocatoriA),
      terminiB: congelaQi(avanzato.terminiB, giocatoriB),
    };

    const risultato = calcolaScambioAvanzatoConTetto(
      giocatoriA,
      giocatoriB,
      avanzato.conguaglioA || 0,
      avanzato.conguaglioB || 0,
      true,
    );
    if (risultato.errore) {
      throw new Error(`Scambio non più valido: ${risultato.errore}`);
    }

    const rivalutazioniById = new Map(
      risultato.risultati.map(
        (r) =>
          [
            r.giocatore.id,
            {
              player: undefined as unknown as Player, // valorizzato sotto, per giocatore
              valorePrima: r.valorePrima,
              aumento: round2(r.valoreDopo - r.valorePrima),
              valoreDopo: r.valoreDopo,
            },
          ] as const,
      ),
    );

    const movimenti = [
      ...selezionatiA.map((p) => ({ player: p, fromTeamId: teamIdA, toTeamId: teamIdB })),
      ...selezionatiB.map((p) => ({ player: p, fromTeamId: teamIdB, toTeamId: teamIdA })),
    ];
    // Completa il campo `player` di ogni rivalutazione (serve a patchGiocatore)
    for (const m of movimenti) {
      const r = rivalutazioniById.get(m.player.id);
      if (r) {
        (r as { player: Player }).player = m.player;
      }
    }

    const valoreFinale = new Map<string, number>();
    for (const m of movimenti) {
      const patch = patchGiocatore(m.player, rivalutazioniById.get(m.player.id));
      valoreFinale.set(m.player.id, round2(patch.valoreAttuale ?? m.player.valoreAttuale));
    }
    const rosaNuovaA = this.nuovoValoreRosa(rosterA, selezionatiA, selezionatiB, valoreFinale);
    const rosaNuovaB = this.nuovoValoreRosa(rosterB, selezionatiB, selezionatiA, valoreFinale);

    // Due conguagli indipendenti (a differenza dello scambio semplice, qui
    // possono in teoria pagare entrambi i lati contemporaneamente)
    const financeUpdates: {
      teamId: string;
      campo: 'trasferimentiUscita' | 'trasferimentiEntrata';
      data: Record<string, unknown>;
      before: Record<string, unknown> | null;
    }[] = [];
    if (avanzato.conguaglioA > 0) {
      await this.aggiungiFlussoConguaglio(financeUpdates, teamIdA, teamIdB, avanzato.conguaglioA, rosaNuovaA, rosaNuovaB);
    }
    if (avanzato.conguaglioB > 0) {
      await this.aggiungiFlussoConguaglio(financeUpdates, teamIdB, teamIdA, avanzato.conguaglioB, rosaNuovaB, rosaNuovaA);
    }

    return this.scriviBatch(
      scambio,
      movimenti,
      financeUpdates,
      [...rivalutazioniById.values()] as import('../scambi-calculator').PlayerRivalutazione[],
      teamIdA,
      teamIdB,
      avanzatoConQiCongelata,
    );
  }

  /** Aggiunge a `financeUpdates` il flusso uscita/entrata di un conguaglio pagato da `pagatore` verso `ricevente` */
  private async aggiungiFlussoConguaglio(
    financeUpdates: {
      teamId: string;
      campo: 'trasferimentiUscita' | 'trasferimentiEntrata';
      data: Record<string, unknown>;
      before: Record<string, unknown> | null;
    }[],
    pagatore: string,
    ricevente: string,
    importo: number,
    rosaPagatore: number,
    rosaRicevente: number,
  ): Promise<void> {
    const [finPagatore, finRicevente] = await Promise.all([this.leggiFinance(pagatore), this.leggiFinance(ricevente)]);
    financeUpdates.push(
      {
        teamId: pagatore,
        campo: 'trasferimentiUscita',
        data: this.finance.preparaTrasferimento(
          finPagatore,
          'trasferimentiUscita',
          importo,
          rosaPagatore,
        ) as unknown as Record<string, unknown>,
        before: (finPagatore as unknown as Record<string, unknown>) ?? null,
      },
      {
        teamId: ricevente,
        campo: 'trasferimentiEntrata',
        data: this.finance.preparaTrasferimento(
          finRicevente,
          'trasferimentiEntrata',
          importo,
          rosaRicevente,
        ) as unknown as Record<string, unknown>,
        before: (finRicevente as unknown as Record<string, unknown>) ?? null,
      },
    );
  }

  /** Converte giocatori + termini pattuiti nel formato richiesto dal calcolatore avanzato */
  private aGiocatoriAvanzati(players: Player[], termini: TerminiGiocatoreAvanzato[]): GiocatoreAvanzato[] {
    const terminiById = new Map(termini.map((t) => [t.playerId, t] as const));
    return players.flatMap((p) => {
      const t = terminiById.get(p.id);
      if (!t) {
        return [];
      }
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

  /** Esegue il write batch atomico di conferma + audit log */
  private async eseguiBatch(scambio: Scambio, ctx: ContestoConferma): Promise<void> {
    const { teamIdA, teamIdB, rosterA, rosterB, selezionatiA, selezionatiB, conguaglio } = ctx;
    const rivalutazioniById = new Map(
      ctx.rivalutazioni.map((r) => [r.player.id, r] as const),
    );

    const movimenti = [
      ...selezionatiA.map((p) => ({ player: p, fromTeamId: teamIdA, toTeamId: teamIdB })),
      ...selezionatiB.map((p) => ({ player: p, fromTeamId: teamIdB, toTeamId: teamIdA })),
    ];

    // Valore finale V.A. di ogni giocatore dopo la patch (per il valore rosa)
    const valoreFinale = new Map<string, number>();
    for (const m of movimenti) {
      const patch = patchGiocatore(m.player, rivalutazioniById.get(m.player.id));
      valoreFinale.set(m.player.id, round2(patch.valoreAttuale ?? m.player.valoreAttuale));
    }

    // Nuovo valore rosa di ciascuna squadra post-scambio
    const rosaNuovaA = this.nuovoValoreRosa(rosterA, selezionatiA, selezionatiB, valoreFinale);
    const rosaNuovaB = this.nuovoValoreRosa(rosterB, selezionatiB, selezionatiA, valoreFinale);

    // Finanze del conguaglio (letture fresche + ricalcolo completo)
    const financeUpdates: {
      teamId: string;
      campo: 'trasferimentiUscita' | 'trasferimentiEntrata';
      data: Record<string, unknown>;
      before: Record<string, unknown> | null;
    }[] = [];
    if (conguaglio > 0 && scambio.conguaglioPagante) {
      const pagatore = scambio.conguaglioPagante === 'A' ? teamIdA : teamIdB;
      const ricevente = scambio.conguaglioPagante === 'A' ? teamIdB : teamIdA;

      const [finPagatore, finRicevente] = await Promise.all([
        this.leggiFinance(pagatore),
        this.leggiFinance(ricevente),
      ]);
      financeUpdates.push(
        {
          teamId: pagatore,
          campo: 'trasferimentiUscita',
          data: this.finance.preparaTrasferimento(
            finPagatore,
            'trasferimentiUscita',
            conguaglio,
            pagatore === teamIdA ? rosaNuovaA : rosaNuovaB,
          ) as unknown as Record<string, unknown>,
          before: (finPagatore as unknown as Record<string, unknown>) ?? null,
        },
        {
          teamId: ricevente,
          campo: 'trasferimentiEntrata',
          data: this.finance.preparaTrasferimento(
            finRicevente,
            'trasferimentiEntrata',
            conguaglio,
            ricevente === teamIdA ? rosaNuovaA : rosaNuovaB,
          ) as unknown as Record<string, unknown>,
          before: (finRicevente as unknown as Record<string, unknown>) ?? null,
        },
      );
    }
    return this.scriviBatch(
      scambio,
      movimenti,
      financeUpdates,
      ctx.rivalutazioni,
      teamIdA,
      teamIdB,
    );
  }

  /** Scrittura atomica: giocatori + finanze + stato trattativa + undoLog */
  private async scriviBatch(
    scambio: Scambio,
    movimenti: { player: Player; fromTeamId: string; toTeamId: string }[],
    financeUpdates: {
      teamId: string;
      campo: 'trasferimentiUscita' | 'trasferimentiEntrata';
      data: Record<string, unknown>;
      before: Record<string, unknown> | null;
    }[],
    rivalutazioni: import('../scambi-calculator').PlayerRivalutazione[],
    teamIdA: string,
    teamIdB: string,
    /** Solo per lo scambio avanzato: termini con la QI congelata da scrivere insieme alla conferma */
    avanzatoConQiCongelata?: ScambioAvanzatoDati,
  ): Promise<void> {
    const rivalutazioniById = new Map(
      rivalutazioni.map((r) => [r.player.id, r] as const),
    );
    const batch = writeBatch(this.firestore);
    const undoDocs: { path: string; before: Record<string, unknown> | null }[] = [];

    for (const m of movimenti) {
      const { id: _id, ...playerData } = m.player;
      const patch = patchGiocatore(m.player, rivalutazioniById.get(m.player.id));
      const nuovoRef = doc(this.firestore, this.playerPath(m.toTeamId, m.player.id));
      const vecchioRef = doc(this.firestore, this.playerPath(m.fromTeamId, m.player.id));
      batch.set(nuovoRef, {
        ...playerData,
        ...patch,
        updatedAt: serverTimestamp(),
      });
      batch.delete(vecchioRef);
      // Annullamento: il giocatore torna alla vecchia squadra col vecchio
      // stato, e sparisce dalla nuova (prima=null perché lì non esisteva).
      undoDocs.push({ path: vecchioRef.path, before: playerData as Record<string, unknown> });
      undoDocs.push({ path: nuovoRef.path, before: null });
    }

    for (const f of financeUpdates) {
      const financeRef = doc(this.firestore, this.financePath(f.teamId));
      batch.set(
        financeRef,
        {
          ...f.data,
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.currentUser?.uid ?? 'unknown',
        },
        { merge: true },
      );
      undoDocs.push({ path: financeRef.path, before: f.before });
    }

    batch.update(this.scambioRef(scambio.id), {
      stato: 'confermata',
      confirmedAt: serverTimestamp(),
      ...(avanzatoConQiCongelata ? { avanzato: rimuoviUndefined(avanzatoConQiCongelata) } : {}),
    });

    this.undo.registra(batch, {
      tipo: 'scambioConferma',
      leagueId: environment.leagueId,
      teamIds: [teamIdA, teamIdB],
      descrizione: `Scambio confermato ${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}`,
      docs: undoDocs,
      scambioId: scambio.id,
    });

    await batch.commit();

    // Audit log (mai bloccante): una voce riepilogativa per squadra coinvolta
    const dettaglioRivalutazioni = rivalutazioni
      .map((r) => `${r.player.name}: ${r.valorePrima} → ${r.valoreDopo} €`)
      .join('; ');
    this.logConferma(
      scambio,
      teamIdA,
      teamIdB,
      movimenti.length,
      scambio.conguaglio || 0,
      dettaglioRivalutazioni,
    );
  }

  /** Verifica che le due squadre siano diverse e presenti */
  private validaSquadre(scambio: Scambio): { teamIdA: string; teamIdB: string } {
    const teamIdA = scambio.squadraA.teamId;
    const teamIdB = scambio.squadraB.teamId;
    if (!teamIdA || !teamIdB) {
      throw new Error('Seleziona entrambe le squadre.');
    }
    if (teamIdA === teamIdB) {
      throw new Error('Le due squadre dello scambio devono essere diverse.');
    }
    return { teamIdA, teamIdB };
  }

  /** Legge l'intero roster (fresco) della stagione corrente */
  private async leggiRoster(teamId: string): Promise<Player[]> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(
        collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
      );
      return snap.docs.map((d) => ({ ...(d.data() as Player), id: d.id }));
    });
  }

  /** Estrae i giocatori richiesti dal roster, fallendo se qualcuno non c'è più */
  private estraiGiocatori(roster: Player[], playerIds: string[], teamId: string): Player[] {
    const byId = new Map(roster.map((p) => [p.id, p] as const));
    return playerIds.map((id) => {
      const p = byId.get(id);
      if (!p) {
        throw new Error(`Un giocatore della squadra ${teamId} non è più in rosa.`);
      }
      return p;
    });
  }

  /**
   * Valore rosa post-scambio: roster attuale − V.A. dei ceduti + V.A. finale
   * degli arrivati (diverso per i rivalutati).
   */
  private nuovoValoreRosa(
    roster: Player[],
    uscenti: Player[],
    entrati: Player[],
    valoreFinale: Map<string, number>,
  ): number {
    const idsUscenti = new Set(uscenti.map((p) => p.id));
    const totale = roster
      .filter((p) => !idsUscenti.has(p.id))
      .reduce((s, p) => s + (p.valoreAttuale || 0), 0);
    const ingressi = entrati.reduce(
      (s, p) => s + (valoreFinale.get(p.id) ?? p.valoreAttuale ?? 0),
      0,
    );
    return round2(totale + ingressi);
  }

  private async leggiFinance(teamId: string) {
    const snap = await getDoc(doc(this.firestore, this.financePath(teamId)));
    return snap.data() as import('../models').SeasonFinance | undefined;
  }

  /** Voci di audit per la conferma dello scambio */
  private logConferma(
    scambio: Scambio,
    teamIdA: string,
    teamIdB: string,
    numGiocatori: number,
    conguaglio: number,
    dettaglioRivalutazioni: string,
  ): void {
    const nomi = `${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}`;
    const base = {
      leagueId: environment.leagueId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio' as AuditEntityType,
      entityId: scambio.id,
      operation: 'update' as const,
      valueBefore: null as unknown,
      valueAfter: { stato: 'confermata', conguaglio } as unknown,
    };
    void this.audit.log({
      ...base,
      teamId: teamIdA,
      fieldModified: 'players, seasonFinance',
      changeSummary:
        `Scambio confermato ${nomi}: ${numGiocatori} giocatori` +
        (conguaglio > 0 ? `, conguaglio ${conguaglio} €` : '') +
        (dettaglioRivalutazioni ? `. Rivalutazioni: ${dettaglioRivalutazioni}` : ''),
    });
    void this.audit.log({
      ...base,
      teamId: teamIdB,
      fieldModified: 'players, seasonFinance',
      changeSummary: `Scambio confermato ${nomi}: completato`,
    });
  }

  /**
   * Rientro dal prestito: SEMPRE un passo manuale dell'admin, mai
   * automatico. Sposta il giocatore così com'è oggi (eventuali rinnovi o
   * variazioni di quotazione nel frattempo restano) dalla rosa di chi lo
   * aveva ricevuto in prestito a quella della squadra d'origine, e marca
   * il prestito come concluso nella trattativa.
   */
  async confermaRientroPrestito(scambio: Scambio, playerId: string): Promise<void> {
    if (scambio.stato !== 'confermata' || !scambio.avanzato) {
      throw new Error('Questa trattativa non ha un prestito da far rientrare.');
    }
    const { id: _scambioId, ...scambioSenzaId } = scambio;
    const inA = scambio.avanzato.terminiA.find((t) => t.playerId === playerId);
    const inB = scambio.avanzato.terminiB.find((t) => t.playerId === playerId);
    const termini = inA ?? inB;
    if (!termini) {
      throw new Error('Giocatore non trovato in questa trattativa.');
    }
    const eDefinitivo =
      termini.tipoContratto === 'definitivo' ||
      termini.tipoContratto === 'prestitoObbligo' ||
      (termini.tipoContratto === 'prestitoDiritto' && termini.riscattato === true);
    if (eDefinitivo) {
      throw new Error('Questo giocatore non è (più) in prestito: è di proprietà definitiva.');
    }
    if (termini.prestitoConcluso) {
      throw new Error('Il rientro di questo giocatore è già stato confermato.');
    }

    // Se il giocatore compare in terminiA, vuol dire che lo ha CEDUTO la
    // squadra A: oggi si trova quindi presso B, e deve rientrare in A.
    const teamOrigine = inA ? scambio.squadraA.teamId : scambio.squadraB.teamId;
    const teamAttuale = inA ? scambio.squadraB.teamId : scambio.squadraA.teamId;

    const vecchioRef = doc(this.firestore, this.playerPath(teamAttuale, playerId));
    const playerSnap = await getDoc(vecchioRef);
    const playerData = playerSnap.data() as Player | undefined;
    if (!playerData) {
      throw new Error('Il giocatore non è più nella rosa che lo aveva ricevuto in prestito.');
    }
    const { id: _id, ...datiSenzaId } = playerData;
    const nuovoRef = doc(this.firestore, this.playerPath(teamOrigine, playerId));

    const nuoviTerminiA = scambio.avanzato.terminiA.map((t) =>
      t.playerId === playerId ? { ...t, prestitoConcluso: true } : t,
    );
    const nuoviTerminiB = scambio.avanzato.terminiB.map((t) =>
      t.playerId === playerId ? { ...t, prestitoConcluso: true } : t,
    );
    const scambioRef = this.scambioRef(scambio.id);

    const batch = writeBatch(this.firestore);
    batch.set(nuovoRef, { ...datiSenzaId, updatedAt: serverTimestamp() });
    batch.delete(vecchioRef);
    batch.update(scambioRef, {
      avanzato: rimuoviUndefined({ ...scambio.avanzato, terminiA: nuoviTerminiA, terminiB: nuoviTerminiB }),
    });

    this.undo.registra(batch, {
      tipo: 'rientroPrestito',
      leagueId: environment.leagueId,
      teamIds: [teamOrigine, teamAttuale],
      descrizione: `Rientro dal prestito di ${playerData.name}: da ${teamAttuale === scambio.squadraA.teamId ? scambio.snapshot.nomeSquadraA : scambio.snapshot.nomeSquadraB} a ${teamOrigine === scambio.squadraA.teamId ? scambio.snapshot.nomeSquadraA : scambio.snapshot.nomeSquadraB}`,
      docs: [
        { path: vecchioRef.path, before: datiSenzaId as unknown as Record<string, unknown> },
        { path: nuovoRef.path, before: null },
        // L'annullamento fa un set() SENZA merge: il "prima" deve essere
        // l'intero documento scambio, non solo il campo avanzato — altrimenti
        // annullare cancellerebbe squadraA/squadraB/stato/snapshot/ecc.
        { path: scambioRef.path, before: scambioSenzaId as unknown as Record<string, unknown> },
      ],
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: teamOrigine,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'update',
      fieldModified: 'rosa',
      valueBefore: { teamId: teamAttuale },
      valueAfter: { teamId: teamOrigine },
      changeSummary: `${playerData.name} rientrato dal prestito`,
    });
  }

  /**
   * Aggiorna UN bonus di UN giocatore di una trattativa avanzata
   * confermata (eventi confermati finora, o soglia superata), ricalcola i
   * valori di TUTTI i giocatori coinvolti con i dati REALIZZATI finora, e
   * scrive la DIFFERENZA di bonus realizzato nelle finanze (trasferimenti)
   * di chi lo deve versare / chi lo riceve — stesso principio di un
   * conguaglio, ma realizzato a rate man mano che gli eventi accadono.
   */
  async confermaEventoBonus(
    scambio: Scambio,
    playerId: string,
    bonusId: string,
    aggiornamento: { eventiVerificati: number } | { verificato: boolean },
  ): Promise<void> {
    if (scambio.stato !== 'confermata' || !scambio.avanzato) {
      throw new Error('Questa trattativa non è ancora confermata.');
    }
    const { teamIdA, teamIdB } = this.validaSquadre(scambio);
    const avanzato = scambio.avanzato;
    const { id: _scambioId, ...scambioSenzaId } = scambio;

    const inA = avanzato.terminiA.some((t) => t.playerId === playerId);
    const terminiLato = inA ? avanzato.terminiA : avanzato.terminiB;
    const idxGiocatore = terminiLato.findIndex((t) => t.playerId === playerId);
    if (idxGiocatore === -1) {
      throw new Error('Giocatore non trovato in questa trattativa.');
    }
    const bonusList = terminiLato[idxGiocatore].bonus ?? [];
    const idxBonus = bonusList.findIndex((b) => b.id === bonusId);
    if (idxBonus === -1) {
      throw new Error('Bonus non trovato.');
    }
    const bonusPrima = bonusList[idxBonus];

    // Calcola la differenza in € da versare per QUESTO aggiornamento
    let deltaEuro = 0;
    let bonusDopo = bonusPrima;
    if ('eventiVerificati' in aggiornamento && 'eventiAttesi' in bonusPrima) {
      const nuovi = Math.max(0, aggiornamento.eventiVerificati);
      deltaEuro = round2((nuovi - bonusPrima.eventiVerificati) * bonusPrima.rewardPerEvento);
      bonusDopo = { ...bonusPrima, eventiVerificati: nuovi };
    } else if ('verificato' in aggiornamento && 'soglia' in bonusPrima) {
      const primaBool = bonusPrima.verificato;
      const dopoBool = aggiornamento.verificato;
      if (primaBool !== dopoBool) {
        deltaEuro = round2((dopoBool ? 1 : -1) * bonusPrima.rewardUnaTantum);
      }
      bonusDopo = { ...bonusPrima, verificato: dopoBool };
    } else {
      throw new Error('Aggiornamento non compatibile con il tipo di bonus.');
    }

    // Salva il nuovo stato del bonus nella trattativa
    const nuovaBonusList = bonusList.map((b, i) => (i === idxBonus ? bonusDopo : b));
    const nuoviTerminiLato = terminiLato.map((t, i) => (i === idxGiocatore ? { ...t, bonus: nuovaBonusList } : t));
    const nuovoAvanzato: ScambioAvanzatoDati = inA
      ? { ...avanzato, terminiA: nuoviTerminiLato }
      : { ...avanzato, terminiB: nuoviTerminiLato };

    // Ricalcola i valori di TUTTI i giocatori coinvolti con i dati
    // REALIZZATI finora (faseIniziale = false) — legge ciascun giocatore
    // dalla rosa in cui si trova OGGI (chi è già rientrato dal prestito
    // potrebbe non essere più presso chi l'ha ricevuto).
    const tuttiTermini = [...nuovoAvanzato.terminiA, ...nuovoAvanzato.terminiB];
    const giocatoriCorrenti = await runInInjectionContext(this.injector, () =>
      Promise.all(
        tuttiTermini.map(async (t) => {
          const inLatoA = nuovoAvanzato.terminiA.some((x) => x.playerId === t.playerId);
          // Se il prestito è concluso, il giocatore è tornato alla squadra
          // D'ORIGINE (l'altro lato rispetto a chi lo aveva ceduto); altrimenti
          // è ancora presso chi lo ha ricevuto.
          const squadraCedente = inLatoA ? teamIdA : teamIdB;
          const squadraRicevente = inLatoA ? teamIdB : teamIdA;
          const teamIdAttuale = t.prestitoConcluso ? squadraCedente : squadraRicevente;
          const snap = await getDoc(doc(this.firestore, this.playerPath(teamIdAttuale, t.playerId)));
          const player = snap.exists() ? ({ ...snap.data(), id: t.playerId } as Player) : undefined;
          return { termini: t, player, teamIdAttuale };
        }),
      ),
    );

    const mancante = giocatoriCorrenti.find((g) => !g.player);
    if (mancante) {
      throw new Error(`Un giocatore della trattativa non è più in nessuna rosa (id ${mancante.termini.playerId}).`);
    }

    const giocatoriA = giocatoriCorrenti
      .filter((g) => nuovoAvanzato.terminiA.some((x) => x.playerId === g.termini.playerId))
      .map((g) => this.aGiocatoreAvanzatoSingolo(g.player!, g.termini));
    const giocatoriB = giocatoriCorrenti
      .filter((g) => nuovoAvanzato.terminiB.some((x) => x.playerId === g.termini.playerId))
      .map((g) => this.aGiocatoreAvanzatoSingolo(g.player!, g.termini));

    const risultato = calcolaScambioAvanzatoConTetto(
      giocatoriA,
      giocatoriB,
      nuovoAvanzato.conguaglioA || 0,
      nuovoAvanzato.conguaglioB || 0,
      false, // usa i bonus REALIZZATI finora, non gli attesi
    );
    if (risultato.errore) {
      throw new Error(`Ricalcolo non riuscito: ${risultato.errore}`);
    }

    const batch = writeBatch(this.firestore);
    const undoDocs: { path: string; before: Record<string, unknown> | null }[] = [];

    for (const g of giocatoriCorrenti) {
      const r = risultato.risultati.find((x) => x.giocatore.id === g.termini.playerId);
      if (!r) {
        continue;
      }
      const playerRef = doc(this.firestore, this.playerPath(g.teamIdAttuale, g.termini.playerId));
      const patch = patchGiocatore(g.player!, {
        player: g.player!,
        valorePrima: r.valorePrima,
        aumento: round2(r.valoreDopo - r.valorePrima),
        valoreDopo: r.valoreDopo,
      });
      undoDocs.push({ path: playerRef.path, before: g.player as unknown as Record<string, unknown> });
      batch.update(playerRef, { ...patch, updatedAt: serverTimestamp() });
    }

    // Il bonus realizzato si sposta dalle finanze di chi lo deve versare
    // (chi ha RICEVUTO il giocatore) a chi lo riceve (chi lo aveva CEDUTO)
    if (deltaEuro !== 0) {
      const cedente = inA ? teamIdA : teamIdB;
      const ricevente = inA ? teamIdB : teamIdA;
      const valoreRosaCedente = await this.valoreRosaAttuale(cedente);
      const valoreRosaRicevente = await this.valoreRosaAttuale(ricevente);
      const [finRicevente, finCedente] = await Promise.all([
        this.leggiFinance(ricevente),
        this.leggiFinance(cedente),
      ]);
      const datiUscita = this.finance.preparaTrasferimento(
        finRicevente,
        'trasferimentiUscita',
        deltaEuro,
        valoreRosaRicevente,
      );
      const datiEntrata = this.finance.preparaTrasferimento(
        finCedente,
        'trasferimentiEntrata',
        deltaEuro,
        valoreRosaCedente,
      );
      const financeRefRicevente = doc(this.firestore, this.financePath(ricevente));
      const financeRefCedente = doc(this.firestore, this.financePath(cedente));
      batch.set(
        financeRefRicevente,
        { ...datiUscita, updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser?.uid ?? 'unknown' },
        { merge: true },
      );
      batch.set(
        financeRefCedente,
        { ...datiEntrata, updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser?.uid ?? 'unknown' },
        { merge: true },
      );
      undoDocs.push(
        { path: financeRefRicevente.path, before: (finRicevente as unknown as Record<string, unknown>) ?? null },
        { path: financeRefCedente.path, before: (finCedente as unknown as Record<string, unknown>) ?? null },
      );
    }

    const scambioRef = this.scambioRef(scambio.id);
    batch.update(scambioRef, { avanzato: rimuoviUndefined(nuovoAvanzato) });
    // Come sopra: il "prima" per l'annullamento dev'essere l'intero
    // documento (set() senza merge), non solo il campo avanzato.
    undoDocs.push({ path: scambioRef.path, before: scambioSenzaId as unknown as Record<string, unknown> });

    this.undo.registra(batch, {
      tipo: 'eventoBonusScambio',
      leagueId: environment.leagueId,
      teamIds: [teamIdA, teamIdB],
      descrizione: `Bonus ${bonusDopo.tipo} aggiornato per ${giocatoriCorrenti.find((g) => g.termini.playerId === playerId)?.player?.name ?? playerId}${deltaEuro !== 0 ? ` (${deltaEuro > 0 ? '+' : ''}${deltaEuro} €)` : ''}`,
      docs: undoDocs,
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: inA ? teamIdA : teamIdB,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: scambio.id,
      operation: 'update',
      fieldModified: 'avanzato.bonus',
      valueBefore: bonusPrima,
      valueAfter: bonusDopo,
      changeSummary: `Bonus ${bonusDopo.tipo} aggiornato${deltaEuro !== 0 ? `: ${deltaEuro > 0 ? '+' : ''}${deltaEuro} € nei trasferimenti` : ''}`,
    });
  }

  /**
   * Aggiorna riscattato / cifra di riscatto di UN giocatore di una
   * trattativa avanzata già confermata (admin) — servono per correggere
   * dati che al momento della conferma erano solo stime (es. "non si sa
   * ancora se il diritto sarà esercitato"). La quotazione finale NON è più
   * un campo qui: nei ricalcoli post-conferma si usa sempre la quotazione
   * attuale live (vedi aGiocatoreAvanzatoSingolo) — resta solo simulabile
   * in anteprima, vedi simulaRicalcoloAvanzato.
   * Ricalcola i valori di TUTTI i giocatori coinvolti coi dati REALIZZATI
   * finora (stessa logica di confermaEventoBonus), e se il riscatto cambia
   * (o cambia la sua cifra) sposta la differenza tra le finanze di chi la
   * deve versare e chi la riceve — stesso principio di un bonus realizzato,
   * ma per la cifra di riscatto invece che per un evento.
   */
  async aggiornaTerminiAvanzati(
    scambio: Scambio,
    playerId: string,
    patch: { riscattato?: boolean; cifraRiscatto?: number },
  ): Promise<void> {
    if (scambio.stato !== 'confermata' || !scambio.avanzato) {
      throw new Error('Questa trattativa non è ancora confermata.');
    }
    const { teamIdA, teamIdB } = this.validaSquadre(scambio);
    const avanzato = scambio.avanzato;
    const { id: _scambioId, ...scambioSenzaId } = scambio;

    const inA = avanzato.terminiA.some((t) => t.playerId === playerId);
    const terminiLato = inA ? avanzato.terminiA : avanzato.terminiB;
    const idxGiocatore = terminiLato.findIndex((t) => t.playerId === playerId);
    if (idxGiocatore === -1) {
      throw new Error('Giocatore non trovato in questa trattativa.');
    }
    const terminiPrima = terminiLato[idxGiocatore];
    const terminiDopo: TerminiGiocatoreAvanzato = { ...terminiPrima, ...patch };

    // La cifra di riscatto conta solo se il contratto la prevede DAVVERO
    // (obbligo, o diritto già esercitato) — stessa condizione del calcolatore.
    const contaRiscatto = (t: TerminiGiocatoreAvanzato) =>
      t.tipoContratto === 'prestitoObbligo' || (t.tipoContratto === 'prestitoDiritto' && t.riscattato === true);
    const cifraPrima = contaRiscatto(terminiPrima) ? terminiPrima.cifraRiscatto ?? 0 : 0;
    const cifraDopo = contaRiscatto(terminiDopo) ? terminiDopo.cifraRiscatto ?? 0 : 0;
    const deltaEuro = round2(cifraDopo - cifraPrima);

    const nuoviTerminiLato = terminiLato.map((t, i) => (i === idxGiocatore ? terminiDopo : t));
    const nuovoAvanzato: ScambioAvanzatoDati = inA
      ? { ...avanzato, terminiA: nuoviTerminiLato }
      : { ...avanzato, terminiB: nuoviTerminiLato };

    // Ricalcola i valori di TUTTI i giocatori coinvolti coi dati REALIZZATI
    // finora — stessa logica di lettura di confermaEventoBonus (ciascuno
    // dalla rosa in cui si trova OGGI, non da dove l'aveva ceduto).
    const tuttiTermini = [...nuovoAvanzato.terminiA, ...nuovoAvanzato.terminiB];
    const giocatoriCorrenti = await Promise.all(
      tuttiTermini.map(async (t) => {
        const inLatoA = nuovoAvanzato.terminiA.some((x) => x.playerId === t.playerId);
        const squadraCedente = inLatoA ? teamIdA : teamIdB;
        const squadraRicevente = inLatoA ? teamIdB : teamIdA;
        const teamIdAttuale = t.prestitoConcluso ? squadraCedente : squadraRicevente;
        const snap = await getDoc(doc(this.firestore, this.playerPath(teamIdAttuale, t.playerId)));
        const player = snap.exists() ? ({ ...snap.data(), id: t.playerId } as Player) : undefined;
        return { termini: t, player, teamIdAttuale };
      }),
    );

    const mancante = giocatoriCorrenti.find((g) => !g.player);
    if (mancante) {
      throw new Error(`Un giocatore della trattativa non è più in nessuna rosa (id ${mancante.termini.playerId}).`);
    }

    const giocatoriA = giocatoriCorrenti
      .filter((g) => nuovoAvanzato.terminiA.some((x) => x.playerId === g.termini.playerId))
      .map((g) => this.aGiocatoreAvanzatoSingolo(g.player!, g.termini));
    const giocatoriB = giocatoriCorrenti
      .filter((g) => nuovoAvanzato.terminiB.some((x) => x.playerId === g.termini.playerId))
      .map((g) => this.aGiocatoreAvanzatoSingolo(g.player!, g.termini));

    const risultato = calcolaScambioAvanzatoConTetto(
      giocatoriA,
      giocatoriB,
      nuovoAvanzato.conguaglioA || 0,
      nuovoAvanzato.conguaglioB || 0,
      false, // usa i bonus REALIZZATI finora, non gli attesi
    );
    if (risultato.errore) {
      throw new Error(`Ricalcolo non riuscito: ${risultato.errore}`);
    }

    const batch = writeBatch(this.firestore);
    const undoDocs: { path: string; before: Record<string, unknown> | null }[] = [];

    for (const g of giocatoriCorrenti) {
      const r = risultato.risultati.find((x) => x.giocatore.id === g.termini.playerId);
      if (!r) {
        continue;
      }
      const playerRef = doc(this.firestore, this.playerPath(g.teamIdAttuale, g.termini.playerId));
      const patchValori = patchGiocatore(g.player!, {
        player: g.player!,
        valorePrima: r.valorePrima,
        aumento: round2(r.valoreDopo - r.valorePrima),
        valoreDopo: r.valoreDopo,
      });
      undoDocs.push({ path: playerRef.path, before: g.player as unknown as Record<string, unknown> });
      batch.update(playerRef, { ...patchValori, updatedAt: serverTimestamp() });
    }

    // La cifra di riscatto si sposta dalle finanze di chi lo deve versare
    // (chi ha RICEVUTO il giocatore) a chi lo riceve (chi lo aveva CEDUTO) —
    // stesso principio di un bonus realizzato.
    if (deltaEuro !== 0) {
      const cedente = inA ? teamIdA : teamIdB;
      const ricevente = inA ? teamIdB : teamIdA;
      const valoreRosaCedente = await this.valoreRosaAttuale(cedente);
      const valoreRosaRicevente = await this.valoreRosaAttuale(ricevente);
      const [finRicevente, finCedente] = await Promise.all([
        this.leggiFinance(ricevente),
        this.leggiFinance(cedente),
      ]);
      const datiUscita = this.finance.preparaTrasferimento(
        finRicevente,
        'trasferimentiUscita',
        deltaEuro,
        valoreRosaRicevente,
      );
      const datiEntrata = this.finance.preparaTrasferimento(
        finCedente,
        'trasferimentiEntrata',
        deltaEuro,
        valoreRosaCedente,
      );
      const financeRefRicevente = doc(this.firestore, this.financePath(ricevente));
      const financeRefCedente = doc(this.firestore, this.financePath(cedente));
      batch.set(
        financeRefRicevente,
        { ...datiUscita, updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser?.uid ?? 'unknown' },
        { merge: true },
      );
      batch.set(
        financeRefCedente,
        { ...datiEntrata, updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser?.uid ?? 'unknown' },
        { merge: true },
      );
      undoDocs.push(
        { path: financeRefRicevente.path, before: (finRicevente as unknown as Record<string, unknown>) ?? null },
        { path: financeRefCedente.path, before: (finCedente as unknown as Record<string, unknown>) ?? null },
      );
    }

    const scambioRef = this.scambioRef(scambio.id);
    batch.update(scambioRef, { avanzato: rimuoviUndefined(nuovoAvanzato) });
    undoDocs.push({ path: scambioRef.path, before: scambioSenzaId as unknown as Record<string, unknown> });

    const nomeGiocatore = giocatoriCorrenti.find((g) => g.termini.playerId === playerId)?.player?.name ?? playerId;
    this.undo.registra(batch, {
      tipo: 'modificaTerminiScambio',
      leagueId: environment.leagueId,
      teamIds: [teamIdA, teamIdB],
      descrizione: `Termini aggiornati per ${nomeGiocatore}${deltaEuro !== 0 ? ` (${deltaEuro > 0 ? '+' : ''}${deltaEuro} € riscatto)` : ''}`,
      docs: undoDocs,
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: inA ? teamIdA : teamIdB,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'scambio',
      entityId: scambio.id,
      operation: 'update',
      fieldModified: 'avanzato.termini',
      valueBefore: terminiPrima,
      valueAfter: terminiDopo,
      changeSummary: `Termini di ${nomeGiocatore} aggiornati${deltaEuro !== 0 ? `: ${deltaEuro > 0 ? '+' : ''}${deltaEuro} € nei trasferimenti` : ''}`,
    });
  }

  /**
   * Ricalcolo di SOLA ANTEPRIMA per una trattativa avanzata già confermata:
   * stessa logica di aggiornaTerminiAvanzati / confermaEventoBonus, ma senza
   * scrivere nulla — serve alla funzione "Simula cambio valori" per provare
   * ipotesi (durata, riscatto, eventi) prima di applicarle davvero.
   */
  async simulaRicalcoloAvanzato(
    scambio: Scambio,
    overrides: Record<string, Partial<TerminiGiocatoreAvanzato>>,
  ): Promise<{ risultati: RivalutazioneAvanzata[]; errore: string | null }> {
    if (!scambio.avanzato) {
      throw new Error('Questa trattativa non ha termini avanzati.');
    }
    const { teamIdA, teamIdB } = this.validaSquadre(scambio);
    const avanzato = scambio.avanzato;

    const applicaOverride = (t: TerminiGiocatoreAvanzato): TerminiGiocatoreAvanzato => ({
      ...t,
      ...(overrides[t.playerId] ?? {}),
    });
    const terminiA = avanzato.terminiA.map(applicaOverride);
    const terminiB = avanzato.terminiB.map(applicaOverride);
    const tuttiTermini = [...terminiA, ...terminiB];

    // Nessuna scrittura in questo metodo (è una sola-anteprima): senza un
    // batch.commit() che poi faccia ripartire da sola la change detection
    // (via lo snapshot di scambi$), le letture getDoc vanno avviate dentro
    // l'injection context di Angular, altrimenti il segnale si aggiorna ma
    // la UI non si ridisegna (bug reale, trovato testando dal vivo).
    const giocatoriCorrenti = await runInInjectionContext(this.injector, () =>
      Promise.all(
        tuttiTermini.map(async (t) => {
          const inLatoA = terminiA.some((x) => x.playerId === t.playerId);
          const squadraCedente = inLatoA ? teamIdA : teamIdB;
          const squadraRicevente = inLatoA ? teamIdB : teamIdA;
          const teamIdAttuale = t.prestitoConcluso ? squadraCedente : squadraRicevente;
          const snap = await getDoc(doc(this.firestore, this.playerPath(teamIdAttuale, t.playerId)));
          const player = snap.exists() ? ({ ...snap.data(), id: t.playerId } as Player) : undefined;
          return { termini: t, player };
        }),
      ),
    );
    const mancante = giocatoriCorrenti.find((g) => !g.player);
    if (mancante) {
      return { risultati: [], errore: `Un giocatore della trattativa non è più in nessuna rosa (id ${mancante.termini.playerId}).` };
    }

    // La QF è sempre quella attuale live per default (vedi
    // aGiocatoreAvanzatoSingolo); qui si sovrascrive SOLO se la simulazione
    // ha esplicitamente provato un'ipotesi diversa per questo giocatore —
    // si legge da `overrides` (grezzo, prima del merge in `t`) apposta, per
    // distinguere "ipotesi voluta" da "valore congelato alla creazione, mai
    // toccato" che altrimenti avrebbero lo stesso campo `quotazioneFinale`.
    const conQfSimulata = (g: GiocatoreAvanzato, playerId: string): GiocatoreAvanzato => {
      const qfSimulata = overrides[playerId]?.quotazioneFinale;
      return qfSimulata !== undefined ? { ...g, quotazioneFinale: qfSimulata } : g;
    };
    const giocatoriA = giocatoriCorrenti
      .filter((g) => terminiA.some((x) => x.playerId === g.termini.playerId))
      .map((g) => conQfSimulata(this.aGiocatoreAvanzatoSingolo(g.player!, g.termini), g.termini.playerId));
    const giocatoriB = giocatoriCorrenti
      .filter((g) => terminiB.some((x) => x.playerId === g.termini.playerId))
      .map((g) => conQfSimulata(this.aGiocatoreAvanzatoSingolo(g.player!, g.termini), g.termini.playerId));

    const risultato = calcolaScambioAvanzatoConTetto(
      giocatoriA,
      giocatoriB,
      avanzato.conguaglioA || 0,
      avanzato.conguaglioB || 0,
      false, // la simulazione post-conferma ragiona sempre sui dati realizzati finora
    );
    return { risultati: risultato.risultati, errore: risultato.errore };
  }

  /**
   * Converte un singolo giocatore + i suoi termini nel formato richiesto dal
   * calcolatore avanzato, per un RICALCOLO POST-CONFERMA (evento bonus,
   * modifica termini, simulazione). A differenza del calcolo iniziale:
   * - la quotazione INIZIALE (QI) è quella congelata alla prima conferma
   *   (`quotazioneInizialeConfermata`), non quella attuale live — che nel
   *   frattempo può essere cambiata; ripiega sulla live SOLO per le
   *   trattative confermate prima dell'introduzione di questo campo.
   * - la quotazione FINALE (QF) è sempre quella attuale live in questo
   *   preciso momento: è la miglior stima disponibile di "finale" per un
   *   ricalcolo che avviene DAVVERO oggi (niente più stima congelata alla
   *   creazione). Chi chiama può sovrascriverla per una simulazione — vedi
   *   simulaRicalcoloAvanzato.
   */
  private aGiocatoreAvanzatoSingolo(p: Player, t: TerminiGiocatoreAvanzato): GiocatoreAvanzato {
    return {
      id: p.id,
      name: p.name,
      ruolo: p.ruolo,
      valoreAttuale: p.valoreAttuale,
      quotazioneAttuale: t.quotazioneInizialeConfermata ?? p.quotazioneAttuale,
      quotazioneFinale: p.quotazioneAttuale,
      tipoContratto: t.tipoContratto,
      durataPrestito: t.durataPrestito,
      riscattato: t.riscattato,
      cifraRiscatto: t.cifraRiscatto,
      bonus: t.bonus,
    };
  }

  /** Valore attuale totale della rosa di una squadra (per la tassa progressiva del fairplay) */
  private async valoreRosaAttuale(teamId: string): Promise<number> {
    const roster = await this.leggiRoster(teamId);
    return round2(roster.reduce((s, p) => s + (p.valoreAttuale || 0), 0));
  }
}

/** Contesto interno dell'operazione di conferma */
interface ContestoConferma {
  teamIdA: string;
  teamIdB: string;
  rosterA: Player[];
  rosterB: Player[];
  selezionatiA: Player[];
  selezionatiB: Player[];
  conguaglio: number;
  rivalutazioni: import('../scambi-calculator').PlayerRivalutazione[];
}
