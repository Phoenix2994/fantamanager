import { Player } from './models';
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
  return result;
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
 * - TUTTI i giocatori coinvolti: prossimaPercRinnovo = 60%;
 * - i giocatori RIVALUTATI: valoreIniziale = nuovo valore e
 *   quotazioneIniziale = quotazioneAttuale (il futuro V.A. seguirà le nuove
 *   quotazioni partendo dal nuovo valore, stessa meccanica del rinnovo).
 */
export function patchGiocatore(
  player: Player,
  rivalutazione?: PlayerRivalutazione,
): PlayerScambioPatch {
  const patch: PlayerScambioPatch = {
    prossimaPercRinnovo: PERC_RINNOVO_SCAMBIO,
  };

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
    PERC_RINNOVO_SCAMBIO,
  );
  return patch;
}
