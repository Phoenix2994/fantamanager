import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { ValutazioneSvincolato } from '../models';

/**
 * Valutazioni PRIVATE (stelle 1-3 + note) di una squadra sugli svincolati —
 * vedi ValutazioneSvincolato in models.ts per il perché della collection
 * separata. Leggibile/scrivibile solo dalla squadra proprietaria: le query
 * qui hanno senso solo quando si è loggati come quella squadra (altrimenti
 * le regole Firestore le rifiutano).
 */
@Injectable({ providedIn: 'root' })
export class TeamNotesService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  /** Tutte le valutazioni della squadra, realtime */
  valutazioni$(teamId: string): Observable<ValutazioneSvincolato[]> {
    return runInInjectionContext(
      this.injector,
      () =>
        collectionData(collection(this.firestore, this.path(teamId)), {
          idField: 'id',
        }) as Observable<ValutazioneSvincolato[]>,
    );
  }

  /** La valutazione della squadra su un singolo svincolato, realtime */
  valutazione$(teamId: string, svincolatoId: string): Observable<ValutazioneSvincolato | undefined> {
    return runInInjectionContext(
      this.injector,
      () =>
        docData(doc(this.firestore, `${this.path(teamId)}/${svincolatoId}`), {
          idField: 'id',
        }) as Observable<ValutazioneSvincolato | undefined>,
    );
  }

  /** Imposta le stelle (1-3) per uno svincolato, senza toccare la nota esistente */
  async setStelle(teamId: string, svincolatoId: string, stelle: number): Promise<void> {
    await setDoc(
      doc(this.firestore, `${this.path(teamId)}/${svincolatoId}`),
      { stelle, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  /** Imposta la nota per uno svincolato, senza toccare le stelle esistenti */
  async setNota(teamId: string, svincolatoId: string, note: string): Promise<void> {
    await setDoc(
      doc(this.firestore, `${this.path(teamId)}/${svincolatoId}`),
      { note, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  private path(teamId: string): string {
    return `teamNotes/${teamId}/svincolati`;
  }
}
