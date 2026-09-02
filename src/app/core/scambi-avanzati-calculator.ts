import { MIN_VALORE, round2 } from './finance-calculator';
import { LatoScambio } from './scambi-calculator';

/**
 * Logica pura degli scambi AVANZATI (prestiti + bonus), nessuna dipendenza
 * da Firebase — stessa filosofia di scambi-calculator.ts, che gestisce
 * invece i giocatori a titolo definitivo puri.
 *
 * Porting FEDELE (non una riscrittura "a spirito") dell'algoritmo storico
 * della lega, verificato a mano con tre casi reali forniti dalla lega — vedi
 * scambi-avanzati-calculator.spec.ts, che li usa come test esatti al
 * centesimo:
 *  - un giocatore in prestito 12 mesi pagato 40€ (V.A. < 50€) diventa 50€;
 *  - tre giocatori (1 definitivo + 2 prestiti) pagati 40€ diventano
 *    6,59€ / 53,95€ / 14,79€;
 *  - un caso completo con riscatto e bonus, verificato riga per riga contro
 *    il codice originale: due giocatori (uno riscattato con 2 bonus, uno
 *    definitivo) scambiati con un terzo (prestito non riscattato con bonus)
 *    più un conguaglio: 181,73€ / 9,71€ / 45,29€.
 *
 * Non ho la "spec" originale (i commenti nel codice storico rimandano a una
 * numerazione — 2.3.1, 2.3.1.1... — che non è nel repository), quindi
 * questo file rispecchia esattamente cosa fa il codice, non necessariamente
 * perché lo fa: ogni blocco è commentato con a cosa corrisponde nel
 * sorgente originale, per poterlo correggere in futuro se emergono altri
 * casi che non tornano.
 *
 * ============================================================================
 * PANORAMICA (due passaggi)
 * ============================================================================
 * PASSAGGIO 1 — sempre eseguito. Confronta il "peso" dei due lati (costo
 *   atteso dei giocatori ceduti, scontato per i prestiti, + conguaglio). Il
 *   lato che pesa meno vede i propri giocatori ceduti salire di valore, per
 *   pareggiare — la differenza si divide in DUE surplus separati:
 *     - surplus di VALORE, ripartito per QUOTAZIONE INIZIALE (QI);
 *     - surplus di BONUS atteso, ripartito per il BONUS proprio di ciascun
 *       giocatore (o anche lui per QI, in un caso particolare — vedi sotto).
 *   La quota di ciascun giocatore viene poi "riportata a pieno" moltiplicata
 *   per un fattore che dipende dal suo contratto (vedi fattoreDistribuzione).
 *
 * PASSAGGIO 2 — SOLO se almeno un giocatore coinvolto ha un riscatto attivo
 *   (obbligo, o diritto già esercitato) con una cifra pattuita. Il valore
 *   del passaggio 1 viene riproiettato sulla QUOTAZIONE FINALE (proiezione
 *   di fine stagione, stessa formula del V.A. normale: valore×QF/QI), poi
 *   corretto per pareggiare bonus e riscatti non ancora considerati,
 *   ripartito in proporzione alla QF del giocatore sul totale QF della sua
 *   squadra.
 */

// ---------------------------------------------------------------- contratti

export type TipoContratto =
  | 'definitivo'
  | 'prestito'
  | 'prestitoDiritto'
  | 'prestitoObbligo';

/** Durate di prestito ammesse (mesi) */
export const DURATE_PRESTITO = [3, 6, 9, 12] as const;
export type DurataPrestito = (typeof DURATE_PRESTITO)[number];

/** Sconto fisso applicato al costo di un prestito non riscattato */
export const SCONTO_PRESTITO = 0.8;

// -------------------------------------------------------------------- bonus

/** Bonus "a eventi": si stima un numero di eventi attesi × ricompensa a evento */
export const TIPI_BONUS_EVENTI = ['gol', 'assist'] as const;
/**
 * Bonus "a soglia": ricompensa fissa una tantum se il conteggio (presenze,
 * gol) o la media (voto/fantavoto) supera la soglia. "gol" compare anche
 * sopra tra i bonus a evento — stesso tipo statistico, due modalità di
 * pagamento diverse; il discriminante è la struttura del bonus (vedi
 * isBonusEventi), non l'appartenenza di `tipo` a questa lista.
 */
export const TIPI_BONUS_SOGLIA = ['presenze', 'voto', 'fantavoto', 'gol'] as const;
export type TipoBonusEventi = (typeof TIPI_BONUS_EVENTI)[number];
export type TipoBonusSoglia = (typeof TIPI_BONUS_SOGLIA)[number];
export type TipoBonus = TipoBonusEventi | TipoBonusSoglia;

export interface BonusEventi {
  id: string;
  tipo: TipoBonusEventi;
  /** eventi stimati al momento dell'accordo (usati nel calcolo iniziale) */
  eventiAttesi: number;
  /** eventi realmente confermati dall'admin finora (usati nel ricalcolo) */
  eventiVerificati: number;
  /** ricompensa in € per ogni singolo evento */
  rewardPerEvento: number;
}

export interface BonusSoglia {
  id: string;
  tipo: TipoBonusSoglia;
  /** media (voto o fantavoto) sopra la quale scatta il bonus */
  soglia: number;
  /** true se l'admin ha confermato che la soglia è stata superata */
  verificato: boolean;
  /** ricompensa fissa, una tantum, se la soglia viene superata */
  rewardUnaTantum: number;
}

export type BonusAtteso = BonusEventi | BonusSoglia;

export function isBonusEventi(b: BonusAtteso): b is BonusEventi {
  return 'eventiAttesi' in b;
}

/** Valore atteso di un bonus AL MOMENTO DELL'ACCORDO (usa la stima iniziale) */
export function valoreBonusAtteso(b: BonusAtteso): number {
  return isBonusEventi(b) ? b.eventiAttesi * b.rewardPerEvento : b.verificato ? b.rewardUnaTantum : 0;
}

/**
 * Valore REALIZZATO di un bonus finora (usa solo ciò che l'admin ha
 * confermato essersi davvero verificato) — usato nel ricalcolo.
 */
export function valoreBonusRealizzato(b: BonusAtteso): number {
  return isBonusEventi(b) ? b.eventiVerificati * b.rewardPerEvento : b.verificato ? b.rewardUnaTantum : 0;
}

// ---------------------------------------------------------------- giocatore

/** Giocatore coinvolto in una trattativa avanzata */
export interface GiocatoreAvanzato {
  id: string;
  name: string;
  ruolo: string;
  valoreAttuale: number;
  /** quotazione iniziale (QI) */
  quotazioneAttuale: number;
  /** quotazione finale proiettata (QF, fine stagione) — vedi Passaggio 2 */
  quotazioneFinale: number;
  tipoContratto: TipoContratto;
  /** obbligatoria per tipoContratto diverso da 'definitivo' */
  durataPrestito?: DurataPrestito;
  /** solo per 'prestitoDiritto': se il diritto è già stato esercitato */
  riscattato?: boolean;
  /** cifra pattuita per il riscatto ('prestitoObbligo', o 'prestitoDiritto' con riscattato = true) */
  cifraRiscatto?: number;
  bonus?: readonly BonusAtteso[];
}

/** true se il giocatore diventa (o è già) di proprietà piena: definitivo, obbligo, o diritto esercitato */
function eProprietaPiena(g: Pick<GiocatoreAvanzato, 'tipoContratto' | 'riscattato'>): boolean {
  return (
    g.tipoContratto === 'definitivo' ||
    g.tipoContratto === 'prestitoObbligo' ||
    (g.tipoContratto === 'prestitoDiritto' && g.riscattato === true)
  );
}

/**
 * Fattore di ACCUMULO: quanto pesa questo giocatore nel totale della sua
 * squadra (sia per il confronto dei due lati, sia come base "value" da cui
 * parte la sua rivalutazione). 1 se di proprietà piena; altrimenti
 * (durata/12) × 0,8 — sconto e proporzione alla durata del prestito.
 * Corrisponde a come il codice storico accumula team.value.
 */
export function fattoreAccumulo(
  g: Pick<GiocatoreAvanzato, 'tipoContratto' | 'durataPrestito' | 'riscattato'>,
): number {
  if (eProprietaPiena(g)) {
    return 1;
  }
  const durata = g.durataPrestito ?? 12;
  return (durata / 12) * SCONTO_PRESTITO;
}

/**
 * Fattore di DISTRIBUZIONE: moltiplicatore che "riporta a pieno" la quota
 * di surplus assegnata a questo giocatore. NON è il reciproco del fattore
 * di accumulo — anche un giocatore di proprietà piena (riscattato/obbligo)
 * ha un fattore diverso da 1 se la durata del prestito non era 12 mesi
 * (verificato sul caso reale col riscatto: fattore 12/durata, SENZA lo
 * sconto 0,8 che invece si applica solo ai prestiti non riscattati).
 */
export function fattoreDistribuzione(
  g: Pick<GiocatoreAvanzato, 'tipoContratto' | 'durataPrestito' | 'riscattato'>,
): number {
  if (g.tipoContratto === 'definitivo') {
    return 1;
  }
  const durata = g.durataPrestito ?? 12;
  return eProprietaPiena(g) ? 12 / durata : 12 / durata / SCONTO_PRESTITO;
}

/** Cifra di riscatto da conteggiare per questo giocatore (0 se non pertinente) */
function cifraRiscattoGiocatore(g: GiocatoreAvanzato): number {
  const contaRiscatto =
    g.tipoContratto === 'prestitoObbligo' ||
    (g.tipoContratto === 'prestitoDiritto' && g.riscattato === true);
  return contaRiscatto ? g.cifraRiscatto ?? 0 : 0;
}

/** Somma dei bonus (attesi o realizzati, secondo `valoreDi`) di un giocatore */
function sommaBonus(g: GiocatoreAvanzato, valoreDi: (b: BonusAtteso) => number): number {
  return (g.bonus ?? []).reduce((s, b) => s + valoreDi(b), 0);
}

// ------------------------------------------------------------- aggregato lato

interface LatoAggregato {
  giocatori: readonly GiocatoreAvanzato[];
  /** conguaglio versato da questo lato (0 se non paga) */
  conguaglio: number;
  /** somma dei costi attesi (fattoreAccumulo × V.A.) dei giocatori ceduti da questo lato + il proprio conguaglio */
  peso: number;
  /** somma dei bonus attesi sui giocatori CEDUTI da questo lato (li dovrà versare chi li riceve) */
  bonusTotale: number;
  /** somma delle cifre di riscatto sui giocatori CEDUTI da questo lato */
  repaidTotale: number;
  /** somma delle quotazioni iniziali dei giocatori ceduti da questo lato */
  quotTotale: number;
  /** somma delle quotazioni finali dei giocatori ceduti da questo lato */
  finalQuotTotale: number;
  /** "valore finale" intermedio dopo il passaggio 1 (vedi calcolaFinalValueLato) */
  finalValue: number;
}

function aggregaLato(
  giocatori: readonly GiocatoreAvanzato[],
  conguaglioProprio: number,
  valoreBonusDi: (b: BonusAtteso) => number,
): LatoAggregato {
  let peso = conguaglioProprio;
  let bonusTotale = 0;
  let repaidTotale = 0;
  let quotTotale = 0;
  let finalQuotTotale = 0;
  for (const g of giocatori) {
    peso += (g.valoreAttuale || 0) * fattoreAccumulo(g);
    bonusTotale += sommaBonus(g, valoreBonusDi);
    if (g.tipoContratto === 'prestitoDiritto' && g.riscattato === true) {
      repaidTotale += g.cifraRiscatto ?? 0;
    } else if (g.tipoContratto === 'prestitoObbligo') {
      repaidTotale += g.cifraRiscatto ?? 0;
    }
    quotTotale += g.quotazioneAttuale || 0;
    finalQuotTotale += g.quotazioneFinale || 0;
  }
  return {
    giocatori,
    conguaglio: conguaglioProprio,
    peso: round2(peso),
    bonusTotale: round2(bonusTotale),
    repaidTotale: round2(repaidTotale),
    quotTotale,
    finalQuotTotale,
    finalValue: 0, // valorizzato dopo il passaggio 1, vedi calcolaFinalValueLato
  };
}

/**
 * "Valore finale" di un lato dopo il passaggio 1: NON è la somma dei valori
 * mostrati ai giocatori, ma il conguaglio proprio + la somma dei
 * getPlayerMaxValue (il maggiore tra V.A. originale e valore post-passaggio-1)
 * ripassati per lo STESSO fattore di accumulo dello sconto prestiti — serve
 * solo come termine di confronto per il passaggio 2, porting fedele delle
 * righe 205-260 del codice storico.
 */
function calcolaFinalValueLato(risultatiPass1: readonly RivalutazioneAvanzata[], conguaglioProprio: number): number {
  const somma = risultatiPass1.reduce((s, r) => {
    const maxVal = Math.max(r.valorePrima, r.valoreDopo);
    return s + fattoreAccumulo(r.giocatore) * maxVal;
  }, 0);
  return round2(conguaglioProprio + somma);
}

// --------------------------------------------------------------- risultato

export interface RivalutazioneAvanzata {
  giocatore: GiocatoreAvanzato;
  valorePrima: number;
  valoreDopo: number;
  /** true se il valore è stato limitato dal tetto bonus (vedi calcolaScambioAvanzatoConTetto) */
  tettoBonusRaggiunto?: boolean;
}

export interface ScambioAvanzatoAnteprima {
  pesoA: number;
  pesoB: number;
  bonusA: number;
  bonusB: number;
  repaidA: number;
  repaidB: number;
  /** valori finali di TUTTI i giocatori coinvolti (non solo quelli rivalutati) */
  risultati: RivalutazioneAvanzata[];
  errore: string | null;
}

/**
 * Calcola l'anteprima/il ricalcolo di uno scambio avanzato (prestiti + bonus).
 *
 * @param giocatoriA giocatori ceduti dalla squadra A
 * @param giocatoriB giocatori ceduti dalla squadra B
 * @param conguaglioA conguaglio versato da A (0 se non paga)
 * @param conguaglioB conguaglio versato da B (0 se non paga)
 * @param faseIniziale true (default) per il calcolo alla creazione della
 *   trattativa (usa i bonus ATTESI); false per il ricalcolo dopo che
 *   l'admin ha confermato uno o più eventi (usa i bonus REALIZZATI finora)
 */
export function calcolaScambioAvanzato(
  giocatoriA: readonly GiocatoreAvanzato[],
  giocatoriB: readonly GiocatoreAvanzato[],
  conguaglioA: number,
  conguaglioB: number,
  faseIniziale = true,
): ScambioAvanzatoAnteprima {
  let errore: string | null = null;
  if (giocatoriA.length + giocatoriB.length === 0) {
    errore = 'Seleziona almeno un giocatore da scambiare.';
  } else if (conguaglioA < 0 || conguaglioB < 0) {
    errore = 'Il conguaglio non può essere negativo.';
  } else {
    for (const g of [...giocatoriA, ...giocatoriB]) {
      if (g.tipoContratto !== 'definitivo' && !g.durataPrestito) {
        errore = `Indica la durata del prestito per ${g.name}.`;
        break;
      }
    }
  }
  if (errore) {
    return {
      pesoA: 0,
      pesoB: 0,
      bonusA: 0,
      bonusB: 0,
      repaidA: 0,
      repaidB: 0,
      risultati: [],
      errore,
    };
  }

  const valoreBonusDi = faseIniziale ? valoreBonusAtteso : valoreBonusRealizzato;
  const latoA = aggregaLato(giocatoriA, conguaglioA, valoreBonusDi);
  const latoB = aggregaLato(giocatoriB, conguaglioB, valoreBonusDi);

  // ---------------- PASSAGGIO 1 ----------------
  // Il lato con peso maggiore normalmente resta invariato; quello con peso
  // minore assorbe la differenza (corretta per il divario di bonus/riscatti
  // altrui) — corrisponde a getFirstTeam/getSecondTeam nel codice storico.
  const [bigger, smaller, biggerÈA] =
    latoA.peso >= latoB.peso ? ([latoA, latoB, true] as const) : ([latoB, latoA, false] as const);

  const biggerFinal = pass1Bigger(bigger, smaller, valoreBonusDi);
  const smallerFinal = pass1Smaller(bigger, smaller, valoreBonusDi);

  let risultatiA = biggerÈA ? biggerFinal : smallerFinal;
  let risultatiB = biggerÈA ? smallerFinal : biggerFinal;

  // Il valore finale non scende mai sotto il valore attuale (stesso vincolo
  // del codice storico, riga 194-203)
  risultatiA = risultatiA.map((r) => ({ ...r, valoreDopo: Math.max(r.valoreDopo, r.valorePrima) }));
  risultatiB = risultatiB.map((r) => ({ ...r, valoreDopo: Math.max(r.valoreDopo, r.valorePrima) }));

  latoA.finalValue = calcolaFinalValueLato(risultatiA, latoA.conguaglio);
  latoB.finalValue = calcolaFinalValueLato(risultatiB, latoB.conguaglio);

  // ---------------- PASSAGGIO 2 ----------------
  // Solo se almeno un lato ha un riscatto attivo (repaidTotale > 0):
  // riproietta sulla quotazione finale e corregge per il divario residuo.
  if (latoA.repaidTotale !== 0 || latoB.repaidTotale !== 0) {
    risultatiA = pass2Lato(risultatiA, latoA, latoB);
    risultatiB = pass2Lato(risultatiB, latoB, latoA);
  }

  return {
    pesoA: latoA.peso,
    pesoB: latoB.peso,
    bonusA: latoA.bonusTotale,
    bonusB: latoB.bonusTotale,
    repaidA: latoA.repaidTotale,
    repaidB: latoB.repaidTotale,
    risultati: [...risultatiA, ...risultatiB],
    errore: null,
  };
}

/**
 * Lato "più pesante": di norma invariato, a meno che il divario di bonus
 * altrui non ribalti il confronto — corrisponde a getFirstTeam.
 *
 * Questo ramo scatta SOLO grazie al bonus proprio del lato "bigger": a
 * parità di bonus tra i due lati, un peso maggiore resta sempre invariato
 * per costruzione (bigger.peso >= smaller.peso). Il divario è quindi
 * interamente "bonus atteso da questo lato", non un surplus di valore
 * puro — va perciò attribuito a CHI il bonus lo realizza davvero
 * (proporzionalmente al proprio bonus), non spalmato per quotazione come
 * farebbe un surplus di valore (vedi distribuisciPerBonusProprio).
 */
function pass1Bigger(
  bigger: LatoAggregato,
  smaller: LatoAggregato,
  valoreBonusDi: (b: BonusAtteso) => number,
): RivalutazioneAvanzata[] {
  const invariato = bigger.peso + smaller.bonusTotale > smaller.peso + bigger.bonusTotale;
  if (invariato) {
    return bigger.giocatori.map((g) => ({ giocatore: g, valorePrima: g.valoreAttuale, valoreDopo: g.valoreAttuale }));
  }
  const divarioValore = smaller.peso + bigger.bonusTotale - bigger.peso - smaller.bonusTotale;
  return distribuisciPerBonusProprio(bigger.giocatori, divarioValore, bigger.bonusTotale, valoreBonusDi);
}

/**
 * Lato "più leggero": assorbe la differenza — corrisponde a getSecondTeam.
 * Due surplus separati (valore per QI, bonus per bonus proprio O per QI a
 * seconda del confronto tra i bonus dei due lati — vedi intestazione file).
 */
function pass1Smaller(
  bigger: LatoAggregato,
  smaller: LatoAggregato,
  valoreBonusDi: (b: BonusAtteso) => number,
): RivalutazioneAvanzata[] {
  const divarioValore = bigger.peso - smaller.peso;
  const divarioBonus = smaller.bonusTotale - bigger.bonusTotale;
  const bonusPropioVince = smaller.bonusTotale > bigger.bonusTotale;

  return smaller.giocatori.map((g) => {
    const quotaValore = smaller.quotTotale > 0 ? (divarioValore * (g.quotazioneAttuale || 0)) / smaller.quotTotale : 0;

    let quotaBonus: number;
    if (bonusPropioVince) {
      const bonusProprio = sommaBonus(g, valoreBonusDi);
      quotaBonus = smaller.bonusTotale > 0 ? (divarioBonus * bonusProprio) / smaller.bonusTotale : 0;
    } else {
      quotaBonus = smaller.quotTotale > 0 ? (divarioBonus * (g.quotazioneAttuale || 0)) / smaller.quotTotale : 0;
    }

    const aumento = fattoreDistribuzione(g) * (quotaValore + quotaBonus);
    return {
      giocatore: g,
      valorePrima: g.valoreAttuale,
      valoreDopo: round2((g.valoreAttuale || 0) + aumento),
    };
  });
}

/** Ripartisce un divario (sempre >= 0 se questo ramo è raggiunto) sui giocatori per il bonus PROPRIO di ciascuno — vedi pass1Bigger */
function distribuisciPerBonusProprio(
  giocatori: readonly GiocatoreAvanzato[],
  divario: number,
  bonusTotale: number,
  valoreBonusDi: (b: BonusAtteso) => number,
): RivalutazioneAvanzata[] {
  return giocatori.map((g) => {
    const bonusProprio = sommaBonus(g, valoreBonusDi);
    const quota = bonusTotale > 0 ? (divario * bonusProprio) / bonusTotale : 0;
    return {
      giocatore: g,
      valorePrima: g.valoreAttuale,
      valoreDopo: round2((g.valoreAttuale || 0) + quota),
    };
  });
}

/**
 * Passaggio 2 per un lato: riproietta ogni giocatore sulla QF (quotazione
 * finale) e corregge per il divario residuo di bonus/riscatti — porting
 * fedele riga per riga del blocco "2.3.1" del codice storico (righe
 * 262-513 di tool.service.ts), che ha SEI formule diverse a seconda di tre
 * confronti a livello di squadra. Non ho la spec originale che la
 * numerazione dei commenti richiama, quindi ho verificato numericamente i
 * due rami raggiunti dai casi reali forniti dalla lega (vedi
 * scambi-avanzati-calculator.spec.ts); gli altri quattro sono trascritti
 * fedelmente dal sorgente ma non ancora verificati con un caso reale — se
 * un domani un ricalcolo sembra sbagliato, è il primo posto da controllare.
 */
function pass2Lato(
  risultatiPass1: readonly RivalutazioneAvanzata[],
  proprio: LatoAggregato,
  altro: LatoAggregato,
): RivalutazioneAvanzata[] {
  if (proprio.finalQuotTotale === 0) {
    return [...risultatiPass1];
  }

  // Scarto calcolato sul PESO GREZZO (pre-passaggio-1) dei due lati — usato
  // dai rami "2.3.1" (quando il proprio lato non è stato toccato dal
  // passaggio 1) e come confronto ausiliario negli altri rami.
  const scarto1 =
    proprio.peso + altro.bonusTotale + altro.repaidTotale - altro.peso - proprio.bonusTotale - proprio.repaidTotale;
  // Scarto calcolato sul valore POST-passaggio-1 dei due lati — usato dai
  // rami "2.3.1.2".
  const scarto2 =
    proprio.finalValue +
    altro.bonusTotale +
    altro.repaidTotale -
    altro.finalValue -
    proprio.bonusTotale -
    proprio.repaidTotale;

  // A1: il proprio lato non è stato rivalutato dal passaggio 1 (peso grezzo
  // e valore post-passaggio-1 coincidono esattamente)
  const a1 = proprio.peso === proprio.finalValue;
  // pesoFavorevole: il proprio lato pesa già di più (grezzo) dell'altro,
  // conteggiando anche i bonus/riscatti reciproci — stessa espressione
  // usata sia dentro il ramo A1 sia come confronto interno nel ramo B2.
  const pesoFavorevole = scarto1 > 0;
  // valoreFinaleFavorevole: come sopra ma sul valore POST-passaggio-1.
  const valoreFinaleFavorevole = scarto2 > 0;

  return risultatiPass1.map((r) => {
    const g = r.giocatore;
    const value = g.valoreAttuale;
    const maxVal = Math.max(value, r.valoreDopo);
    const quot = g.quotazioneAttuale || 1;
    const finalQuot = g.quotazioneFinale || 0;

    const trendValore = (value / quot) * finalQuot;
    const trendMaxVal = (maxVal / quot) * finalQuot;
    const correzione1 = (scarto1 * finalQuot) / proprio.finalQuotTotale;
    const correzione2 = (scarto2 * finalQuot) / proprio.finalQuotTotale;
    /** il "tetto": riproiezione del valore massimo, meno la parte di rivalutazione già assorbita dal passaggio 1 */
    const tetto = trendMaxVal - (maxVal - value);
    const conTetto = tetto < trendValore ? trendValore : tetto;

    let finalValue: number;
    if (a1) {
      // ---- 2.3.1 ----
      finalValue = pesoFavorevole ? trendValore : trendMaxVal - correzione1;
    } else if (valoreFinaleFavorevole) {
      // ---- 2.3.1.2, ramo favorevole ----
      if (pesoFavorevole) {
        finalValue = conTetto;
      } else {
        const capSuperato = correzione2 > maxVal - value;
        if (capSuperato) {
          finalValue = conTetto;
        } else {
          const candidato = trendMaxVal - correzione2;
          finalValue = candidato < trendValore ? trendValore : candidato;
        }
      }
    } else {
      // ---- 2.3.1.2, ramo sfavorevole ----
      finalValue = trendMaxVal - correzione2;
    }

    return { giocatore: g, valorePrima: value, valoreDopo: Math.max(round2(finalValue), MIN_VALORE) };
  });
}

// ---------------------------------------------------------- tetto bonus

/** Copia di un giocatore senza alcun bonus — usata solo per isolare quanto
 * del suo valore finale dipende dai bonus (vedi calcolaScambioAvanzatoConTetto) */
function giocatoreSenzaBonus(g: GiocatoreAvanzato): GiocatoreAvanzato {
  return { ...g, bonus: [] };
}

/**
 * Ripartisce un eccesso (sempre >= 0) tra TUTTI i giocatori del lato, in
 * proporzione alla loro quotazione iniziale — stessa meccanica di
 * distribuisciPerBonusProprio, ma per quotazione anziché bonus e aggiunta
 * SOPRA un valore già calcolato
 * invece che a partire dal V.A. grezzo.
 *
 * Include anche i giocatori che hanno già raggiunto il tetto: possono
 * risalire di nuovo tramite questa quota di redistribuzione (il tetto
 * limita solo il contributo DIRETTO del proprio bonus, non fa da soffitto
 * assoluto). Se il giocatore col bonus in eccesso è l'unico ceduto dal suo
 * lato, l'intero eccesso torna a lui per questa via — il tetto in quel caso
 * non ha effetto, per costruzione: non c'è nessun altro "coinvolto" su cui
 * spalmarlo.
 */
function ridistribuisciEccesso(
  risultati: readonly RivalutazioneAvanzata[],
  eccesso: number,
): RivalutazioneAvanzata[] {
  if (eccesso <= 0) {
    return [...risultati];
  }
  const quotTotale = risultati.reduce((s, r) => s + (r.giocatore.quotazioneAttuale || 0), 0);
  return risultati.map((r) => {
    const quota = quotTotale > 0 ? (eccesso * (r.giocatore.quotazioneAttuale || 0)) / quotTotale : eccesso / risultati.length;
    return { ...r, valoreDopo: round2(r.valoreDopo + quota) };
  });
}

/**
 * Applica il tetto bonus regolamentare: "un giocatore può al massimo
 * raddoppiare il proprio valore tramite bonus (calcolato sul valore
 * post-trattativa, senza bonus)". Il tetto limita solo il contributo
 * DIRETTO del bonus: oltre quel limite, l'eccesso si ridistribuisce per
 * quotazione iniziale tra TUTTI i giocatori ceduti dallo stesso lato
 * (compreso lui) — quindi il giocatore può comunque risalire ulteriormente
 * tramite questa quota, non è un tetto assoluto sul valore finale. Se è
 * l'unico giocatore ceduto da quel lato, l'intero eccesso torna a lui per
 * questa via: il tetto in quel caso non ha alcun effetto pratico, perché
 * non c'è nessun altro "coinvolto" con cui pareggiare — comportamento
 * confermato dalla lega, non un limite dell'implementazione.
 *
 * Implementato come un guscio ATTORNO a calcolaScambioAvanzato (calcolato
 * due volte: con e senza bonus, per isolare esattamente il valore dovuto ai
 * bonus) invece che dentro il motore stesso, per non toccare l'algoritmo
 * storico già verificato coi tre casi reali (vedi gli spec in fondo al
 * file). Per il tetto NON ci sono casi reali della lega da cui partire: gli
 * esempi di test sono costruiti e verificati a mano, non storici.
 */
export function calcolaScambioAvanzatoConTetto(
  giocatoriA: readonly GiocatoreAvanzato[],
  giocatoriB: readonly GiocatoreAvanzato[],
  conguaglioA: number,
  conguaglioB: number,
  faseIniziale = true,
): ScambioAvanzatoAnteprima {
  const conBonus = calcolaScambioAvanzato(giocatoriA, giocatoriB, conguaglioA, conguaglioB, faseIniziale);
  if (conBonus.errore) {
    return conBonus;
  }
  const senzaBonus = calcolaScambioAvanzato(
    giocatoriA.map(giocatoreSenzaBonus),
    giocatoriB.map(giocatoreSenzaBonus),
    conguaglioA,
    conguaglioB,
    faseIniziale,
  );
  if (senzaBonus.errore) {
    return conBonus;
  }
  const baselinePerId = new Map(senzaBonus.risultati.map((r) => [r.giocatore.id, r.valoreDopo] as const));

  function applicaTettoLato(giocatoriLato: readonly GiocatoreAvanzato[]): RivalutazioneAvanzata[] {
    const idsLato = new Set(giocatoriLato.map((g) => g.id));
    let eccessoTotale = 0;
    const cappati = conBonus.risultati
      .filter((r) => idsLato.has(r.giocatore.id))
      .map((r) => {
        const baseline = baselinePerId.get(r.giocatore.id) ?? r.valorePrima;
        const tetto = round2(baseline * 2);
        if (r.valoreDopo > tetto) {
          eccessoTotale = round2(eccessoTotale + (r.valoreDopo - tetto));
          return { ...r, valoreDopo: tetto, tettoBonusRaggiunto: true };
        }
        return { ...r, tettoBonusRaggiunto: false };
      });
    return ridistribuisciEccesso(cappati, eccessoTotale);
  }

  return {
    ...conBonus,
    risultati: [...applicaTettoLato(giocatoriA), ...applicaTettoLato(giocatoriB)],
  };
}

// -------------------------------------------------------- helper esterni

/** true se questo giocatore, alla conferma dello scambio, si sposta FISICAMENTE nella rosa di chi lo riceve */
export function siSpostaSubito(g: Pick<GiocatoreAvanzato, 'tipoContratto'>): boolean {
  // Tutti i tipi di contratto comportano il trasferimento in rosa (anche il
  // prestito semplice): il rientro alla squadra d'origine è sempre un
  // passo MANUALE dell'admin, mai automatico — vedi doc del progetto.
  void g;
  return true;
}

/** Etichetta leggibile del tipo di contratto, per la UI */
export function etichettaContratto(tipo: TipoContratto): string {
  switch (tipo) {
    case 'definitivo':
      return 'Titolo definitivo';
    case 'prestito':
      return 'Prestito';
    case 'prestitoDiritto':
      return 'Prestito (diritto di riscatto)';
    case 'prestitoObbligo':
      return 'Prestito (obbligo di riscatto)';
  }
}

export type LatoScambioAvanzato = LatoScambio;
