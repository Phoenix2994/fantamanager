import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  Timestamp,
  WriteBatch,
  collection,
  collectionData,
  doc,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuditEntityType, DocSnapshot, OperazioneAnnullabile, UndoLogEntry } from '../models';
import { pianificaAnnullamento } from '../undo-calculator';
import { AuditService } from './audit.service';

/** Entità di audit da associare al log dell'annullamento, per tipo di operazione */
const ENTITY_PER_TIPO: Record<OperazioneAnnullabile, AuditEntityType> = {
  rinnovo: 'player',
  eliminazione: 'player',
  rimborso: 'player',
  acquistoAsta: 'player',
  scambioConferma: 'scambio',
  rientroPrestito: 'player',
  eventoBonusScambio: 'scambio',
  modificaTerminiScambio: 'scambio',
};

/** Dati di una voce di undoLog, senza i campi generati alla scrittura */
export interface NuovaUndoLogEntry {
  tipo: OperazioneAnnullabile;
  leagueId: string;
  teamIds: string[];
  descrizione: string;
  docs: DocSnapshot[];
  scambioId?: string;
}

/**
 * Registro delle operazioni annullabili (rinnovo, eliminazione/rimborso,
 * acquisto asta, conferma scambio): undoLog/{id}.
 *
 * Il pattern è "prima/dopo per documento": ogni servizio che esegue
 * un'operazione annullabile, PRIMA di scrivere, legge lo stato corrente di
 * ogni documento che sta per toccare e lo include (via `registra`) nello
 * STESSO batch atomico della scrittura vera e propria — quindi o si
 * salvano insieme dati e possibilità di annullare, o non si salva niente.
 *
 * `annulla()` ripristina ogni documento al proprio stato "prima" (o lo
 * elimina se non esisteva), sempre in un unico batch atomico. Nessun
 * limite di tempo: un'operazione resta annullabile anche se nel frattempo
 * altre operazioni hanno toccato le stesse squadre — è una scelta
 * consapevole (lega ristretta, serve semplicità), non una garanzia di
 * coerenza: annullare un'operazione vecchia può sovrascrivere modifiche
 * successive sugli stessi dati.
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);

  /** Ultime operazioni annullabili, dalla più recente */
  readonly recenti$: Observable<UndoLogEntry[]> = collectionData(
    query(collection(this.firestore, 'undoLog'), orderBy('timestamp', 'desc')),
    { idField: 'id' },
  ).pipe(map((list) => list as UndoLogEntry[]));

  /**
   * Aggiunge la voce di undoLog al batch dell'operazione (da chiamare PRIMA
   * di `batch.commit()`, dopo aver aggiunto le altre scritture).
   */
  registra(batch: WriteBatch, entry: NuovaUndoLogEntry): void {
    const ref = doc(collection(this.firestore, 'undoLog'));
    batch.set(ref, {
      ...entry,
      timestamp: serverTimestamp(),
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      undone: false,
    });
  }

  /**
   * Annulla un'operazione: ripristina ogni documento coinvolto al proprio
   * stato "prima" (o lo elimina se non esisteva) in un unico batch atomico,
   * poi marca la voce come annullata. Per gli scambi confermati, porta
   * anche la trattativa a stato 'annullata' invece di 'bozza'.
   */
  async annulla(entry: UndoLogEntry): Promise<void> {
    if (entry.undone) {
      throw new Error('Questa operazione è già stata annullata.');
    }

    const piano = pianificaAnnullamento(entry);
    const batch = writeBatch(this.firestore);

    for (const op of piano.operazioni) {
      const ref = doc(this.firestore, op.path);
      if (op.azione === 'delete') {
        batch.delete(ref);
      } else {
        batch.set(ref, op.data!);
      }
    }

    if (piano.scambioDaAnnullare) {
      batch.update(doc(this.firestore, `scambi/${piano.scambioDaAnnullare}`), {
        stato: 'annullata',
      });
    }

    batch.update(doc(this.firestore, `undoLog/${entry.id}`), {
      undone: true,
      undoneAt: serverTimestamp(),
      undoneBy: this.auth.currentUser?.uid ?? 'unknown',
    });

    await batch.commit();

    void this.audit.log({
      leagueId: entry.leagueId,
      teamId: entry.teamIds[0] ?? '',
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: ENTITY_PER_TIPO[entry.tipo],
      entityId: entry.id,
      operation: 'update',
      fieldModified: '*',
      valueBefore: null,
      valueAfter: null,
      changeSummary: `Annullata operazione: ${entry.descrizione}`,
    });
  }
}

/** Millisecondi di un Timestamp Firestore (0 se assente) — per ordinare in UI */
export function undoTimestampMillis(ts: Timestamp | null | undefined): number {
  return ts ? ts.toMillis() : 0;
}
