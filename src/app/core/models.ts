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
  /**
   * true se il giocatore NON è stato trovato tra le quotazioni di fantacalcio.it
   * (quindi non risulta in Serie A): evidenziato in rosa nella rosa e
   * escluso dalle trattative.
   */
  fuoriSerieA?: boolean;
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

/**
 * Giocatore svincolato (presente nel listone fantacalcio.it ma non in
 * nessuna rosa): league/{leagueId}/svincolati/{playerId}.
 * Popolato automaticamente dallo script di aggiornamento quotazioni.
 */
export interface Svincolato {
  id: string;
  name: string;
  /** ruolo mantra (Por, Dd, Dc, Ds, B, M, C, E, W, T, A, Pc) */
  ruolo: string;
  /** quotazione mantra attuale */
  quotazioneAttuale: number;
  /** sigla della squadra (es. INT, MIL) */
  squadra: string;
  season: string;
  updatedAt?: Timestamp | null;
  /**
   * true se l'asta è già stata aperta su questo giocatore (a prescindere
   * dall'esito: anche se poi è stata chiusa senza assegnazione). Serve solo
   * a escluderlo dai pick di "Apri asta random", per non ripescare sempre
   * gli stessi nomi finché l'admin non fa reset (per-giocatore o in blocco).
   * Non viene mai toccato se il giocatore risulta assegnato: in quel caso
   * il documento viene proprio cancellato dagli svincolati.
   */
  chiamato?: boolean;
  chiamatoAt?: Timestamp | null;
}

/**
 * Valutazione PRIVATA di una squadra su uno svincolato — vantaggio
 * competitivo personale, non condiviso: teamNotes/{teamId}/svincolati/{id}.
 * Collection separata dalla lega (non teams/{teamId}/... né
 * league/{leagueId}/svincolati/...) apposta: quegli alberi sono già
 * pubblicamente leggibili da regole più larghe, qui invece deve poterla
 * leggere/scrivere SOLO la squadra proprietaria (isTeamOwner in
 * firestore.rules). L'id del documento è lo stesso id dello svincolato
 * (stesso slug), così non serve un doppio indirizzamento.
 */
export interface ValutazioneSvincolato {
  id: string;
  /** 1-3, assente/0 = non valutato */
  stelle: number;
  note: string;
  updatedAt?: Timestamp | null;
}

/**
 * Stato corrente dell'asta live: asta/statoCorrente.
 * Un solo documento: ogni rilancio è un update atomico (transaction).
 */
export interface AstaStato {
  id: string;
  /** true mentre il giocatore è in asta */
  aperta: boolean;
  giocatoreNome: string;
  /** ruolo mantra (anche composto, es. "M;C") */
  ruolo: string;
  /** sigla della squadra del giocatore (es. INT, MIL) */
  squadra: string;
  /** quotazione mantra di partenza */
  quotazione: number;
  prezzoAttuale: number;
  rilanciatoDaTeamId: string;
  rilanciatoDaTeamName: string;
  timestampUltimoRilancio?: Timestamp | null;
}

/** Squadra: teams/{teamId} */
export interface Team {
  id: string;
  leagueId: string;
  name: string;
  /**
   * uid dell'account Firebase (email/password) di proprietà della squadra
   * — NON l'admin. Scritto solo dallo script di provisioning (Admin SDK),
   * mai dal client: le security rules lo usano per verificare "questo
   * utente è davvero questa squadra" (isTeamOwner in firestore.rules).
   */
  ownerUid?: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

/**
 * Lato di una trattativa di scambio: squadra + giocatori ceduti.
 * `ownerUid` è una copia di teams/{teamId}.ownerUid presa al momento del
 * salvataggio: serve SOLO alle security rules, per poter verificare la
 * privacy delle bozze con una query diretta (`where squadraX.ownerUid ==
 * request.auth.uid`) invece di una `get()` — le query Firestore non
 * possono essere validate dalle rules se la condizione richiede una
 * lettura indiretta. Può essere null se la squadra non ha (ancora) un
 * account proprietario.
 */
export interface ScambioSide {
  teamId: string;
  playerIds: string[];
  ownerUid: string | null;
}

/**
 * bozza: privata, visibile solo alle due squadre coinvolte (autenticate).
 * ufficializzata: una delle due squadre l'ha confermata da parte sua —
 *   ora visibile anche agli admin, che possono confermarla o lasciarla lì.
 * confermata / annullata: come oggi, pubbliche.
 */
export type ScambioStato = 'bozza' | 'ufficializzata' | 'confermata' | 'annullata';

/**
 * Trattativa di scambio tra due squadre: scambi/{scambioId}.
 *
 * Bilanciamento (interpretazione concordata): il totale ceduto dalla
 * squadra pagante è (valore giocatori + conguaglio); la parte che risulta
 * più "povera" vede i propri giocatori rivalutati in su della differenza,
 * distribuita proporzionalmente alle quotazioni attuali.
 */
export interface Scambio {
  id: string;
  season: string;
  squadraA: ScambioSide;
  squadraB: ScambioSide;
  /** conguaglio in € (0 = nessun conguaglio) */
  conguaglio: number;
  /** squadra che paga il conguaglio; null se conguaglio = 0 */
  conguaglioPagante: 'A' | 'B' | null;
  stato: ScambioStato;
  /**
   * Fotografia dei dati al momento del salvataggio, per mostrare il
   * riepilogo nella lista senza leggere le rose di tutte le squadre.
   */
  snapshot: ScambioSnapshot;
  createdAt?: Timestamp | null;
  createdBy?: string | null;
  ufficializzataAt?: Timestamp | null;
  confirmedAt?: Timestamp | null;
}

/** Giocatore sintetico dentro lo snapshot di una trattativa */
export interface ScambioPlayerSnapshot {
  name: string;
  ruolo: string;
  valoreAttuale: number;
}

/** Rivalutazione registrata nello snapshot */
export interface ScambioRivalutazioneSnapshot {
  playerId: string;
  playerName: string;
  valorePrima: number;
  valoreDopo: number;
}

/** Fotografia della trattativa al momento del salvataggio */
export interface ScambioSnapshot {
  nomeSquadraA: string;
  nomeSquadraB: string;
  giocatoriA: ScambioPlayerSnapshot[];
  giocatoriB: ScambioPlayerSnapshot[];
  valoreTotaleA: number;
  valoreTotaleB: number;
  rivalutazioni: ScambioRivalutazioneSnapshot[];
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
  | 'scambio'
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

/** Tipi di operazione che possono essere annullate (vedi UndoService) */
export type OperazioneAnnullabile =
  | 'rinnovo'
  | 'eliminazione'
  | 'rimborso'
  | 'acquistoAsta'
  | 'scambioConferma';

/**
 * Stato di un documento Firestore prima dell'operazione, per poterlo
 * ripristinare esattamente. `before: null` significa che il documento
 * NON esisteva prima (l'annullamento lo elimina invece di ripristinarlo).
 */
export interface DocSnapshot {
  /** path completo del documento, es. "teams/abc/seasons/2026-27/players/xyz" */
  path: string;
  before: Record<string, unknown> | null;
}

/**
 * Voce di registro per annullare un'operazione "sensibile": undoLog/{id}.
 * Scritta nello STESSO batch atomico dell'operazione che descrive, con lo
 * stato di ogni documento toccato PRIMA della scrittura. `annulla()` in
 * UndoService ripristina ogni documento al proprio `before` (o lo elimina
 * se `before` è null).
 */
export interface UndoLogEntry {
  id: string;
  timestamp: Timestamp | null;
  tipo: OperazioneAnnullabile;
  leagueId: string;
  /** squadre coinvolte, solo per mostrarle nello storico */
  teamIds: string[];
  descrizione: string;
  docs: DocSnapshot[];
  /**
   * Solo per tipo 'scambioConferma': id della trattativa, il cui stato va
   * portato ad 'annullata' (non semplicemente ripristinato a 'bozza').
   */
  scambioId?: string;
  adminId: string;
  undone: boolean;
  undoneAt?: Timestamp | null;
  undoneBy?: string | null;
}