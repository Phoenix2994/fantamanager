import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  docData,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AstaStato, PlayerInput, Svincolato } from '../models';
import { round2 } from '../finance-calculator';
import { AuditService } from './audit.service';
import { FinanceService } from './finance.service';
import { TeamService } from './team.service';

/** Provenienza della spesa per l'assegnazione del giocatore all'asta */
export type ProvenienzaAsta = 'acquistiAstaSettembre' | 'acquistiMercatoInfrasettimanale';

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
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);

  private readonly statoRef = doc(this.firestore, 'asta/statoCorrente');

  /** Stato corrente dell'asta in realtime */
  readonly stato$: Observable<AstaStato | undefined> = docData(
    this.statoRef,
  ) as Observable<AstaStato | undefined>;

  /**
   * Apre l'asta su un giocatore svincolato.
   * Il prezzo di partenza è la sua quotazione mantra attuale.
   */
  async apriAsta(giocatore: Svincolato): Promise<void> {
    await setDoc(this.statoRef, {
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
   * Transaction atomica: verifica che l'asta sia aperta, che la squadra
   * non sia già l'ultima rilanciante e aggiorna il prezzo.
   */
  async rilancia(teamId: string, teamName: string, incremento: number): Promise<void> {
    await runTransaction(this.firestore, async (tx) => {
      const snap = await tx.get(this.statoRef);
      const stato = snap.data() as AstaStato | undefined;
      if (!stato || !stato.aperta) {
        throw new Error('L\u2019asta non \u00e8 aperta');
      }
      if (stato.rilanciatoDaTeamId === teamId) {
        throw new Error('La tua squadra \u00e8 gi\u00e0 l\u2019ultima rilanciante');
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
   * Assegna il giocatore alla squadra vincitrice al prezzo corrente:
   * 1. crea il giocatore nella rosa (TITOLO DEFINITIVO)
   * 2. somma la spesa alla voce scelta (asta settembre / infrasettimanale)
   * 3. chiude l'asta
   */
  async assegna(
    teamId: string,
    teamName: string,
    provenienza: ProvenienzaAsta,
  ): Promise<void> {
    const stato = await this.getStato();
    if (!stato || !stato.aperta) {
      throw new Error('L\u2019asta non \u00e8 aperta');
    }

    // 1. Crea il giocatore nella rosa del team vincitore
    const input: PlayerInput = {
      name: stato.giocatoreNome,
      ruolo: stato.ruolo,
      contractType: 'TITOLO DEFINITIVO',
      acquistoRinnovoSpesa: stato.prezzoAttuale,
      // Il primo rinnovo sarà all'85% del valore attuale
      prossimaPercRinnovo: 0.85,
      // Q.I. = Q.A. = quotazione al momento dell'acquisto
      quotazioneIniziale: stato.quotazione,
      quotazioneAttuale: stato.quotazione,
      valoreIniziale: stato.prezzoAttuale,
    };
    await this.teamService.addPlayer(teamId, input);

    // 2. Valore rosa aggiornato (rilegge i giocatori appena aggiornati)
    const playersSnap = await getDocs(
      collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
    );
    const nuovaRosa =
      Math.round(
        playersSnap.docs.reduce((sum, d) => sum + ((d.data()['valoreAttuale'] as number) || 0), 0) *
          100,
      ) / 100;

    // 3. Somma la spesa alla voce di provenienza scelta
    await this.financeService.addAcquisto(
      teamId,
      provenienza,
      stato.prezzoAttuale,
      nuovaRosa,
      stato.giocatoreNome,
    );

    // 4. Rimuove il giocatore dagli svincolati (ID deterministico = slug nome)
    await deleteDoc(
      doc(this.firestore, `league/${environment.leagueId}/svincolati/${slugify(stato.giocatoreNome)}`),
    ).catch(() => {
      // Se il documento non esiste, ignoriamo l'errore
    });

    // 5. Chiude l'asta
    await updateDoc(this.statoRef, { aperta: false });

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'player',
      entityId: `${teamId}/${stato.giocatoreNome}`,
      operation: 'create',
      fieldModified: 'asta',
      valueBefore: null,
      valueAfter: { prezzo: stato.prezzoAttuale, provenienza },
      changeSummary:
        `Assegnazione asta: ${stato.giocatoreNome} a ${teamName} ` +
        `per ${stato.prezzoAttuale} €`,
    });
  }

  private async getStato(): Promise<AstaStato | undefined> {
    const snap = await import('@angular/fire/firestore').then((m) => m.getDoc(this.statoRef));
    return snap.data() as AstaStato | undefined;
  }
}

/** Slug del nome: minuscolo, accent-folding, spazi → trattini (come lo script Python) */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}
