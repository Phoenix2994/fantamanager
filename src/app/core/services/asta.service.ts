import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  docData,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AstaStato, PlayerInput, SeasonFinance, Svincolato } from '../models';
import { calcolaValoreAttuale, calcolaProssimaSpesaRinnovo, round2 } from '../finance-calculator';
import { slugify } from '../text-utils';
import { AuditService } from './audit.service';
import { FinanceService } from './finance.service';
import { UndoService } from './undo.service';

/** Provenienza della spesa per l'assegnazione del giocatore all'asta */
export type ProvenienzaAsta = 'acquistiAstaSettembre' | 'acquistiMercatoInfrasettimanale';

/**
 * Incremento minimo di rilancio in base al prezzo corrente:
 * sopra 20 € minimo 0,2 · sopra 50 € minimo 0,5 · sopra 100 € minimo 1 €.
 */
export function minIncremento(prezzo: number): number {
  if (prezzo > 100) {
    return 1;
  }
  if (prezzo > 50) {
    return 0.5;
  }
  if (prezzo > 20) {
    return 0.2;
  }
  return 0.1;
}

/** Numero massimo di giocatori per squadra */
export const MAX_GIOCATORI = 28;

/**
 * Gestione dell'asta live.
 *
 * Un unico documento `asta/statoCorrente` condiviso in realtime:
 * - apertura/chiusura/assegnazione: solo admin (autenticati)
 * - rilancio: transaction atomica — il prezzo può solo salire e non si
 *   può rilanciare due volte di fila con la stessa squadra
 *
 * Nota: con Anonymous Auth l'identità della squadra è vincolata lato
 * client (scelta obbligatoria + localStorage), sufficiente per una lega
 * tra amici fidati. La regola "prezzo crescente" è invece garantita
 * dalla transaction anche in caso di race condition.
 */
@Injectable({ providedIn: 'root' })
export class AstaService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);
  private readonly financeService = inject(FinanceService);
  private readonly undo = inject(UndoService);

  private readonly statoRef = doc(this.firestore, 'asta/statoCorrente');

  /** Stato corrente dell'asta in realtime */
  readonly stato$: Observable<AstaStato | undefined> = docData(
    this.statoRef,
  ) as Observable<AstaStato | undefined>;

  /**
   * Apre l'asta su un giocatore svincolato.
   * Il prezzo di partenza è la sua quotazione mantra attuale.
   * Segna anche il giocatore come "chiamato" (stesso batch, atomico): serve
   * solo a escluderlo dai pick di "Apri asta random" finché non c'è un
   * reset esplicito — non ha altro effetto (resta comunque richiamabile a
   * mano dall'admin in qualunque momento).
   */
  async apriAsta(giocatore: Svincolato): Promise<void> {
    const svincolatoRef = doc(
      this.firestore,
      `league/${environment.leagueId}/svincolati/${giocatore.id}`,
    );

    const batch = writeBatch(this.firestore);
    batch.set(this.statoRef, {
      aperta: true,
      giocatoreNome: giocatore.name,
      ruolo: giocatore.ruolo,
      squadra: giocatore.squadra,
      quotazione: giocatore.quotazioneAttuale,
      // L'asta parte sempre da 0 €
      prezzoAttuale: 0,
      rilanciatoDaTeamId: '',
      rilanciatoDaTeamName: '',
      timestampUltimoRilancio: serverTimestamp(),
    });
    batch.set(
      svincolatoRef,
      { chiamato: true, chiamatoAt: serverTimestamp() },
      { merge: true },
    );
    await batch.commit();

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: '',
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: giocatore.id,
      operation: 'update',
      fieldModified: 'asta',
      valueBefore: null,
      valueAfter: { giocatore: giocatore.name, prezzoPartenza: 0 },
      changeSummary: `Apertura asta: ${giocatore.name} (partenza da 0 €)`,
    });
  }

  /**
   * Rilancia di `incremento` € per la squadra indicata.
   * Transaction atomica con regole:
   * - asta aperta
   * - la squadra non è già l'ultima rilanciante
   * - incremento >= minimo in base al prezzo corrente
   * - la squadra non ha raggiunto i 28 giocatori
   */
  async rilancia(
    teamId: string,
    teamName: string,
    incremento: number,
    giocatoriSquadra: number,
  ): Promise<void> {
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(this.statoRef);
      const stato = snap.data() as AstaStato | undefined;
      if (!stato || !stato.aperta) {
        throw new Error('L\u2019asta non \u00e8 aperta');
      }
      if (stato.rilanciatoDaTeamId === teamId) {
        throw new Error('La tua squadra \u00e8 gi\u00e0 l\u2019ultima rilanciante');
      }
      if (giocatoriSquadra >= MAX_GIOCATORI) {
        throw new Error(`Hai gi\u00e0 ${MAX_GIOCATORI} giocatori: non puoi rilanciare`);
      }
      const minimo = minIncremento(stato.prezzoAttuale);
      if (incremento + 1e-9 < minimo) {
        throw new Error(`Rilancio minimo ${minimo.toFixed(2)} \u20ac`);
      }
      tx.update(this.statoRef, {
        prezzoAttuale: round2(stato.prezzoAttuale + incremento),
        rilanciatoDaTeamId: teamId,
        rilanciatoDaTeamName: teamName,
        timestampUltimoRilancio: serverTimestamp(),
      });
    });
  }

  /** Chiude l'asta senza assegnare il giocatore (nessuno lo vuole) */
  async chiudiAsta(): Promise<void> {
    await updateDoc(this.statoRef, { aperta: false });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: '',
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: 'asta',
      operation: 'update',
      fieldModified: 'asta',
      valueBefore: null,
      valueAfter: null,
      changeSummary: 'Chiusura asta senza assegnazione',
    });
  }

  /**
   * Reset in blocco: rende di nuovo richiamabili dal random TUTTI i
   * giocatori attualmente segnati come "chiamato". Un solo batch (i
   * documenti coinvolti restano ben sotto il limite di 500 scritture di
   * Firestore, anche con l'intero listone svincolati).
   */
  async resetTutteLeChiamate(): Promise<void> {
    const snap = await getDocs(
      collection(this.firestore, `league/${environment.leagueId}/svincolati`),
    );
    const daResettare = snap.docs.filter((d) => d.data()['chiamato'] === true);
    if (daResettare.length === 0) {
      return;
    }
    const batch = writeBatch(this.firestore);
    for (const d of daResettare) {
      batch.update(d.ref, { chiamato: false, chiamatoAt: null });
    }
    await batch.commit();
  }

  /**
   * Assegna il giocatore alla squadra vincitrice al prezzo corrente —
   * ATOMICO e ANNULLABILE (undoLog):
   * 1. crea il giocatore nella rosa (TITOLO DEFINITIVO)
   * 2. somma la spesa alla voce scelta (asta settembre / infrasettimanale)
   * 3. rimuove il giocatore dagli svincolati
   * 4. chiude l'asta
   *
   * Le quattro scritture avvengono in un unico batch: o l'assegnazione
   * riesce per intero, o non cambia nulla.
   *
   * Nota sull'undo: lo snapshot NON include lo stato dell'asta (punto 4) —
   * annullare un acquisto riguarda solo giocatore/finanze/svincolato;
   * riaprire l'asta al momento dell'annullamento potrebbe entrare in
   * conflitto con un'asta successiva già in corso.
   */
  async assegna(
    teamId: string,
    teamName: string,
    provenienza: ProvenienzaAsta,
    prezzo?: number,
  ): Promise<void> {
    const stato = await this.getStato();
    if (!stato || !stato.aperta) {
      throw new Error('L\u2019asta non \u00e8 aperta');
    }

    // Usa il prezzo specificato o quello corrente dell'asta
    const prezzoDaUsare = prezzo ?? stato.prezzoAttuale;

    // Valore rosa PRIMA dell'acquisto (serve per il ricalcolo finanze)
    const playersSnap = await getDocs(
      collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
    );
    const valoreRosaAttuale =
      Math.round(
        playersSnap.docs.reduce((sum, d) => sum + ((d.data()['valoreAttuale'] as number) || 0), 0) *
          100,
      ) / 100;

    const valoreAttualeNuovo = calcolaValoreAttuale(prezzoDaUsare, stato.quotazione, stato.quotazione);
    const nuovaRosa = round2(valoreRosaAttuale + valoreAttualeNuovo);

    const svincolatoRef = doc(
      this.firestore,
      `league/${environment.leagueId}/svincolati/${slugify(stato.giocatoreNome)}`,
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
      provenienza,
      prezzoDaUsare,
      nuovaRosa,
    );

    // Crea il giocatore nella rosa del team vincitore (ID auto-generato)
    const playerRef = doc(
      collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
    );
    const input: PlayerInput = {
      name: stato.giocatoreNome,
      ruolo: stato.ruolo,
      contractType: 'TITOLO DEFINITIVO',
      acquistoRinnovoSpesa: prezzoDaUsare,
      // Il primo rinnovo sarà all'85% del valore attuale
      prossimaPercRinnovo: 0.85,
      // Q.I. = Q.A. = quotazione al momento dell'acquisto
      quotazioneIniziale: stato.quotazione,
      quotazioneAttuale: stato.quotazione,
      valoreIniziale: prezzoDaUsare,
    };

    const batch = writeBatch(this.firestore);
    batch.set(playerRef, {
      ...input,
      valoreAttuale: valoreAttualeNuovo,
      prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(
        valoreAttualeNuovo,
        input.prossimaPercRinnovo,
      ),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      financeRef,
      { ...financeData, ...this.financeService.metaScrittura() },
      { merge: true },
    );
    batch.delete(svincolatoRef);
    batch.update(this.statoRef, { aperta: false });

    this.undo.registra(batch, {
      tipo: 'acquistoAsta',
      leagueId: environment.leagueId,
      teamIds: [teamId],
      descrizione: `Acquisto asta: ${stato.giocatoreNome} a ${teamName} per ${prezzoDaUsare} €`,
      docs: [
        { path: playerRef.path, before: null },
        {
          path: financeRef.path,
          before: (financeBefore as unknown as Record<string, unknown>) ?? null,
        },
        { path: svincolatoRef.path, before: svincolatoBefore ?? null },
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
      fieldModified: 'asta',
      valueBefore: null,
      valueAfter: { prezzo: prezzoDaUsare, provenienza },
      changeSummary:
        `Assegnazione asta: ${stato.giocatoreNome} a ${teamName} ` +
        `per ${prezzoDaUsare} €`,
    });
  }

  private async getStato(): Promise<AstaStato | undefined> {
    const snap = await getDoc(this.statoRef);
    return snap.data() as AstaStato | undefined;
  }
}
