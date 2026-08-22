import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AuditEntityType, AuditLogEntry } from '../models';

/** Voce di audit senza id/timestamp (generati alla scrittura) */
export type NewAuditEntry = Omit<AuditLogEntry, 'id' | 'timestamp'>;

/**
 * Lettura dello storico operazioni (auditLog).
 * Le voci sono create dalle Cloud Functions onWrite; qui si legge solo.
 */
@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly firestore = inject(Firestore);

  /** Ultime N operazioni, dalla più recente */
  recent$(maxEntries = 50): Observable<AuditLogEntry[]> {
    const q = query(
      collection(this.firestore, 'auditLog'),
      orderBy('timestamp', 'desc'),
      limit(maxEntries),
    );
    return collectionData(q, { idField: 'id' }) as Observable<AuditLogEntry[]>;
  }

  /** Ultime operazioni filtrate per tipo di entità */
  recentByType$(
    entityType: AuditEntityType,
    maxEntries = 50,
  ): Observable<AuditLogEntry[]> {
    const q = query(
      collection(this.firestore, 'auditLog'),
      where('entityType', '==', entityType),
      orderBy('timestamp', 'desc'),
      limit(maxEntries),
    );
    return collectionData(q, { idField: 'id' }) as Observable<AuditLogEntry[]>;
  }

  /**
   * Registra un'operazione nello storico.
   * Finché le Cloud Functions non sono deployate la scrittura avviene
   * lato client (le rules consentono la creazione agli autenticati);
   * gli errori non devono mai bloccare l'operazione principale.
   */
  async log(entry: NewAuditEntry): Promise<void> {
    try {
      await addDoc(collection(this.firestore, 'auditLog'), {
        ...entry,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.warn('Impossibile scrivere nel audit log', error);
    }
  }
}
