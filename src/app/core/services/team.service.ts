import { Injectable, inject } from '@angular/core';
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
  Svincolato,
  Team,
} from '../models';
import { AuditService } from './audit.service';

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
    return collectionData(
      collection(this.firestore, `${this.seasonPath(teamId)}/players`),
      { idField: 'id' },
    ) as Observable<Player[]>;
  }

  /** Giocatori svincolati (listone fantacalcio.it non in rosa) */
  readonly svincolati$: Observable<Svincolato[]> = collectionData(
    collection(this.firestore, `league/${environment.leagueId}/svincolati`),
    { idField: 'id' },
  ) as Observable<Svincolato[]>;

  /** Giocatori ceduti in prestito da una squadra (stagione corrente) */
  loanedPlayers$(teamId: string): Observable<LoanedPlayer[]> {
    return collectionData(
      collection(this.firestore, `${this.seasonPath(teamId)}/loanedPlayers`),
      { idField: 'id' },
    ) as Observable<LoanedPlayer[]>;
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
 * Rinnova un giocatore:
 * 1. acquistoRinnovoSpesa ← prossimaSpesaRinnovo corrente
 * 2. se la % di rinnovo corrente supera il 100%: valoreIniziale ← spesa
 * del rinnovo e quotazioneIniziale ← quotazioneAttuale (il valore si
 * "blocca" sulla spesa appena sostenuta)
 * 3. prossimaPercRinnovo ← mappatura della nuova percentuale
 * (0.85→1.15, 1.1→1.55, 1.45→2.15, 2.0→2.9; altri valori invariati)
 * 4. ricalcola valoreAttuale e prossimaSpesaRinnovo
 */
 async renewPlayer(teamId: string, player: Player, nuovaPercRinnovo: number): Promise<void> {
 // Il valore si blocca solo se la percentuale CORRENTE supera il 100%
 const bloccaValore = (player.prossimaPercRinnovo || 0) > 1;
 const nuovoValoreIniziale = bloccaValore ? player.prossimaSpesaRinnovo : player.valoreIniziale;
 const nuovaQuotazioneIniziale = bloccaValore
 ? player.quotazioneAttuale
 : player.quotazioneIniziale;

 // Prossima percentuale: mappatura fissa, altri casi invariati
 const percProssimoAnno = prossimaPercentRinnovo(nuovaPercRinnovo);

 const nuovoValoreAttuale = calcolaValoreAttuale(
 nuovoValoreIniziale,
 nuovaQuotazioneIniziale,
 player.quotazioneAttuale,
 );
 const nuovaSpesaRinnovo = calcolaProssimaSpesaRinnovo(nuovoValoreAttuale, percProssimoAnno);

 await updateDoc(this.playerRef(teamId, player.id), {
 acquistoRinnovoSpesa: player.prossimaSpesaRinnovo,
 valoreIniziale: nuovoValoreIniziale,
 quotazioneIniziale: nuovaQuotazioneIniziale,
 valoreAttuale: nuovoValoreAttuale,
 prossimaPercRinnovo: percProssimoAnno,
 prossimaSpesaRinnovo: nuovaSpesaRinnovo,
 updatedAt: serverTimestamp(),
 });

 void this.audit.log({
 leagueId: environment.leagueId,
 teamId,
 adminId: this.auth.currentUser?.uid ?? 'unknown',
 entityType: 'player',
 entityId: player.id,
 operation: 'update',
 fieldModified: bloccaValore
 ? 'prossimaPercRinnovo, valoreIniziale, quotazioneIniziale'
 : 'prossimaPercRinnovo',
 valueBefore: {
 prossimaPercRinnovo: player.prossimaPercRinnovo,
 valoreIniziale: player.valoreIniziale,
 quotazioneIniziale: player.quotazioneIniziale,
 },
 valueAfter: {
 prossimaPercRinnovo: percProssimoAnno,
 valoreIniziale: nuovoValoreIniziale,
 quotazioneIniziale: nuovaQuotazioneIniziale,
 },
 changeSummary:
 `Rinnovo ${player.name}: spesa ${player.prossimaSpesaRinnovo} € → soldi spesi` +
 (bloccaValore ? ' (valore bloccato, % > 100%)' : ''),
 });
 }

  /** Elimina un giocatore dalla rosa */
  async deletePlayer(teamId: string, playerId: string): Promise<void> {
    await deleteDoc(this.playerRef(teamId, playerId));

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: playerId,
      operation: 'delete',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: null,
      changeSummary: `Eliminazione giocatore ${playerId}`,
    });
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