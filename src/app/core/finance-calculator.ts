import {
  EMPTY_FINANCE_INPUTS,
  SeasonFinance,
  SeasonFinanceComputed,
  SeasonFinanceInputs,
  TaxBracket,
} from './models';

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

/** Prima soglia (più bassa) degli scaglioni multa, es. 437.15 € */
export function primaSogliaMulte(brackets: ReadonlyArray<TaxBracket>): number {
  return brackets.length ? Math.min(...brackets.map((b) => b.limiteSogliaEuro)) : 0;
}

/**
 * Residuo alle multe = prima soglia − imponibile fairplay finanziario
 * (spesaAnnuale). Positivo finché la squadra resta sotto la prima soglia,
 * negativo (già in tassazione) altrimenti.
 */
export function residuoAlleMulte(
  spesaAnnuale: number,
  brackets: ReadonlyArray<TaxBracket>,
): number {
  return round2(primaSogliaMulte(brackets) - spesaAnnuale);
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

/** Parametri dell'operazione di rimborso di un giocatore */
export interface ReimborsoParams {
  percRimborso: number;
  percIndennizzo: number;
  mese: 'settembre' | 'gennaio';
}

export interface RiepilogoReimborso {
  rimborso: number;
  indennizzo: number;
}

/** Documento finanze completo, così come va scritto (merge parziale a monte già risolto) */
type FinanceDoc = SeasonFinanceInputs & SeasonFinanceComputed;

function mergeECalcola(
  current: SeasonFinance | undefined,
  patch: Partial<SeasonFinanceInputs>,
  brackets: ReadonlyArray<TaxBracket>,
  valoreRosa: number,
): FinanceDoc {
  const merged: SeasonFinanceInputs = { ...EMPTY_FINANCE_INPUTS, ...(current ?? {}), ...patch };
  return { ...merged, ...ricalcolaFinance(merged, brackets, valoreRosa, current?.taxMinimumHistoric ?? 0) };
}

/**
 * Prepara (pura, senza I/O) il documento finanze con un rimborso/indennizzo:
 * - rimborso   = % rimborso   × soldi spesi  → somma ai Rimborsi
 * - indennizzo = % indennizzo × V.A.         → somma agli Indennizzi
 *                 di settembre o gennaio (a scelta)
 */
export function preparaReimborso(
  current: SeasonFinance | undefined,
  player: { acquistoRinnovoSpesa: number; valoreAttuale: number },
  params: ReimborsoParams,
  valoreRosaAggiornato: number,
  brackets: ReadonlyArray<TaxBracket>,
): { data: FinanceDoc } & RiepilogoReimborso {
  const rimborso = round2(params.percRimborso * (player.acquistoRinnovoSpesa || 0));
  const indennizzo = round2(params.percIndennizzo * (player.valoreAttuale || 0));

  const data = mergeECalcola(
    current,
    {
      rimborsi: (current?.rimborsi ?? 0) + rimborso,
      ...(params.mese === 'settembre'
        ? { indennizzoSettembre: (current?.indennizzoSettembre ?? 0) + indennizzo }
        : { indennizzoGennaio: (current?.indennizzoGennaio ?? 0) + indennizzo }),
    },
    brackets,
    valoreRosaAggiornato,
  );

  return { data, rimborso, indennizzo };
}

/**
 * Prepara (pura, senza I/O) il documento finanze con un rinnovo:
 * rinnovo = % rinnovo applicata × V.A. del giocatore → somma ai Rinnovi.
 */
export function preparaRinnovo(
  current: SeasonFinance | undefined,
  player: { valoreAttuale: number },
  nuovaPercRinnovo: number,
  valoreRosa: number,
  brackets: ReadonlyArray<TaxBracket>,
): { data: FinanceDoc; rinnovo: number } {
  const rinnovo = round1(nuovaPercRinnovo * (player.valoreAttuale || 0));
  const data = mergeECalcola(
    current,
    { rinnovi: (current?.rinnovi ?? 0) + rinnovo },
    brackets,
    valoreRosa,
  );
  return { data, rinnovo };
}

/**
 * Prepara (pura, senza I/O) il documento finanze con un costo di
 * rescissione (es. 1,50 € fissi all'eliminazione di un giocatore).
 */
export function preparaRescissione(
  current: SeasonFinance | undefined,
  importo: number,
  valoreRosa: number,
  brackets: ReadonlyArray<TaxBracket>,
): { data: FinanceDoc } {
  const data = mergeECalcola(
    current,
    { rescissioni: (current?.rescissioni ?? 0) + importo },
    brackets,
    valoreRosa,
  );
  return { data };
}

/**
 * Prepara (pura, senza I/O) il documento finanze con un acquisto d'asta:
 * +importo sulla voce di provenienza (asta sett / infrasettimanale / gen).
 */
export function preparaAcquistoAsta(
  current: SeasonFinance | undefined,
  campo: 'acquistiAstaSettembre' | 'acquistiMercatoInfrasettimanale' | 'acquistiAstaGennaio',
  importo: number,
  valoreRosa: number,
  brackets: ReadonlyArray<TaxBracket>,
): { data: FinanceDoc } {
  const data = mergeECalcola(
    current,
    { [campo]: (current?.[campo] ?? 0) + importo },
    brackets,
    valoreRosa,
  );
  return { data };
}

/**
 * Prepara (pura, senza I/O) il documento finanze con un trasferimento
 * legato a uno scambio: +importo su trasferimentiUscita/trasferimentiEntrata.
 */
export function preparaTrasferimento(
  current: SeasonFinance | undefined,
  campo: 'trasferimentiUscita' | 'trasferimentiEntrata',
  importo: number,
  valoreRosa: number,
  brackets: ReadonlyArray<TaxBracket>,
): FinanceDoc {
  return mergeECalcola(
    current,
    { [campo]: round2((current?.[campo] ?? 0) + importo) },
    brackets,
    valoreRosa,
  );
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