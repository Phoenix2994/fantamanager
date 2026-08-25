import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  getDoc,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { round1, round2, ricalcolaFinance } from '../finance-calculator';
import {
  DEFAULT_TAX_BRACKETS,
  EMPTY_FINANCE_INPUTS,
  SeasonFinance,
  SeasonFinanceComputed,
  SeasonFinanceInputs,
  TaxBracket,
} from '../models';
import { AuditService } from './audit.service';

/** Parametri dell'operazione di rimborso/rescissione di un giocatore */
export interface ReimborsoParams {
  percRimborso: number;
  percIndennizzo: number;
  mese: 'settembre' | 'gennaio';
}

export interface RiepilogoReimborso {
  rimborso: number;
  indennizzo: number;
}

/**
 * Gestione delle spese societarie stagionali e degli scaglioni fiscali.
 *
 * Nota architetturale: i campi calcolati sono calcolati qui prima della
 * scrittura (aggiornamento ottimistico). Quando le Cloud Functions saranno
 * deployate faranno lo stesso ricalcolo lato server tramite
 * finance-calculator.ts (funzioni pure condivise).
 */
@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly audit = inject(AuditService);
  /** Necessario per chiamare le API Firebase fuori dal contesto di injection */
  private readonly injector = inject(Injector);

  /** Scaglioni fiscali da Firestore, con fallback ai valori default dell'Excel */
  readonly taxBrackets$: Observable<TaxBracket[]> = collectionData(
    collection(this.firestore, `league/${environment.leagueId}/taxBrackets`),
  ).pipe(
    map((list) => (list.length ? (list as TaxBracket[]) : [...DEFAULT_TAX_BRACKETS])),
    startWith([...DEFAULT_TAX_BRACKETS]),
  );

  /** Cache locale degli scaglioni per il ricalcolo sincrono */
  private bracketsCache: TaxBracket[] = [...DEFAULT_TAX_BRACKETS];
  private readonly bracketsSubscription = this.taxBrackets$.subscribe(
    (brackets) => (this.bracketsCache = brackets),
  );

  /** Documento spese della stagione corrente per una squadra */
  seasonFinance$(teamId: string): Observable<SeasonFinance | undefined> {
    // Query dinamica: va eseguita dentro un injection context (vedi TeamService)
    return runInInjectionContext(
      this.injector,
      () => docData(this.financeRef(teamId)) as Observable<SeasonFinance | undefined>,
    );
  }

  /**
   * Salva i campi manuali (merge parziale) e ricalcola tutti i derivati:
   * spesaAnnuale, tasse (scaglioni + ratchet), spesaDaVersare, spesaTotale,
   * soldiDaVersare, bilancio societario stagionale.
   * Crea il documento se non esiste (setDoc con merge).
   */
  async saveFinanceInputs(
    teamId: string,
    partial: Partial<SeasonFinanceInputs>,
    valoreRosa: number,
    current: SeasonFinance | undefined,
  ): Promise<void> {
    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      ...partial,
    };

    const computed = ricalcolaFinance(
      merged,
      this.bracketsCache,
      valoreRosa,
      current?.taxMinimumHistoric ?? 0,
    );

    await setDoc(
      this.financeRef(teamId),
      {
        ...merged,
        ...computed,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    // valueBefore: valori precedenti dei soli campi modificati
    const valueBefore: Record<string, number> = {};
    for (const key of Object.keys(partial) as (keyof SeasonFinanceInputs)[]) {
      valueBefore[key] = current?.[key] ?? 0;
    }

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: Object.keys(partial).join(', ') || '*',
      valueBefore,
      valueAfter: partial,
      changeSummary: 'Aggiornamento spese societarie',
    });
  }

  /**
   * Operazione di rimborso/rescissione di un giocatore:
   * - rimborso   = % rimborso   × soldi spesi  → somma ai Rimborsi
   * - indennizzo = % indennizzo × V.A.         → somma agli Indennizzi
   *                 di settembre o gennaio (a scelta)
   *
   * Il chiamante deve aver già rimosso il giocatore dalla rosa e passare
   * il valore rosa AGGIORNATO (senza il giocatore ceduto).
   * Ricalcola tutti i derivati (tasse comprese) e registra l'audit.
   */
  async applyReimborso(
    teamId: string,
    player: {
      name: string;
      acquistoRinnovoSpesa: number;
      valoreAttuale: number;
    },
    params: ReimborsoParams,
    valoreRosaAggiornato: number,
  ): Promise<RiepilogoReimborso> {
    const rimborso = round2(params.percRimborso * (player.acquistoRinnovoSpesa || 0));
    const indennizzo = round2(params.percIndennizzo * (player.valoreAttuale || 0));

    const snap = await getDoc(this.financeRef(teamId));
    const current = snap.data() as SeasonFinance | undefined;

    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      rimborsi: (current?.rimborsi ?? 0) + rimborso,
      ...(params.mese === 'settembre'
        ? { indennizzoSettembre: (current?.indennizzoSettembre ?? 0) + indennizzo }
        : { indennizzoGennaio: (current?.indennizzoGennaio ?? 0) + indennizzo }),
    };

    const computed = ricalcolaFinance(
      merged,
      this.bracketsCache,
      valoreRosaAggiornato,
      current?.taxMinimumHistoric ?? 0,
    );

    await setDoc(
      this.financeRef(teamId),
      {
        ...merged,
        ...computed,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: 'rimborsi, indennizzi',
      valueBefore: {
        rimborsi: current?.rimborsi ?? 0,
        ...(params.mese === 'settembre'
          ? { indennizzoSettembre: current?.indennizzoSettembre ?? 0 }
          : { indennizzoGennaio: current?.indennizzoGennaio ?? 0 }),
      },
      valueAfter: { rimborso, indennizzo, mese: params.mese },
      changeSummary:
        `Rimborso ${player.name}: +${rimborso} € rimborsi, ` +
        `+${indennizzo} € indennizzi ${params.mese}`,
    });

    return { rimborso, indennizzo };
  }

  /**
   * Operazione di rinnovo di un giocatore:
   * rinnovo = % rinnovo applicata × V.A. del giocatore → somma ai Rinnovi.
   * La rosa non cambia: passa il valore rosa corrente.
   * Ricalcola tutti i derivati (tasse comprese) e registra l'audit.
   */
  async applyRinnovo(
    teamId: string,
    player: { name: string; valoreAttuale: number },
    nuovaPercRinnovo: number,
    valoreRosa: number,
  ): Promise<number> {
    const rinnovo = round1(nuovaPercRinnovo * (player.valoreAttuale || 0));

    const snap = await getDoc(this.financeRef(teamId));
    const current = snap.data() as SeasonFinance | undefined;

    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      rinnovi: (current?.rinnovi ?? 0) + rinnovo,
    };

    const computed = ricalcolaFinance(
      merged,
      this.bracketsCache,
      valoreRosa,
      current?.taxMinimumHistoric ?? 0,
    );

    await setDoc(
      this.financeRef(teamId),
      {
        ...merged,
        ...computed,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: 'rinnovi',
      valueBefore: { rinnovi: current?.rinnovi ?? 0 },
      valueAfter: { rinnovi: merged.rinnovi, rinnovo, perc: nuovaPercRinnovo },
      changeSummary: `Rinnovo ${player.name}: +${rinnovo} € ai rinnovi`,
    });

    return rinnovo;
  }

  /**
   * Somma l'importo di un acquisto alla voce di spesa corrispondente
   * alla provenienza del giocatore (asta sett / infrasettimanale /
   * asta gen / trasferimenti) e ricalcola tutti i derivati.
   */
  async addAcquisto(
    teamId: string,
    campo:
      | 'acquistiAstaSettembre'
      | 'acquistiMercatoInfrasettimanale'
      | 'acquistiAstaGennaio'
      | 'trasferimentiUscita',
    importo: number,
    valoreRosa: number,
    nomeGiocatore: string,
  ): Promise<void> {
    if (!(importo > 0)) {
      return;
    }

    const snap = await getDoc(this.financeRef(teamId));
    const current = snap.data() as SeasonFinance | undefined;

    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      [campo]: (current?.[campo] ?? 0) + importo,
    };

    const computed = ricalcolaFinance(
      merged,
      this.bracketsCache,
      valoreRosa,
      current?.taxMinimumHistoric ?? 0,
    );

    await setDoc(
      this.financeRef(teamId),
      {
        ...merged,
        ...computed,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: campo,
      valueBefore: { [campo]: current?.[campo] ?? 0 },
      valueAfter: { [campo]: merged[campo], importo },
      changeSummary: `Acquisto ${nomeGiocatore}: +${importo} € a ${campo}`,
    });
  }

  /**
   * Somma un importo alla voce Rescissioni (es. costo fisso di rescissione
   * di 1,50 € all'eliminazione di un giocatore) e ricalcola tutti i derivati.
   */
  async addRescissione(teamId: string, importo: number, valoreRosa: number): Promise<void> {
    const snap = await getDoc(this.financeRef(teamId));
    const current = snap.data() as SeasonFinance | undefined;

    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      rescissioni: (current?.rescissioni ?? 0) + importo,
    };

    const computed = ricalcolaFinance(
      merged,
      this.bracketsCache,
      valoreRosa,
      current?.taxMinimumHistoric ?? 0,
    );

    await setDoc(
      this.financeRef(teamId),
      {
        ...merged,
        ...computed,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUser?.uid ?? 'unknown',
      },
      { merge: true },
    );

    void this.audit.log({
      leagueId: environment.leagueId,
      teamId,
      adminId: this.auth.currentUser?.uid ?? 'unknown',
      entityType: 'seasonFinance',
      entityId: `${teamId}/${environment.season}`,
      operation: 'update',
      fieldModified: 'rescissioni',
      valueBefore: { rescissioni: current?.rescissioni ?? 0 },
      valueAfter: { rescissioni: merged.rescissioni, importo },
      changeSummary: `Rescissione: +${importo} € alle rescissioni`,
    });
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze aggiornato con un
   * trasferimento legato a uno scambio: +importo su trasferimentiUscita
   * o trasferimentiEntrata, ricalcolando tutti i derivati.
   * Il chiamante (ScambiService) include il risultato nel batch atomico.
   */
  preparaTrasferimento(
    current: SeasonFinance | undefined,
    campo: 'trasferimentiUscita' | 'trasferimentiEntrata',
    importo: number,
    valoreRosa: number,
  ): SeasonFinanceInputs & SeasonFinanceComputed {
    const merged: SeasonFinanceInputs = {
      ...EMPTY_FINANCE_INPUTS,
      ...(current ?? {}),
      [campo]: round2((current?.[campo] ?? 0) + importo),
    };
    return { ...merged, ...ricalcolaFinance(merged, this.bracketsCache, valoreRosa, current?.taxMinimumHistoric ?? 0) };
  }

  private financeRef(teamId: string) {
    return doc(this.firestore, `teams/${teamId}/seasonFinance/${environment.season}`);
  }
}

