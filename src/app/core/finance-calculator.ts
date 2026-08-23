import { SeasonFinanceComputed, SeasonFinanceInputs, TaxBracket } from './models';

/**
 * Arrotondamento ROUND HALF UP (come ROUND di Excel): le mezze cifre
 * si allontanano sempre da zero (2.5 → 3, -2.5 → -3). Math.round di JS
 * invece tronca i negativi verso +∞ (-2.5 → -2), quindi implementiamo
 * esplicitamente il half-away-from-zero con epsilon per i float.
 */
function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  const scaled = Math.abs(n) * factor;
  return (Math.sign(n) * Math.round(scaled + Number.EPSILON * scaled)) / factor;
}

/** Arrotonda a 2 decimali (come ROUND di Excel) */
export function round2(n: number): number {
  return roundTo(n, 2);
}

/**
 * Arrotonda a 1 decimale: è la convenzione dell'Excel ROSE.xlsx per
 * V.A. e spesa rinnovo dei giocatori (es. 5.018 → 5.0).
 */
export function round1(n: number): number {
  return roundTo(n, 1);
}

/** Valore minimo per V.A. e spesa rinnovo (mai 0) */
export const MIN_VALORE = 0.1;

/**
 * V.A. = valoreIniziale × (quotazioneAttuale / quotazioneIniziale)
 * Mai inferiore a MIN_VALORE (0.10 €).
 */
export function calcolaValoreAttuale(
  valoreIniziale: number,
  quotazioneIniziale: number,
  quotazioneAttuale: number,
): number {
  if (!Number.isFinite(valoreIniziale) || !quotazioneIniziale) {
    return MIN_VALORE;
  }
  return Math.max(round1(valoreIniziale * (quotazioneAttuale / quotazioneIniziale)), MIN_VALORE);
}

/** Prossima spesa rinnovo = valoreAttuale × prossimaPercRinnovo, minimo 0.10 € */
export function calcolaProssimaSpesaRinnovo(
  valoreAttuale: number,
  prossimaPercRinnovo: number,
): number {
  return Math.max(round1((valoreAttuale || 0) * (prossimaPercRinnovo || 0)), MIN_VALORE);
}

/**
 * Mappatura della prossima percentuale di rinnovo dopo un rinnovo.
 * Scala fissa: 0.85 → 1.15, 1.1 → 1.55, 1.45 → 2.15, 2.0 → 2.9.
 * Valori non presenti in mappa restano invariati (aggiornamento manuale).
 */
const PROSSIMA_PERC_MAP: Record<number, number> = {
 0.85: 1.15,
 1.1: 1.55,
 1.45: 2.15,
 2.0: 2.9,
};

export function prossimaPercentRinnovo(perce: number): number {
 const key = round2(perce);
 return PROSSIMA_PERC_MAP[key] ?? perce;
}

/** Valore rosa = somma dei V.A. di tutti i giocatori della squadra */
export function calcolaValoreRosa(players: ReadonlyArray<{ valoreAttuale: number }>): number {
  return round2(players.reduce((sum, p) => sum + (p.valoreAttuale || 0), 0));
}

/**
 * Spesa annuale =
 *   rinnovi + aste (sett + gen) + rescissioni + penali + trasferimentiUscita
 *   - trasferimentiEntrata - rimborsi
 */
export function calcolaSpesaAnnuale(i: SeasonFinanceInputs): number {
  return round2(
    i.rinnovi +
      i.acquistiMercatoInfrasettimanale +
      i.acquistiAstaSettembre +
      i.acquistiAstaGennaio +
      i.rescissioni +
      i.penali +
      i.trasferimentiUscita -
      i.trasferimentiEntrata -
      i.rimborsi,
  );
}

/**
 * Tassa progressiva a scaglioni (stile IRPEF).
 *
 * Gli scaglioni sono ordinati per bracketIndex crescente; per ogni scaglione k:
 *   se baseImponibile > soglia_k →
 *     imponibileScaglione = min(baseImponibile, soglia_{k+1}) - soglia_k
 *     tassa_k = imponibileScaglione × aliquota_k
 * L'ultimo scaglione è aperto (soglia superiore = +∞).
 */
export function calcolaTassaProgressiva(
  baseImponibile: number,
  brackets: ReadonlyArray<TaxBracket>,
): number {
  const sorted = [...brackets].sort((a, b) => a.bracketIndex - b.bracketIndex);
  let totale = 0;

  for (let k = 0; k < sorted.length; k++) {
    const sogliaInf = sorted[k].limiteSogliaEuro;
    const sogliaSup =
      k + 1 < sorted.length ? sorted[k + 1].limiteSogliaEuro : Number.POSITIVE_INFINITY;

    if (baseImponibile > sogliaInf) {
      const imponibileScaglione = Math.min(baseImponibile, sogliaSup) - sogliaInf;
      totale += imponibileScaglione * sorted[k].aliquota;
    }
  }
  return round2(totale);
}

export interface RisultatoTasse {
  tasse: number;
  taxMinimumHistoric: number;
}

/**
 * Ratchet fiscale: le tasse non possono mai scendere sotto il massimo
 * storico già pagato (taxMinimumHistoric). Se la tassa calcolata è
 * superiore, lo storico viene aggiornato.
 */
export function applicaTassaMinimaStorica(
  tassaCalcolata: number,
  taxMinimumHistoricPrecedente: number,
): RisultatoTasse {
  const storico = taxMinimumHistoricPrecedente || 0;
  const tasse = Math.max(tassaCalcolata, storico);
  return { tasse: round2(tasse), taxMinimumHistoric: round2(Math.max(tasse, storico)) };
}

/**
 * Spesa da versare =
 *   rinnovi
 *   + max(0, astaSettembre - indennizzoSettembre)
 *   + max(0, astaGennaio - indennizzoGennaio)
 *   + rescissioni + penali - rimborsi + tasse
 */
export function calcolaSpesaDaVersare(i: SeasonFinanceInputs, tasse: number): number {
  return round2(
    i.rinnovi +
      i.acquistiMercatoInfrasettimanale +
      Math.max(0, i.acquistiAstaSettembre - i.indennizzoSettembre) +
      Math.max(0, i.acquistiAstaGennaio - i.indennizzoGennaio) +
      i.rescissioni +
      i.penali -
      i.rimborsi +
      tasse,
  );
}

/** Spesa totale = spesaDaVersare + trasferimentiUscita */
export function calcolaSpesaTotale(spesaDaVersare: number, trasferimentiUscita: number): number {
  return round2(spesaDaVersare + trasferimentiUscita);
}

/** Soldi da versare = spesaDaVersare - soldiVersati */
export function calcolaSoldiDaVersare(spesaDaVersare: number, soldiVersati: number): number {
  return round2(spesaDaVersare - soldiVersati);
}

/** Bilancio societario stagionale = premi + trasferimentiEntrata - spesaTotale */
export function calcolaBilancioStagionale(
  premi: number,
  trasferimentiEntrata: number,
  spesaTotale: number,
): number {
  return round2(premi + trasferimentiEntrata - spesaTotale);
}

/**
 * Ricalcola in un colpo solo tutti i campi derivati della stagione.
 * Usato sia dal client (aggiornamento ottimistico) sia dalle Cloud Functions.
 */
export function ricalcolaFinance(
  inputs: SeasonFinanceInputs,
  brackets: ReadonlyArray<TaxBracket>,
  valoreRosa: number,
  taxMinimumHistoricPrecedente: number,
): SeasonFinanceComputed {
  const spesaAnnuale = calcolaSpesaAnnuale(inputs);
  const tassaCalcolata = calcolaTassaProgressiva(spesaAnnuale, brackets);
  const { tasse, taxMinimumHistoric } = applicaTassaMinimaStorica(
    tassaCalcolata,
    taxMinimumHistoricPrecedente,
  );

  const spesaDaVersare = calcolaSpesaDaVersare(inputs, tasse);
  const spesaTotale = calcolaSpesaTotale(spesaDaVersare, inputs.trasferimentiUscita);
  const soldiDaVersare = calcolaSoldiDaVersare(spesaDaVersare, inputs.soldiVersati);
  const bilancioSocietarioStagionale = calcolaBilancioStagionale(
    inputs.premi,
    inputs.trasferimentiEntrata,
    spesaTotale,
  );

  return {
    spesaAnnuale,
    tasse,
    spesaDaVersare,
    spesaTotale,
    soldiDaVersare,
    valoreRosa,
    bilancioSocietarioStagionale,
    taxMinimumHistoric,
  };
}