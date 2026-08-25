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
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { round2 } from '../finance-calculator';
import {
  AuditEntityType,
  Player,
  Scambio,
  ScambioSide,
  ScambioSnapshot,
} from '../models';
import { FinanceService } from './finance.service';
import {
  LatoScambio,
  calcolaAnteprima,
  patchGiocatore,
} from '../scambi-calculator';
import { AuditService } from './audit.service';

/** Input per salvare una bozza di trattativa */
export interface NuovoScambioInput {
  squadraA: ScambioSide;
  squadraB: ScambioSide;
  conguaglio: number;
  conguaglioPagante: 'A' | 'B' | null;
  snapshot: ScambioSnapshot;
}

/** Millisecondi di un Timestamp Firestore (0 se assente/scrittura pending) */
function timestampMillis(ts: { toMillis: () => number } | null | undefined): number {
  return ts ? ts.toMillis() : 0;
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

  /** Tutte le trattative, dalla più recente */
  readonly scambi$: Observable<Scambio[]> = collectionData(
    this.scambiCollection(),
    { idField: 'id' },
  ).pipe(
    map((list) =>
      (list as Scambio[])
        .slice()
        .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)),
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

  /** Salva una nuova bozza di trattativa */
  async saveBozza(input: NuovoScambioInput): Promise<string> {
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

  /** Elimina una trattativa (solo bozze non ancora confermate) */
  async elimina(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'bozza') {
      throw new Error('Una trattativa confermata non può essere eliminata.');
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
   * CONFERMA dell'admin: esegue lo scambio come operazione atomica.
   *
   * Rilegge TUTTI i dati freschi da Firestore (rose, finanze), ricalcola
   * l'anteprima sui dati correnti e scrive in un unico write batch:
   * spostamenti/rivalutazioni giocatori + finanze del conguaglio +
   * passaggio della trattativa a stato "confermata".
   */
  async conferma(scambio: Scambio): Promise<void> {
    if (scambio.stato !== 'bozza') {
      throw new Error('Trattativa già confermata.');
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

  /** Scrittura atomica: giocatori + finanze + stato trattativa */
  private async scriviBatch(
    scambio: Scambio,
    movimenti: { player: Player; fromTeamId: string; toTeamId: string }[],
    financeUpdates: {
      teamId: string;
      campo: 'trasferimentiUscita' | 'trasferimentiEntrata';
      data: Record<string, unknown>;
    }[],
    rivalutazioni: import('../scambi-calculator').PlayerRivalutazione[],
    teamIdA: string,
    teamIdB: string,
  ): Promise<void> {
    const rivalutazioniById = new Map(
      rivalutazioni.map((r) => [r.player.id, r] as const),
    );
    const batch = writeBatch(this.firestore);

    for (const m of movimenti) {
      const { id: _id, ...playerData } = m.player;
      const patch = patchGiocatore(m.player, rivalutazioniById.get(m.player.id));
      batch.set(doc(this.firestore, this.playerPath(m.toTeamId, m.player.id)), {
        ...playerData,
        ...patch,
        updatedAt: serverTimestamp(),
      });
      batch.delete(doc(this.firestore, this.playerPath(m.fromTeamId, m.player.id)));
    }

    for (const f of financeUpdates) {
      batch.set(
        doc(this.firestore, this.financePath(f.teamId)),
        {
          ...f.data,
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.currentUser?.uid ?? 'unknown',
        },
        { merge: true },
      );
    }

    batch.update(this.scambioRef(scambio.id), {
      stato: 'confermata',
      confirmedAt: serverTimestamp(),
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
