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
import {
  ReimborsoParams,
  RiepilogoReimborso,
  ricalcolaFinance,
  preparaAcquistoAsta as preparaAcquistoAstaCalc,
  preparaAiutoDiStato as preparaAiutoDiStatoCalc,
  preparaReimborso as preparaReimborsoCalc,
  preparaRescissione as preparaRescissioneCalc,
  preparaRinnovo as preparaRinnovoCalc,
  preparaTrasferimento as preparaTrasferimentoCalc,
} from '../finance-calculator';
import {
  DEFAULT_TAX_BRACKETS,
  EMPTY_FINANCE_INPUTS,
  SeasonFinance,
  SeasonFinanceComputed,
  SeasonFinanceInputs,
  TaxBracket,
} from '../models';
import { AuditService } from './audit.service';

export type { ReimborsoParams, RiepilogoReimborso };

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

  /** Legge il documento finanze corrente (lettura singola, non realtime) */
  async leggiFinanceCorrente(teamId: string): Promise<SeasonFinance | undefined> {
    const snap = await getDoc(this.financeRef(teamId));
    return snap.data() as SeasonFinance | undefined;
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze con un rimborso/indennizzo:
   * - rimborso   = % rimborso   × soldi spesi  → somma ai Rimborsi
   * - indennizzo = % indennizzo × V.A.         → somma agli Indennizzi
   *                 di settembre o gennaio (a scelta)
   * Il chiamante include il risultato nel batch atomico (vedi
   * TeamService.eseguiRimborso) insieme allo snapshot "prima" per l'undo.
   */
  preparaReimborso(
    current: SeasonFinance | undefined,
    player: { acquistoRinnovoSpesa: number; valoreAttuale: number },
    params: ReimborsoParams,
    valoreRosaAggiornato: number,
  ): { data: SeasonFinanceInputs & SeasonFinanceComputed } & RiepilogoReimborso {
    return preparaReimborsoCalc(current, player, params, valoreRosaAggiornato, this.bracketsCache);
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze con un rinnovo:
   * rinnovo = % rinnovo applicata × V.A. del giocatore → somma ai Rinnovi.
   * La rosa non cambia: passa il valore rosa corrente.
   */
  preparaRinnovo(
    current: SeasonFinance | undefined,
    player: { valoreAttuale: number },
    nuovaPercRinnovo: number,
    valoreRosa: number,
  ): { data: SeasonFinanceInputs & SeasonFinanceComputed; rinnovo: number } {
    return preparaRinnovoCalc(current, player, nuovaPercRinnovo, valoreRosa, this.bracketsCache);
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze con un costo di
   * rescissione (es. 1,50 € fissi all'eliminazione di un giocatore).
   */
  preparaRescissione(
    current: SeasonFinance | undefined,
    importo: number,
    valoreRosa: number,
  ): { data: SeasonFinanceInputs & SeasonFinanceComputed } {
    return preparaRescissioneCalc(current, importo, valoreRosa, this.bracketsCache);
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze con un bonus vinto
   * all'estrazione degli aiuti di stato (si somma agli indennizzi di
   * settembre, vedi EstrazioniService).
   */
  preparaAiutoDiStato(
    current: SeasonFinance | undefined,
    importo: number,
    valoreRosa: number,
  ): { data: SeasonFinanceInputs & SeasonFinanceComputed } {
    return preparaAiutoDiStatoCalc(current, importo, valoreRosa, this.bracketsCache);
  }

  /**
   * Prepara (SENZA scrivere) il documento finanze con un acquisto d'asta
   * (stessa logica di `addAcquisto`, ma pura: usata da AstaService per
   * includere la scrittura in un unico batch atomico con giocatore e
   * svincolato, con snapshot "prima" per l'undo).
   */
  preparaAcquistoAsta(
    current: SeasonFinance | undefined,
    campo: 'acquistiAstaSettembre' | 'acquistiMercatoInfrasettimanale' | 'acquistiAstaGennaio',
    importo: number,
    valoreRosa: number,
  ): { data: SeasonFinanceInputs & SeasonFinanceComputed } {
    return preparaAcquistoAstaCalc(current, campo, importo, valoreRosa, this.bracketsCache);
  }

  /** Metadati di scrittura standard (updatedAt/updatedBy) da unire ai dati preparati sopra */
  metaScrittura(): { updatedAt: unknown; updatedBy: string } {
    return { updatedAt: serverTimestamp(), updatedBy: this.auth.currentUser?.uid ?? 'unknown' };
  }

  /** Riferimento al documento finanze di una squadra (stagione corrente) */
  financeDocRef(teamId: string) {
    return this.financeRef(teamId);
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
    return preparaTrasferimentoCalc(current, campo, importo, valoreRosa, this.bracketsCache);
  }

  private financeRef(teamId: string) {
    return doc(this.firestore, `teams/${teamId}/seasonFinance/${environment.season}`);
  }
}

