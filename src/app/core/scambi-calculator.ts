import { Player, Scambio } from './models';
import {
  MIN_VALORE,
  calcolaProssimaSpesaRinnovo,
  calcolaValoreAttuale,
  round1,
  round2,
} from './finance-calculator';

/**
 * Logica pura degli scambi tra squadre (nessuna dipendenza da Firebase),
 * stessa architettura di finance-calculator.ts: calcoli testabili e
 * riutilizzabili da client e future Cloud Functions.
 *
 * Regola di bilanciamento (interpretazione concordata con la lega):
 *   totale ceduto dal pagante = valore dei SUOI giocatori + conguaglio
 *   totale ceduto dall'altra  = valore dei SUOI giocatori
 * La parte con totale minore fa salire i propri giocatori della differenza,
 * distribuita proporzionalmente alle quotazioni attuali.
 */

/** Percentuale di prossimo rinnovo impostata a TUTTI i giocatori coinvolti */
export const PERC_RINNOVO_SCAMBIO = 0.6;

export type LatoScambio = 'A' | 'B';

/**
 * Vero solo se la squadra possiede il giocatore A TITOLO DEFINITIVO (non un
 * prestito ricevuto, con o senza diritto/obbligo di riscatto): solo in quel
 * caso può cederlo in un nuovo scambio — un prestito in rosa non è suo da
 * rivendere.
 */
export function possedutoATitoloDefinitivo(player: Player): boolean {
  return (
    player.contractType === 'TITOLO DEFINITIVO' ||
    player.contractType === 'TITOLO DEFINITIVO (RECOMPRA)'
  );
}

/**
 * Id di tutti i giocatori con un bonus pattuito in una trattativa avanzata
 * CONFERMATA della stagione corrente: la finestra in cui un bonus viene
 * verificato/pagato è implicitamente la stagione in corso (chi lo riceve e
 * chi lo versa sono le due squadre originarie dello scambio), quindi finché
 * la stagione non cambia questi giocatori non possono essere coinvolti in
 * un ALTRO scambio — anche dal presidente che li possiede a titolo
 * definitivo — o il meccanismo di conferma bonus (confermaEventoBonus)
 * perderebbe la squadra giusta a cui addebitarlo/accreditarlo.
 */
export function giocatoriConBonusAttivo(scambi: readonly Scambio[], season: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const s of scambi) {
    if (s.stato !== 'confermata' || s.season !== season || !s.avanzato) {
      continue;
    }
    for (const t of [...s.avanzato.terminiA, ...s.avanzato.terminiB]) {
      if ((t.bonus ?? []).length > 0) {
        ids.add(t.playerId);
      }
    }
  }
  return ids;
}

/** Rivalutazione di un singolo giocatore della parte più "povera" */
export interface PlayerRivalutazione {
  player: Player;
  valorePrima: number;
  aumento: number;
  valoreDopo: number;
}

/** Anteprima completa di una trattativa, prima di salvarla/confermarla */
export interface ScambioAnteprima {
  valoreTotaleA: number;
  valoreTotaleB: number;
  /** totale effettivo ceduto da ogni lato (giocatori + eventuale conguaglio) */
  totaleEffettivoA: number;
  totaleEffettivoB: number;
  /** lato i cui giocatori vengono rivalutati; null se già bilanciato */
  latoDaRivalutare: LatoScambio | null;
  /** importo complessivo della rivalutazione (0 se bilanciato) */
  aumentoComplessivo: number;
  /** dettaglio per ogni giocatore del lato da rivalutare */
  rivalutazioni: PlayerRivalutazione[];
  /** errore bloccante (selezioni mancanti, conguaglio non coerente...) */
  errore: string | null;
}

/** Somma dei V.A. dei giocatori selezionati di un lato */
function valoreLato(players: readonly Player[]): number {
  return round2(players.reduce((sum, p) => sum + (p.valoreAttuale || 0), 0));
}

/**
 * Calcola l'anteprima di uno scambio.
 *
 * @param playersA giocatori selezionati della squadra A
 * @param playersB giocatori selezionati della squadra B
 * @param conguaglio importo in € (>= 0)
 * @param pagatore squadra che paga il conguaglio (richiesto se conguaglio > 0)
 */
export function calcolaAnteprima(
  playersA: readonly Player[],
  playersB: readonly Player[],
  conguaglio: number,
  pagatore: LatoScambio | null,
): ScambioAnteprima {
  const valoreTotaleA = valoreLato(playersA);
  const valoreTotaleB = valoreLato(playersB);

  let errore: string | null = null;
  const totaleGiocatori = playersA.length + playersB.length;
  if (totaleGiocatori === 0) {
    errore = 'Seleziona almeno un giocatore da scambiare.';
  } else if (conguaglio < 0) {
    errore = 'Il conguaglio non può essere negativo.';
  } else if (conguaglio > 0 && !pagatore) {
    errore = 'Indica quale squadra paga il conguaglio.';
  } else if (
    (playersA.length === 0 || playersB.length === 0) &&
    !(conguaglio > 0 && pagatore)
  ) {
    // Vendita/acquisto di soli giocatori contro denaro: serve sapere chi paga
    errore =
      'Con una squadra che non cede giocatori serve un conguaglio (e il suo pagatore).';
  }

  // Totale effettivo ceduto da ogni lato (giocatori + eventuale conguaglio)
  let totaleEffettivoA = valoreTotaleA;
  let totaleEffettivoB = valoreTotaleB;
  if (!errore && conguaglio > 0 && pagatore) {
    if (pagatore === 'A') {
      totaleEffettivoA = round2(valoreTotaleA + conguaglio);
    } else {
      totaleEffettivoB = round2(valoreTotaleB + conguaglio);
    }
  }

  // La parte "più povera" alza i propri giocatori della differenza residua
  const differenza = round2(totaleEffettivoA - totaleEffettivoB);
  let latoDaRivalutare: LatoScambio | null = null;
  let aumentoComplessivo = 0;
  let rivalutazioni: PlayerRivalutazione[] = [];

  if (!errore && differenza !== 0) {
    const latoPovero: LatoScambio = differenza > 0 ? 'B' : 'A';
    const playersLatoPovero = latoPovero === 'A' ? playersA : playersB;

    // Se la parte più povera non ha giocatori (es. prezzo di vendita sotto il
    // valore del giocatore ceduto) non c'è nulla da rivalutare: la trattativa
    // resta valida ma i valori non cambiano.
    if (playersLatoPovero.length > 0) {
      latoDaRivalutare = latoPovero;
      aumentoComplessivo = Math.abs(differenza);
      rivalutazioni = distribuisciAumento(playersLatoPovero, aumentoComplessivo);
    }
  }

  return {
    valoreTotaleA,
    valoreTotaleB,
    totaleEffettivoA,
    totaleEffettivoB,
    latoDaRivalutare,
    aumentoComplessivo,
    rivalutazioni,
    errore,
  };
}

/**
 * Distribuisce `aumento` sui giocatori proporzionalmente alla quotazione
 * attuale. Le quote sono arrotondate a 1 decimale (convenzione V.A.);
 * il residuo di arrotondamento va al giocatore con quotazione più alta.
 * Chi finisce con lo stesso V.A. di prima (la propria quota era troppo
 * piccola per sopravvivere all'arrotondamento) non è considerato rivalutato:
 * mostrarlo come tale sarebbe fuorviante, e non c'è motivo di resettargli
 * la Q.I. (vedi patchGiocatore) per un valore che di fatto non cambia.
 */
function distribuisciAumento(
  players: readonly Player[],
  aumento: number,
): PlayerRivalutazione[] {
  const pesoTotale = players.reduce((s, p) => s + (p.quotazioneAttuale || 0), 0);
  const result: PlayerRivalutazione[] = players.map((p) => {
    const peso = pesoTotale > 0 ? (p.quotazioneAttuale || 0) / pesoTotale : 1 / players.length;
    return {
      player: p,
      valorePrima: p.valoreAttuale,
      aumento: round1(aumento * peso),
      valoreDopo: 0,
    };
  });

  // Residuo di arrotondamento → al giocatore con quotazione attuale più alta
  const sommaQuote = round2(result.reduce((s, r) => s + r.aumento, 0));
  const residuo = round2(aumento - sommaQuote);
  if (residuo !== 0) {
    const idxMax = result.reduce(
      (max, r, i) =>
        (r.player.quotazioneAttuale || 0) > (result[max].player.quotazioneAttuale || 0)
          ? i
          : max,
      0,
    );
    result[idxMax].aumento = round1(result[idxMax].aumento + residuo);
  }
  for (const r of result) {
    r.valoreDopo = Math.max(round1(r.valorePrima + r.aumento), MIN_VALORE);
  }
  return result.filter((r) => r.valoreDopo !== r.valorePrima);
}

/** Campi Firestore da aggiornare per un giocatore coinvolto in uno scambio */
export interface PlayerScambioPatch {
  valoreIniziale?: number;
  quotazioneIniziale?: number;
  valoreAttuale?: number;
  prossimaPercRinnovo?: number;
  prossimaSpesaRinnovo?: number;
}

/**
 * Patch da applicare a un giocatore coinvolto nello scambio:
 * - i giocatori che cambiano proprietà A TITOLO DEFINITIVO (scambio semplice,
 *   o lato "definitivo"/riscattato di uno scambio avanzato): prossimaPercRinnovo
 *   = 60%. Un prestito NON ancora riscattato non tocca questo campo — la
 *   squadra che possiede davvero il contratto (l'origine) resta quella che
 *   lo rinnoverà, il prestito è solo temporaneo;
 * - i giocatori RIVALUTATI: valoreIniziale = nuovo valore e
 *   quotazioneIniziale = quotazioneAttuale (il futuro V.A. seguirà le nuove
 *   quotazioni partendo dal nuovo valore, stessa meccanica del rinnovo).
 */
export function patchGiocatore(
  player: Player,
  rivalutazione?: PlayerRivalutazione,
  resettaPercRinnovo = true,
): PlayerScambioPatch {
  const patch: PlayerScambioPatch = {};
  if (resettaPercRinnovo) {
    patch.prossimaPercRinnovo = PERC_RINNOVO_SCAMBIO;
  }

  if (rivalutazione) {
    const nuovoValore = rivalutazione.valoreDopo;
    patch.valoreIniziale = nuovoValore;
    patch.quotazioneIniziale = player.quotazioneAttuale;
    patch.valoreAttuale = calcolaValoreAttuale(
      nuovoValore,
      player.quotazioneAttuale,
      player.quotazioneAttuale,
    );
  }

  patch.prossimaSpesaRinnovo = calcolaProssimaSpesaRinnovo(
    patch.valoreAttuale ?? player.valoreAttuale,
    patch.prossimaPercRinnovo ?? player.prossimaPercRinnovo,
  );
  return patch;
}
