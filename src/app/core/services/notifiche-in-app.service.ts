import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

/** Un evento dell'asta infrasettimanale mostrato in-app (vedi functions/src/index.ts) */
export interface EventoInApp {
  id: string;
  titolo: string;
  corpo: string;
}

/**
 * Eventi dell'asta infrasettimanale scritti dalle Cloud Functions in
 * notifiche/{teamId}/eventi — pensati per essere mostrati come banner
 * all'apertura dell'app, così anche chi non ha attivato le notifiche push
 * (o è su un browser che non le supporta) veda comunque la comunicazione.
 * Scritti SOLO dalla Cloud Function: il client può solo leggerli e
 * eliminarli una volta mostrati (vedi firestore.rules).
 */
@Injectable({ providedIn: 'root' })
export class NotificheInAppService {
  private readonly firestore = inject(Firestore);

  /** Eventi non ancora letti per la squadra, dal più vecchio al più recente */
  nonLetti$(teamId: string): Observable<EventoInApp[]> {
    return collectionData(
      query(
        collection(this.firestore, `notifiche/${teamId}/eventi`),
        where('letta', '==', false),
        orderBy('timestamp', 'asc'),
      ),
      { idField: 'id' },
    ) as Observable<EventoInApp[]>;
  }

  /** Elimina l'evento una volta mostrato (niente da "ri-leggere" in futuro) */
  async segnaLetto(teamId: string, eventoId: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `notifiche/${teamId}/eventi/${eventoId}`));
  }
}
