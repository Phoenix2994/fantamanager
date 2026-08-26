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
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
 calcolaProssimaSpesaRinnovo,
 calcolaValoreAttuale,
 prossimaPercentRinnovo,
} from '../finance-calculator';
import {
  LoanContractType,
  LoanedPlayer,
  Player,
  PlayerInput,
  SeasonFinance,
  Svincolato,
  Team,
} from '../models';
import { AuditService } from './audit.service';
import { FinanceService, ReimborsoParams, RiepilogoReimborso } from './finance.service';
import { UndoService } from './undo.service';

/**
 * Accesso realtime ai dati di squadre, giocatori e prestiti.
 * I campi derivati (valoreAttuale, prossimaSpesaRinnovo) vengono calcolati
 * qui prima della scrittura: così l'UI è corretta anche prima che le Cloud
 * Functions di ricalcolo siano deployate.
 *
 * Isolamento per stagione: rose e prestiti vivono sotto
 * teams/{teamId}/seasons/{season}/ — i dati di una nuova stagione non
 * sovrascriveranno mai quelli della stagione precedente.
 *
 * Ogni mutazione registra una voce nello storico operazioni (auditLog).
 */
@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);
  private readonly finance = inject(FinanceService);
  private readonly undo = inject(UndoService);
  /** Necessario per chiamare le API Firebase fuori dal contesto di injection */
  private readonly injector = inject(Injector);

  /** Tutte le squadre della lega (10) */
  readonly teams$: Observable<Team[]> = collectionData(
    collection(this.firestore, 'teams'),
    { idField: 'id' },
  ) as Observable<Team[]>;

  /** Percorso base della stagione corrente di una squadra */
  private seasonPath(teamId: string): string {
    return `teams/${teamId}/seasons/${environment.season}`;
  }

  /** Giocatori della rosa di una squadra (stagione corrente) */
  players$(teamId: string): Observable<Player[]> {
    // Le query dinamiche vanno eseguite dentro un injection context:
    // AngularFire usa inject() internamente e fuori contesto destabilizza
    // il change detection (errori mat-form-field a ripetizione).
    return runInInjectionContext(
      this.injector,
      () =>
        collectionData(
          collection(this.firestore, `${this.seasonPath(teamId)}/players`),
          { idField: 'id' },
        ) as Observable<Player[]>,
    );
  }

  /** Giocatori svincolati (listone fantacalcio.it non in rosa) */
  readonly svincolati$: Observable<Svincolato[]> = collectionData(
    collection(this.firestore, `league/${environment.leagueId}/svincolati`),
    { idField: 'id' },
  ) as Observable<Svincolato[]>;

  /** Giocatori ceduti in prestito da una squadra (stagione corrente) */
  loanedPlayers$(teamId: string): Observable<LoanedPlayer[]> {
    return runInInjectionContext(
      this.injector,
      () =>
        collectionData(
          collection(this.firestore, `${this.seasonPath(teamId)}/loanedPlayers`),
          { idField: 'id' },
        ) as Observable<LoanedPlayer[]>,
    );
  }

  /** Crea un nuovo giocatore nella rosa della stagione corrente */
  async addPlayer(teamId: string, input: PlayerInput): Promise<string> {
    const valoreAttuale = calcolaValoreAttuale(
      input.valoreIniziale,
      input.quotazioneIniziale,
      input.quotazioneAttuale,
    );
    const ref = await addDoc(
      collection(this.firestore, `${this.seasonPath(teamId)}/players`),
      {
        ...input,
        valoreAttuale,
        prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(
          valoreAttuale,
          input.prossimaPercRinnovo,
        ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: ref.id,
      operation: 'create',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: { ...input, valoreAttuale },
      changeSummary: `Creazione giocatore ${input.name}`,
    });

    return ref.id;
  }

  /**
   * Aggiorna un giocatore. Se cambiano quotazioni o valore iniziale,
   * ricalcola valoreAttuale e prossimaSpesaRinnovo.
   */
  async updatePlayer(teamId: string, playerId: string, input: PlayerInput): Promise<void> {
    const valoreAttuale = calcolaValoreAttuale(
      input.valoreIniziale,
      input.quotazioneIniziale,
      input.quotazioneAttuale,
    );

    // Legge lo stato precedente per l'audit log
    const snap = await getDoc(this.playerRef(teamId, playerId));
    const before = snap.data() as Partial<Player> | undefined;
    const valueBefore = before
      ? {
          name: before.name,
          ruolo: before.ruolo,
          contractType: before.contractType,
          acquistoRinnovoSpesa: before.acquistoRinnovoSpesa,
          prossimaPercRinnovo: before.prossimaPercRinnovo,
          quotazioneIniziale: before.quotazioneIniziale,
          quotazioneAttuale: before.quotazioneAttuale,
          valoreIniziale: before.valoreIniziale,
        }
      : null;

    await updateDoc(this.playerRef(teamId, playerId), {
      ...input,
      valoreAttuale,
      prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(
        valoreAttuale,
        input.prossimaPercRinnovo,
      ),
      updatedAt: serverTimestamp(),
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'update',
      fieldModified: '*',
      valueBefore,
      valueAfter: { ...input, valoreAttuale },
      changeSummary: `Modifica giocatore ${input.name}`,
    });
  }

  /**
   * Rinnova un giocatore — ATOMICO e ANNULLABILE (undoLog):
   * 1. acquistoRinnovoSpesa ← prossimaSpesaRinnovo corrente
   * 2. se la % di rinnovo corrente supera il 100%: valoreIniziale ← spesa
   *    del rinnovo e quotazioneIniziale ← quotazioneAttuale (il valore si
   *    "blocca" sulla spesa appena sostenuta)
   * 3. prossimaPercRinnovo ← mappatura della nuova percentuale
   * 4. ricalcola valoreAttuale e prossimaSpesaRinnovo
   * 5. somma ai Rinnovi (finanze) la spesa corrispondente
   *
   * Giocatore e finanze si scrivono in un UNICO batch (mai l'uno senza
   * l'altro), insieme a uno snapshot "prima" nell'undoLog: rilegge
   * entrambi i documenti freschi da Firestore invece di fidarsi
   * dell'oggetto passato dalla UI, per evitare letture stantie.
   */
  async eseguiRinnovo(
    teamId: string,
    playerId: string,
    nuovaPercRinnovo: number,
    valoreRosa: number,
  ): Promise<number> {
    const playerRef = this.playerRef(teamId, playerId);
    const financeRef = this.finance.financeDocRef(teamId);

    const [playerSnap, financeSnap] = await Promise.all([getDoc(playerRef), getDoc(financeRef)]);
    const playerBefore = playerSnap.data() as Player | undefined;
    if (!playerBefore) {
      throw new Error('Il giocatore non è più in rosa.');
    }
    const financeBefore = financeSnap.data() as SeasonFinance | undefined;

    // Il valore si blocca solo se la percentuale CORRENTE supera il 100%
    const bloccaValore = (playerBefore.prossimaPercRinnovo || 0) > 1;
    const nuovoValoreIniziale = bloccaValore
      ? playerBefore.prossimaSpesaRinnovo
      : playerBefore.valoreIniziale;
    const nuovaQuotazioneIniziale = bloccaValore
      ? playerBefore.quotazioneAttuale
      : playerBefore.quotazioneIniziale;

    const percProssimoAnno = prossimaPercentRinnovo(nuovaPercRinnovo);
    const nuovoValoreAttuale = calcolaValoreAttuale(
      nuovoValoreIniziale,
      nuovaQuotazioneIniziale,
      playerBefore.quotazioneAttuale,
    );
    const nuovaSpesaRinnovo = calcolaProssimaSpesaRinnovo(nuovoValoreAttuale, percProssimoAnno);

    const { data: financeData, rinnovo } = this.finance.preparaRinnovo(
      financeBefore,
      { valoreAttuale: playerBefore.valoreAttuale },
      nuovaPercRinnovo,
      valoreRosa,
    );

    const batch = writeBatch(this.firestore);
    batch.update(playerRef, {
      acquistoRinnovoSpesa: playerBefore.prossimaSpesaRinnovo,
      valoreIniziale: nuovoValoreIniziale,
      quotazioneIniziale: nuovaQuotazioneIniziale,
      valoreAttuale: nuovoValoreAttuale,
      prossimaPercRinnovo: percProssimoAnno,
      prossimaSpesaRinnovo: nuovaSpesaRinnovo,
      updatedAt: serverTimestamp(),
    });
    batch.set(financeRef, { ...financeData, ...this.finance.metaScrittura() }, { merge: true });

    this.undo.registra(batch, {
      tipo: 'rinnovo',
      leagueId: environment.leagueId,
      teamIds: [teamId],
      descrizione: `Rinnovo ${playerBefore.name}: +${rinnovo} € ai rinnovi`,
      docs: [
        { path: playerRef.path, before: playerBefore as unknown as Record<string, unknown> },
        {
          path: financeRef.path,
          before: (financeBefore as unknown as Record<string, unknown>) ?? null,
        },
      ],
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'update',
      fieldModified: bloccaValore
        ? 'prossimaPercRinnovo, valoreIniziale, quotazioneIniziale'
        : 'prossimaPercRinnovo',
      valueBefore: {
        prossimaPercRinnovo: playerBefore.prossimaPercRinnovo,
        valoreIniziale: playerBefore.valoreIniziale,
        quotazioneIniziale: playerBefore.quotazioneIniziale,
      },
      valueAfter: {
        prossimaPercRinnovo: percProssimoAnno,
        valoreIniziale: nuovoValoreIniziale,
        quotazioneIniziale: nuovaQuotazioneIniziale,
      },
      changeSummary:
        `Rinnovo ${playerBefore.name}: spesa ${playerBefore.prossimaSpesaRinnovo} € → soldi spesi` +
        (bloccaValore ? ' (valore bloccato, % > 100%)' : ''),
    });
    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: 'rinnovi',
      valueBefore: { rinnovi: financeBefore?.rinnovi ?? 0 },
      valueAfter: { rinnovi: financeData.rinnovi, rinnovo, perc: nuovaPercRinnovo },
      changeSummary: `Rinnovo ${playerBefore.name}: +${rinnovo} € ai rinnovi`,
    });

    return rinnovo;
  }

  /**
   * Rimborso/rescissione completa di un giocatore — ATOMICO e ANNULLABILE:
   * 1. elimina il giocatore dalla rosa
   * 2. somma alle spese: rimborso (% × speso) ai Rimborsi, indennizzo
   *    (% × V.A.) agli Indennizzi sett/gen a scelta
   * Giocatore (cancellato) e finanze si scrivono in un UNICO batch.
   */
  async eseguiRimborso(
    teamId: string,
    playerId: string,
    params: ReimborsoParams,
    valoreRosaAggiornato: number,
  ): Promise<RiepilogoReimborso> {
    const playerRef = this.playerRef(teamId, playerId);
    const financeRef = this.finance.financeDocRef(teamId);

    const [playerSnap, financeSnap] = await Promise.all([getDoc(playerRef), getDoc(financeRef)]);
    const playerBefore = playerSnap.data() as Player | undefined;
    if (!playerBefore) {
      throw new Error('Il giocatore non è più in rosa.');
    }
    const financeBefore = financeSnap.data() as SeasonFinance | undefined;

    const {
      data: financeData,
      rimborso,
      indennizzo,
    } = this.finance.preparaReimborso(financeBefore, playerBefore, params, valoreRosaAggiornato);

    const batch = writeBatch(this.firestore);
    batch.delete(playerRef);
    batch.set(financeRef, { ...financeData, ...this.finance.metaScrittura() }, { merge: true });

    this.undo.registra(batch, {
      tipo: 'rimborso',
      leagueId: environment.leagueId,
      teamIds: [teamId],
      descrizione: `Rimborso ${playerBefore.name}: +${rimborso} € rimborsi, +${indennizzo} € indennizzi ${params.mese}`,
      docs: [
        { path: playerRef.path, before: playerBefore as unknown as Record<string, unknown> },
        {
          path: financeRef.path,
          before: (financeBefore as unknown as Record<string, unknown>) ?? null,
        },
      ],
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'delete',
      fieldModified: '*',
      valueBefore: playerBefore,
      valueAfter: null,
      changeSummary: `Eliminazione giocatore ${playerBefore.name} (rimborso)`,
    });
    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: 'rimborsi, indennizzi',
      valueBefore: {
        rimborsi: financeBefore?.rimborsi ?? 0,
        ...(params.mese === 'settembre'
          ? { indennizzoSettembre: financeBefore?.indennizzoSettembre ?? 0 }
          : { indennizzoGennaio: financeBefore?.indennizzoGennaio ?? 0 }),
      },
      valueAfter: { rimborso, indennizzo, mese: params.mese },
      changeSummary:
        `Rimborso ${playerBefore.name}: +${rimborso} € rimborsi, ` +
        `+${indennizzo} € indennizzi ${params.mese}`,
    });

    return { rimborso, indennizzo };
  }

  /**
   * Elimina un giocatore dalla rosa, con eventuale costo di rescissione
   * fisso — ATOMICO e ANNULLABILE. Se `importoRescissione` è 0, le finanze
   * non vengono toccate (e l'undoLog contiene solo il giocatore).
   */
  async eseguiEliminazione(
    teamId: string,
    playerId: string,
    importoRescissione: number,
    valoreRosaAggiornato: number,
  ): Promise<void> {
    const playerRef = this.playerRef(teamId, playerId);
    const playerSnap = await getDoc(playerRef);
    const playerBefore = playerSnap.data() as Player | undefined;
    if (!playerBefore) {
      throw new Error('Il giocatore non è più in rosa.');
    }

    const batch = writeBatch(this.firestore);
    batch.delete(playerRef);

    const docs: { path: string; before: Record<string, unknown> | null }[] = [
      { path: playerRef.path, before: playerBefore as unknown as Record<string, unknown> },
    ];

    let financeBefore: SeasonFinance | undefined;
    if (importoRescissione > 0) {
      const financeRef = this.finance.financeDocRef(teamId);
      const financeSnap = await getDoc(financeRef);
      financeBefore = financeSnap.data() as SeasonFinance | undefined;
      const { data: financeData } = this.finance.preparaRescissione(
        financeBefore,
        importoRescissione,
        valoreRosaAggiornato,
      );
      batch.set(financeRef, { ...financeData, ...this.finance.metaScrittura() }, { merge: true });
      docs.push({
        path: financeRef.path,
        before: (financeBefore as unknown as Record<string, unknown>) ?? null,
      });
    }

    this.undo.registra(batch, {
      tipo: 'eliminazione',
      leagueId: environment.leagueId,
      teamIds: [teamId],
      descrizione:
        `Eliminazione ${playerBefore.name}` +
        (importoRescissione > 0 ? ` (rescissione ${importoRescissione} €)` : ''),
      docs,
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'delete',
      fieldModified: '*',
      valueBefore: playerBefore,
      valueAfter: null,
      changeSummary: `Eliminazione giocatore ${playerBefore.name}`,
    });
    if (importoRescissione > 0) {
      void this.audit.log({
        leagueId: environment.leagueId,
        teamId,
        adminId: this.auth.currentUser?.uid ?? 'unknown',
        entityType: 'seasonFinance',
        entityId: `${teamId}/${environment.season}`,
        operation: 'update',
        fieldModified: 'rescissioni',
        valueBefore: { rescissioni: financeBefore?.rescissioni ?? 0 },
        valueAfter: { importo: importoRescissione },
        changeSummary: `Rescissione: +${importoRescissione} € alle rescissioni`,
      });
    }
  }

  /** Registra un giocatore ceduto in prestito (stagione corrente) */
  async addLoan(
    teamId: string,
    data: { playerName: string; toTeam: string; contractType: LoanContractType },
  ): Promise<string> {
    const ref = await addDoc(
      collection(this.firestore, `${this.seasonPath(teamId)}/loanedPlayers`),
      { ...data, createdAt: serverTimestamp() },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'playerLoaned',
      entityId: ref.id,
      operation: 'create',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: data,
      changeSummary: `Prestito di ${data.playerName} a ${data.toTeam}`,
    });

    return ref.id;
  }

  /** Elimina una voce di prestito (ritorno dal prestito) */
  async deleteLoan(teamId: string, loanId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `${this.seasonPath(teamId)}/loanedPlayers/${loanId}`));

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'playerLoaned',
      entityId: loanId,
      operation: 'delete',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: null,
      changeSummary: `Rimozione prestito ${loanId}`,
    });
  }

  private playerRef(teamId: string, playerId: string) {
    return doc(this.firestore, `${this.seasonPath(teamId)}/players/${playerId}`);
  }
}