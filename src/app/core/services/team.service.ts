import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  calcolaProssimaSpesaRinnovo,
  calcolaValoreAttuale,
} from '../finance-calculator';
import {
  LoanContractType,
  LoanedPlayer,
  Player,
  PlayerInput,
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
      valueBefore: null,
      valueAfter: { ...input, valoreAttuale },
      changeSummary: `Modifica giocatore ${input.name}`,
    });
  }

  /**
   * Rinnova un giocatore:
   * 1. acquistoRinnovoSpesa ← prossimaSpesaRinnovo corrente
   * 2. prossimaPercRinnovo ← nuova percentuale
   * 3. ricalcola prossimaSpesaRinnovo sul valoreAttuale attuale
   */
  async renewPlayer(teamId: string, player: Player, nuovaPercRinnovo: number): Promise<void> {
    const valoreAttuale = calcolaValoreAttuale(
      player.valoreIniziale,
      player.quotazioneIniziale,
      player.quotazioneAttuale,
    );
    await updateDoc(this.playerRef(teamId, player.id), {
      acquistoRinnovoSpesa: player.prossimaSpesaRinnovo,
      prossimaPercRinnovo: nuovaPercRinnovo,
      prossimaSpesaRinnovo: calcolaProssimaSpesaRinnovo(valoreAttuale, nuovaPercRinnovo),
      updatedAt: serverTimestamp(),
    });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: player.id,
      operation: 'update',
      fieldModified: 'prossimaPercRinnovo',
      valueBefore: player.prossimaPercRinnovo,
      valueAfter: nuovaPercRinnovo,
      changeSummary: `Rinnovo ${player.name}: spesa ${player.prossimaSpesaRinnovo} € → soldi spesi`,
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