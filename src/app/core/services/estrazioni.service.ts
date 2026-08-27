import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc, getDoc, getDocs, writeBatch } from '@angular/fire/firestore';
import { environment } from '../../../environments/environment';
import { round2 } from '../finance-calculator';
import { Player, SeasonFinance } from '../models';
import { VincitaAiutoDiStato } from '../estrazioni-calculator';
import { AuditService } from './audit.service';
import { FinanceService } from './finance.service';

/**
 * Scrittura dell'effetto economico degli "aiuti di stato" (Regolamento,
 * cap. 6): l'estrazione in sé è pura UI/calcolo (vedi estrazioni-calculator
 * ed EstrazioniPage) e NON viene salvata da nessuna parte — solo la
 * conferma finale dell'admin scrive qualcosa, ed è solo l'importo vinto,
 * sommato agli indennizzi di settembre di ciascuna squadra estratta.
 */
@Injectable({ providedIn: 'root' })
export class EstrazioniService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly finance = inject(FinanceService);
  private readonly audit = inject(AuditService);
  private readonly injector = inject(Injector);

  private financePath(teamId: string): string {
    return `teams/${teamId}/seasonFinance/${environment.season}`;
  }

  /** Valore attuale totale della rosa di una squadra (serve alla tassa progressiva) */
  private async valoreRosaDi(teamId: string): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(
        collection(this.firestore, `teams/${teamId}/seasons/${environment.season}/players`),
      );
      return round2(
        snap.docs.reduce((s, d) => s + ((d.data() as Player).valoreAttuale || 0), 0),
      );
    });
  }

  /**
   * Somma il bonus vinto da ciascuna squadra estratta agli indennizzi di
   * settembre — un'unica scrittura atomica per tutte le squadre coinvolte
   * (fino a 6). Non tocca né salva l'estrazione stessa: solo l'effetto
   * economico finale, esattamente come un indennizzo qualsiasi.
   */
  async confermaAiutiDiStato(vincite: readonly VincitaAiutoDiStato[]): Promise<void> {
    if (vincite.length === 0) {
      return;
    }
    const financeRefs = vincite.map((v) => doc(this.firestore, this.financePath(v.teamId)));
    const [financeSnaps, valoriRosa] = await Promise.all([
      Promise.all(financeRefs.map((ref) => getDoc(ref))),
      Promise.all(vincite.map((v) => this.valoreRosaDi(v.teamId))),
    ]);

    const batch = writeBatch(this.firestore);
    vincite.forEach((v, i) => {
      const financeBefore = financeSnaps[i].data() as SeasonFinance | undefined;
      const { data } = this.finance.preparaAiutoDiStato(financeBefore, v.bonusEuro, valoriRosa[i]);
      batch.set(financeRefs[i], { ...data, ...this.finance.metaScrittura() }, { merge: true });
    });

    await batch.commit();

    for (const v of vincite) {
      void this.audit.log({
        leagueId: environment.leagueId,
        teamId: v.teamId,
        adminId: this.auth.currentUser?.uid ?? 'unknown',
        entityType: 'seasonFinance',
        entityId: `${v.teamId}/${environment.season}`,
        operation: 'update',
        fieldModified: 'indennizzoSettembre',
        valueBefore: null,
        valueAfter: { bonusEuro: v.bonusEuro, bonusPerc: v.bonusPerc, posizione: v.posizione },
        changeSummary: `Aiuto di stato (estrazione lega): +${v.bonusEuro} € indennizzi settembre per ${v.teamName}`,
      });
    }
  }
}
