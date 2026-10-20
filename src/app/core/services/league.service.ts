import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, doc, docData, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AstaInfrasettimanaleConfig, League } from '../models';
import { AuditService } from './audit.service';

/**
 * Accesso al documento league/{leagueId}: configurazione generale della lega,
 * a partire dai parametri dell'asta infrasettimanale (giorni/orari delle 4
 * fasi, modificabili dall'admin senza rilascio della webapp).
 */
@Injectable({ providedIn: 'root' })
export class LeagueService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);

  private readonly leagueRef = doc(this.firestore, `league/${environment.leagueId}`);

  /** Documento lega in realtime (undefined finché non esiste ancora) */
  readonly league$: Observable<League | undefined> = docData(this.leagueRef) as Observable<
    League | undefined
  >;

  /** Solo la configurazione dell'asta infrasettimanale, undefined finché l'admin non la salva la prima volta */
  readonly astaInfrasettimanaleConfig$: Observable<AstaInfrasettimanaleConfig | undefined> =
    this.league$.pipe(map((league) => league?.astaInfrasettimanale));

  /** Salva (merge) la configurazione dell'asta infrasettimanale — solo admin, vedi firestore.rules */
  async salvaAstaInfrasettimanaleConfig(config: AstaInfrasettimanaleConfig): Promise<void> {
    await setDoc(
      this.leagueRef,
      {
        astaInfrasettimanale: config,
        astaInfrasettimanaleUpdatedAt: serverTimestamp(),
        astaInfrasettimanaleUpdatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId: '',
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'league',
      entityId: environment.leagueId,
      operation: 'update',
      fieldModified: 'astaInfrasettimanale',
      valueBefore: null,
      valueAfter: config as unknown as Record<string, unknown>,
      changeSummary: config.abilitata
        ? 'Configurazione asta infrasettimanale aggiornata'
        : 'Asta infrasettimanale disabilitata per il prossimo ciclo',
    });
  }
}
