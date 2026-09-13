import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  docData,
  collectionData,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, combineLatest, firstValueFrom, timer } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  AstaInfrasettimanale,
  BustaInfrasettimanale,
  PlayerInput,
  SeasonFinance,
  Svincolato,
} from '../models';
import {
  calcolaFaseInfrasettimanale,
  calcolaInfoFaseInfrasettimanale,
  FaseInfrasettimanale,
  InfoFaseInfrasettimanale,
} from '../asta-infrasettimanale-calculator';
import {
  calcolaProssimaSpesaRinnovo,
  calcolaValoreAttuale,
  round1,
  round2,
} from '../finance-calculator';
import { slugify } from '../text-utils';
import { MAX_GIOCATORI, minIncremento } from './asta.service';
import { AuditService } from './audit.service';
import { FinanceService } from './finance.service';
import { LeagueService } from './league.service';
import { UndoService } from './undo.service';

export type { FaseInfrasettimanale, InfoFaseInfrasettimanale };

/**
 * Gestione delle aste infrasettimanali: a differenza dell'asta di settembre
 * (un unico documento asta/statoCorrente), qui ogni giocatore chiamato è un
 * documento indipendente in asteInfrasettimanali/{id} — più aste sono aperte
 * in contemporanea. Vedi la memoria di progetto "asta-infrasettimanale-piano"
 * per la meccanica completa a 4 fasi (chiamata → solo rilanci → buste →
 * assegnazione admin).
 *
 * Come deciso esplicitamente: nessuna validazione delle finestre orarie nelle
 * Firestore rules, solo controlli lato client (compreso il tetto di 28
 * giocatori, con un rischio di race condition accettato consapevolmente).
 */
@Injectable({ providedIn: 'root' })
export class AstaInfrasettimanaleService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);
  private readonly leagueService = inject(LeagueService);
  private readonly financeService = inject(FinanceService);
  private readonly undo = inject(UndoService);

  private readonly collectionRef = collection(this.firestore, 'asteInfrasettimanali');

  /** Tutte le aste ancora aperte, in realtime */
  readonly aperte$: Observable<AstaInfrasettimanale[]> = collectionData(
    query(this.collectionRef, where('chiusa', '==', false)),
    { idField: 'id' },
  ) as Observable<AstaInfrasettimanale[]>;

  /**
   * Fase corrente del ciclo, ricalcolata ogni 30 secondi oltre che ad ogni
   * cambio di configurazione — così una pagina rimasta aperta a cavallo di
   * un confine (es. le 17:00) si aggiorna da sola senza bisogno di ricaricare.
   */
  readonly fase$: Observable<FaseInfrasettimanale> = combineLatest([
    this.leagueService.astaInfrasettimanaleConfig$,
    timer(0, 30_000),
  ]).pipe(map(([config]) => calcolaFaseInfrasettimanale(config, new Date())));

  /** Come fase$, ma con anche l'orario di fine fase e quale fase segue (per mostrarli in UI) */
  readonly infoFase$: Observable<InfoFaseInfrasettimanale> = combineLatest([
    this.leagueService.astaInfrasettimanaleConfig$,
    timer(0, 30_000),
  ]).pipe(map(([config]) => calcolaInfoFaseInfrasettimanale(config, new Date())));

  /**
   * Chiama uno svincolato a 0,10 €: il chiamante diventa da subito
   * l'attuale rilanciante (come in un'asta dal vivo, il prezzo di partenza
   * è la propria prima proposta), così un'asta senza alcun rilancio
   * successivo ha comunque un vincitore di default.
   *
   * `giocatoriInRosa` è calcolato dal chiamante (stesso pattern di
   * TeamService: il servizio non rilegge la rosa da solo) — il tetto di 28
   * conta anche i giocatori che questa squadra sta già per aggiudicarsi in
   * altre aste infrasettimanali aperte in questo momento.
   */
  async chiama(
    svincolato: Svincolato,
    teamId: string,
    teamName: string,
    giocatoriInRosa: number,
  ): Promise<void> {
    const attiveSnap = await getDocs(query(this.collectionRef, where('chiusa', '==', false)));

    const giaInAsta = attiveSnap.docs.some((d) => d.data()['giocatoreNome'] === svincolato.name);
    if (giaInAsta) {
      throw new Error(`${svincolato.name} è già in asta.`);
    }

    const inTestaAltrove = attiveSnap.docs.filter(
      (d) => d.data()['rilanciatoDaTeamId'] === teamId,
    ).length;
    if (giocatoriInRosa + inTestaAltrove >= MAX_GIOCATORI) {
      throw new Error(
        `Hai già ${MAX_GIOCATORI} giocatori contando le aste in corso: non puoi chiamare altri giocatori.`,
      );
    }

    const astaRef = doc(this.collectionRef);
    await setDoc(astaRef, {
      giocatoreNome: svincolato.name,
      ruolo: svincolato.ruolo,
      squadra: svincolato.squadra,
      quotazione: svincolato.quotazioneAttuale,
      prezzoAttuale: 0.1,
      rilanciatoDaTeamId: teamId,
      rilanciatoDaTeamName: teamName,
      timestampUltimoRilancio: serverTimestamp(),
      chiamataDaTeamId: teamId,
      chiamataDaTeamName: teamName,
      timestampChiamata: serverTimestamp(),
      squadreEleggibiliBusta: [],
      chiusa: false,
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: astaRef.id,
      operation: 'create',
      fieldModified: 'astaInfrasettimanale',
      valueBefore: null,
      valueAfter: { giocatore: svincolato.name, prezzoPartenza: 0.1 },
      changeSummary: `Chiamata infrasettimanale: ${svincolato.name} (${teamName}, partenza 0,10 €)`,
    });
  }

  /**
   * Rilancia su un'asta infrasettimanale aperta — stessa transazione a
   * "prezzo atteso" dell'asta di settembre (vedi AstaService.rilancia): se
   * il prezzo è già cambiato rispetto a quanto visto dal client, il
   * rilancio viene rifiutato invece di sommarsi in silenzio.
   *
   * Se la fase corrente è "soloRilanci", la squadra entra nell'elenco degli
   * eleggibili a presentare una busta su questo giocatore — l'unico momento
   * in cui quell'elenco cresce.
   *
   * Stesso tetto di 28 giocatori di `chiama()` (giocatori in rosa + testa in
   * altre aste aperte): senza questo controllo una squadra già piena poteva
   * comunque continuare a rilanciare (e potenzialmente vincere) su
   * qualunque asta già aperta, aggirando di fatto il limite che le impedisce
   * solo di chiamarne di nuove.
   */
  async rilancia(
    astaId: string,
    teamId: string,
    teamName: string,
    incremento: number,
    prezzoAtteso: number,
    giocatoriInRosa: number,
  ): Promise<void> {
    const attiveSnap = await getDocs(query(this.collectionRef, where('chiusa', '==', false)));
    const inTestaAltrove = attiveSnap.docs.filter(
      (d) => d.id !== astaId && d.data()['rilanciatoDaTeamId'] === teamId,
    ).length;
    if (giocatoriInRosa + inTestaAltrove >= MAX_GIOCATORI) {
      throw new Error(
        `Hai già ${MAX_GIOCATORI} giocatori contando le aste in corso: non puoi rilanciare.`,
      );
    }

    const fase = calcolaFaseInfrasettimanale(
      await firstValueFrom(this.leagueService.astaInfrasettimanaleConfig$),
      new Date(),
    );
    const astaRef = doc(this.firestore, `asteInfrasettimanali/${astaId}`);

    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(astaRef);
      const asta = snap.data() as AstaInfrasettimanale | undefined;
      if (!asta || asta.chiusa) {
        throw new Error('Questa asta non è più aperta.');
      }
      if (Math.abs(asta.prezzoAttuale - prezzoAtteso) > 1e-9) {
        throw new Error(`Prezzo già cambiato a ${asta.prezzoAttuale.toFixed(2)} €: riprova`);
      }
      if (asta.rilanciatoDaTeamId === teamId) {
        throw new Error('La tua squadra è già l’ultima rilanciante.');
      }
      const minimo = minIncremento(asta.prezzoAttuale);
      if (incremento + 1e-9 < minimo) {
        throw new Error(`Rilancio minimo ${minimo.toFixed(2)} €`);
      }

      tx.update(astaRef, {
        prezzoAttuale: round2(asta.prezzoAttuale + incremento),
        rilanciatoDaTeamId: teamId,
        rilanciatoDaTeamName: teamName,
        timestampUltimoRilancio: serverTimestamp(),
        ...(fase === 'soloRilanci' ? { squadreEleggibiliBusta: arrayUnion(teamId) } : {}),
      });
    });
  }

  /** La MIA busta per un'asta (le regole non permettono di leggere quelle altrui prima dell'assegnazione) */
  mieBusta$(astaId: string, teamId: string): Observable<BustaInfrasettimanale | undefined> {
    return docData(doc(this.firestore, `asteInfrasettimanali/${astaId}/buste/${teamId}`)) as Observable<
      BustaInfrasettimanale | undefined
    >;
  }

  /** Inserisce o modifica (stesso documento, sovrascritto) la busta della squadra per un'asta */
  async inserisciBusta(
    astaId: string,
    teamId: string,
    teamName: string,
    importo: number,
  ): Promise<void> {
    await setDoc(doc(this.firestore, `asteInfrasettimanali/${astaId}/buste/${teamId}`), {
      teamId,
      teamName,
      importo,
      timestamp: serverTimestamp(),
    });
  }

  /** Ritira la busta della squadra per un'asta */
  async ritiraBusta(astaId: string, teamId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `asteInfrasettimanali/${astaId}/buste/${teamId}`));
  }

  /**
   * TUTTE le buste di un'asta — solo per l'admin (le regole lasciano
   * leggere l'intera sottocollezione solo se isAdmin() vale per ogni
   * documento, indipendentemente dal suo contenuto). Usata dal pannello di
   * assegnazione, mostrato in UI solo a fase "assegnazione" già iniziata.
   */
  tutteLeBuste$(astaId: string): Observable<BustaInfrasettimanale[]> {
    return collectionData(
      collection(this.firestore, `asteInfrasettimanali/${astaId}/buste`),
    ) as Observable<BustaInfrasettimanale[]>;
  }

  /**
   * Assegna il giocatore alla squadra vincitrice al prezzo indicato —
   * ATOMICO e ANNULLABILE (undoLog), stesso schema di AstaService.assegna
   * per l'asta di settembre, con `acquistiMercatoInfrasettimanale` come
   * voce di spesa (campo già previsto in FinanceDoc). A differenza di
   * settembre, l'asta stessa è inclusa nello snapshot di undo: qui ogni
   * documento è dedicato a un solo giocatore (mai riusato per un'asta
   * successiva), quindi annullare può riportarlo in tutta sicurezza allo
   * stato "aperta" precedente.
   */
  async assegna(astaId: string, teamId: string, teamName: string, prezzo: number): Promise<void> {
    const astaRef = doc(this.firestore, `asteInfrasettimanali/${astaId}`);
    const astaSnap = await getDoc(astaRef);
    const asta = astaSnap.data() as AstaInfrasettimanale | undefined;
    if (!asta || asta.chiusa) {
      throw new Error('Questa asta non è più aperta.');
    }

    const playersSnap = await getDocs(
      collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
    );
    const valoreRosaAttuale =
      Math.round(
        playersSnap.docs.reduce((sum, d) => sum + ((d.data()['valoreAttuale'] as number) || 0), 0) *
          100,
      ) / 100;

    const valoreAttualeNuovo = calcolaValoreAttuale(prezzo, asta.quotazione, asta.quotazione);
    const nuovaRosa = round2(valoreRosaAttuale + valoreAttualeNuovo);

    const svincolatoRef = doc(
      this.firestore,
      `league/${environment.leagueId}/svincolati/${slugify(asta.giocatoreNome)}`,
    );
    const financeRef = this.financeService.financeDocRef(teamId);
    const [financeSnap, svincolatoSnap] = await Promise.all([
      getDoc(financeRef),
      getDoc(svincolatoRef),
    ]);
    const financeBefore = financeSnap.data() as SeasonFinance | undefined;
    const svincolatoBefore = svincolatoSnap.data() as Record<string, unknown> | undefined;

    const { data: financeData } = this.financeService.preparaAcquistoAsta(
      financeBefore,
      'acquistiMercatoInfrasettimanale',
      prezzo,
      nuovaRosa,
    );

    const playerRef = doc(
      collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
    );
    const input: PlayerInput = {
      name: asta.giocatoreNome,
      ruolo: asta.ruolo,
      contractType: 'TITOLO DEFINITIVO',
      acquistoRinnovoSpesa: prezzo,
      prossimaPercRinnovo: 0.85,
      quotazioneIniziale: asta.quotazione,
      quotazioneAttuale: asta.quotazione,
      valoreIniziale: round1(prezzo),
    };

    const batch = writeBatch(this.firestore);
    batch.set(playerRef, {
      ...input,
      valoreAttuale: valoreAttualeNuovo,
      prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(valoreAttualeNuovo, input.prossimaPercRinnovo),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(financeRef, { ...financeData, ...this.financeService.metaScrittura() }, { merge: true });
    batch.delete(svincolatoRef);
    batch.update(astaRef, {
      chiusa: true,
      esito: 'assegnato',
      vincitoreTeamId: teamId,
      vincitoreTeamName: teamName,
      prezzoFinale: prezzo,
    });

    this.undo.registra(batch, {
      tipo: 'acquistoInfrasettimanale',
      leagueId: environment.leagueId,
      teamIds: [teamId],
      descrizione: `Asta infrasettimanale: ${asta.giocatoreNome} a ${teamName} per ${prezzo} €`,
      docs: [
        { path: playerRef.path, before: null },
        { path: financeRef.path, before: (financeBefore as unknown as Record<string, unknown>) ?? null },
        { path: svincolatoRef.path, before: svincolatoBefore ?? null },
        { path: astaRef.path, before: asta as unknown as Record<string, unknown> },
      ],
    });

    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerRef.id,
      operation: 'create',
      fieldModified: 'astaInfrasettimanale',
      valueBefore: null,
      valueAfter: { prezzo, giocatore: asta.giocatoreNome },
      changeSummary: `Assegnazione infrasettimanale: ${asta.giocatoreNome} a ${teamName} per ${prezzo} €`,
    });
  }

  /** Chiude l'asta senza assegnare (nessuno la vuole, o l'admin decide così) */
  async chiudiSenzaAssegnare(astaId: string): Promise<void> {
    const astaRef = doc(this.firestore, `asteInfrasettimanali/${astaId}`);
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(astaRef);
      const asta = snap.data() as AstaInfrasettimanale | undefined;
      if (!asta || asta.chiusa) {
        throw new Error('Questa asta non è più aperta.');
      }
      tx.update(astaRef, { chiusa: true, esito: 'chiuso' });
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: '',
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: astaId,
      operation: 'update',
      fieldModified: 'astaInfrasettimanale',
      valueBefore: null,
      valueAfter: null,
      changeSummary: 'Chiusura asta infrasettimanale senza assegnazione',
    });
  }
}
