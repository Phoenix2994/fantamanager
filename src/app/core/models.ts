import { Timestamp } from 'firebase/firestore';

/** Ruoli giocatore fantacalcio */
export type Ruolo = 'Por' | 'Dc' | 'Cc' | 'Att';
export const RUOLI: readonly Ruolo[] = ['Por', 'Dc', 'Cc', 'Att'] as const;

/** Tipologie di contratto (dal foglio Excel ROSE.xlsx) */
export type ContractType =
  | 'TITOLO DEFINITIVO'
  | 'TITOLO DEFINITIVO (RECOMPRA)'
  | 'PRESTITO'
  | 'PRESTITO (DIRITTO)'
  | 'PRESTITO (OBBLIGO)';
export const CONTRACT_TYPES: readonly ContractType[] = [
  'TITOLO DEFINITIVO',
  'TITOLO DEFINITIVO (RECOMPRA)',
  'PRESTITO',
  'PRESTITO (DIRITTO)',
  'PRESTITO (OBBLIGO)',
] as const;

/** Contratti validi per un giocatore ceduto in prestito */
export type LoanContractType = Exclude<ContractType, 'TITOLO DEFINITIVO'>;
export const LOAN_CONTRACT_TYPES: readonly LoanContractType[] = [
  'PRESTITO',
  'PRESTITO (DIRITTO)',
  'PRESTITO (OBBLIGO)',
] as const;

/**
 * Giocatore di una rosa: teams/{teamId}/seasons/{season}/players/{playerId}
 *
 * Il campo ruolo conserva la stringa grezza dell'Excel (anche composta,
 * es. "Dd;Dc"): il filtro della UI si adatta ai valori realmente presenti.
 */
export interface Player {
  id: string;
  name: string;
  ruolo: string;
  contractType: ContractType;
  /** € spesi all'acquisto o all'ultimo rinnovo */
  acquistoRinnovoSpesa: number;
  /** percentuale per il prossimo rinnovo (es. 1.45 = 145%) */
  prossimaPercRinnovo: number;
  /** calcolato = valoreAttuale × prossimaPercRinnovo */
  prossimaSpesaRinnovo: number;
  /** Q.I. — inserita a mano */
  quotazioneIniziale: number;
  /** Q.A. — aggiornata automaticamente dallo scraping */
  quotazioneAttuale: number;
  /** V.I. — valore di acquisto, inserito a mano */
  valoreIniziale: number;
  /** V.A. — calcolato = valoreIniziale × (quotazioneAttuale / quotazioneIniziale) */
  valoreAttuale: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

/** Dati minimi per creare/modificare un giocatore (campi non calcolati) */
export interface PlayerInput {
  name: string;
  ruolo: string;
  contractType: ContractType;
  acquistoRinnovoSpesa: number;
  prossimaPercRinnovo: number;
  quotazioneIniziale: number;
  quotazioneAttuale: number;
  valoreIniziale: number;
}

/** Giocatore ceduto in prestito: teams/{teamId}/loanedPlayers/{loanId} */
export interface LoanedPlayer {
  id: string;
  playerName: string;
  toTeam: string;
  contractType: LoanContractType;
  createdAt?: Timestamp | null;
}

/** Squadra: teams/{teamId} */
export interface Team {
  id: string;
  leagueId: string;
  name: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

/** Campi di input manuale del pannello spese societarie */
export interface SeasonFinanceInputs {
  rinnovi: number;
  /** acquisti dal mercato libero infrasettimanale */
  acquistiMercatoInfrasettimanale: number;
  acquistiAstaSettembre: number;
  acquistiAstaGennaio: number;
  rescissioni: number;
  penali: number;
  /** trattative in uscita */
  trasferimentiUscita: number;
  /** trattative in entrata */
  trasferimentiEntrata: number;
  indennizzoSettembre: number;
  indennizzoGennaio: number;
  rimborsi: number;
  premi: number;
  soldiVersati: number;
  tasse: number;
}

export const EMPTY_FINANCE_INPUTS: SeasonFinanceInputs = {
  rinnovi: 0,
  acquistiMercatoInfrasettimanale: 0,
  acquistiAstaSettembre: 0,
  acquistiAstaGennaio: 0,
  rescissioni: 0,
  penali: 0,
  trasferimentiUscita: 0,
  trasferimentiEntrata: 0,
  indennizzoSettembre: 0,
  indennizzoGennaio: 0,
  rimborsi: 0,
  premi: 0,
  soldiVersati: 0,
  tasse: 0
};

/** Campi calcolati (client-side ora, Cloud Functions in produzione) */
export interface SeasonFinanceComputed {
  spesaAnnuale: number;
  tasse: number;
  spesaDaVersare: number;
  spesaTotale: number;
  soldiDaVersare: number;
  valoreRosa: number;
  bilancioSocietarioStagionale: number;
  /** storico: max tasse pagate finora, mai scendere sotto (ratchet) */
  taxMinimumHistoric: number;
}

/** Documento teams/{teamId}/seasonFinance/{season} */
export type SeasonFinance = SeasonFinanceInputs &
  SeasonFinanceComputed & {
    updatedAt?: Timestamp | null;
    updatedBy?: string | null;
  };

/** Scaglione fiscale: league/{leagueId}/taxBrackets/{bracketId} */
export interface TaxBracket {
  /** 1..6 */
  bracketIndex: number;
  /** aliquota decimale (es. 0.35) */
  aliquota: number;
  /** soglia in € oltre la quale si applica l'aliquota (es. 437.15) */
  limiteSogliaEuro: number;
}

/** Scaglioni di default (da Excel ROSE.xlsx), usati finché non sono su Firestore */
export const DEFAULT_TAX_BRACKETS: readonly TaxBracket[] = [
  { bracketIndex: 1, aliquota: 0.35, limiteSogliaEuro: 437.15 },
  { bracketIndex: 2, aliquota: 0.75, limiteSogliaEuro: 482.37 },
  { bracketIndex: 3, aliquota: 1.2, limiteSogliaEuro: 527.6 },
  { bracketIndex: 4, aliquota: 1.7, limiteSogliaEuro: 572.8 },
  { bracketIndex: 5, aliquota: 2.25, limiteSogliaEuro: 618.04 },
  { bracketIndex: 6, aliquota: 2.85, limiteSogliaEuro: 663.26 },
] as const;

/** Documento league/{leagueId} */
export interface League {
  id: string;
  name: string;
  season: string;
}

export type AuditEntityType =
  | 'player'
  | 'playerLoaned'
  | 'seasonFinance'
  | 'initial_import';
export type AuditOperation = 'create' | 'update' | 'delete';

/** Voce dello storico operazioni: auditLog/{logId} */
export interface AuditLogEntry {
  id: string;
  timestamp: Timestamp | null;
  leagueId: string;
  teamId: string;
  /**
   * Identificativo dell'account admin che ha operato.
   * Con l'account condiviso è l'uid fisso; passerà a uid individuali
   * se si aggiungeranno account personali.
   */
  adminId: string;
  entityType: AuditEntityType;
  entityId: string;
  operation: AuditOperation;
  fieldModified: string;
  valueBefore: unknown;
  valueAfter: unknown;
  changeSummary: string;
}