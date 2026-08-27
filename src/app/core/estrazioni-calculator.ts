/**
 * Logica pura (senza Firestore, senza UI) delle estrazioni di lega:
 * - sorteggio dei 2 gironi di Coppa (5 squadre ciascuno, casuale);
 * - "aiuti di stato" alle ultime in classifica (Regolamento, cap. 6).
 *
 * L'RNG è iniettabile (default Math.random) per rendere entrambe le
 * funzioni testabili in modo deterministico.
 */

export interface SquadraSorteggio {
  id: string;
  name: string;
}

export interface RisultatoGironi {
  gironeA: SquadraSorteggio[];
  gironeB: SquadraSorteggio[];
  /** ordine di estrazione (10 squadre, alternate A/B/A/B...): utile per rivelarle una alla volta in UI */
  ordine: SquadraSorteggio[];
}

/** Fisher-Yates con RNG iniettabile */
function mescola<T>(arr: readonly T[], rng: () => number): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * Sorteggio puramente casuale di 2 gironi da 5 squadre ciascuno (Coppa),
 * dalle 10 squadre di lega — nessuna fascia, nessun vincolo.
 */
export function sorteggiaGironi(
  squadre: readonly SquadraSorteggio[],
  rng: () => number = Math.random,
): RisultatoGironi {
  if (squadre.length !== 10) {
    throw new Error('Servono esattamente 10 squadre per formare 2 gironi da 5.');
  }
  // Alternanza A/B/A/B... sull'ordine mescolato: coerente con un'estrazione
  // dal vivo "una squadra alla volta", non con un taglio a metà mazzo.
  const mescolate = mescola(squadre, rng);
  return {
    gironeA: mescolate.filter((_, i) => i % 2 === 0),
    gironeB: mescolate.filter((_, i) => i % 2 === 1),
    ordine: mescolate,
  };
}

/**
 * Tabella ufficiale probabilità per posizione in classifica (Regolamento,
 * cap. 6 — Aiuti di stato): le ultime 7 si giocano i bonus, le prime 3
 * sono escluse a priori.
 */
export interface RigaProbabilitaAiuto {
  posizione: number;
  /** frazione 0-1 (45,50% → 0.455) */
  probabilita: number;
}
export const PROBABILITA_AIUTI_DI_STATO: readonly RigaProbabilitaAiuto[] = [
  { posizione: 10, probabilita: 0.455 },
  { posizione: 9, probabilita: 0.442 },
  { posizione: 8, probabilita: 0.055 },
  { posizione: 7, probabilita: 0.03 },
  { posizione: 6, probabilita: 0.013 },
  { posizione: 5, probabilita: 0.005 },
  { posizione: 4, probabilita: 0.001 },
] as const;

/**
 * Bonus assegnato a chi vince l'N-esima estrazione, in % del montepremi
 * della stagione precedente. Si giocano 6 bonus tra le 7 candidate: la
 * squadra che resta per ultima non vince nulla.
 */
export const BONUS_AIUTI_DI_STATO: readonly number[] = [
  0.0185, 0.0115, 0.0072, 0.0045, 0.0027, 0.0015,
] as const;

export interface SquadraInLotteria {
  teamId: string;
  teamName: string;
  posizione: number;
}

export interface VincitaAiutoDiStato extends SquadraInLotteria {
  /** 1 = prima estratta (bonus più alto) ... 6 = ultima a vincere qualcosa */
  ordineEstrazione: number;
  bonusPerc: number;
  bonusEuro: number;
}

export interface RisultatoAiutiDiStato {
  /** in ordine di estrazione: vincite[0] è la prima estratta (bonus più alto) */
  vincite: VincitaAiutoDiStato[];
  /** la squadra rimasta per ultima: nessun bonus */
  esclusa: SquadraInLotteria;
}

/**
 * Estrazione sequenziale degli aiuti di stato: a ogni turno si estrae UNA
 * squadra tra quelle ancora in lizza, con probabilità proporzionali ai pesi
 * originari delle squadre rimaste (rinormalizzati a ogni turno — vince al
 * massimo un bonus a testa, come da regolamento). Il turno N assegna il
 * bonus N-esimo di BONUS_AIUTI_DI_STATO; la settima squadra, mai estratta,
 * non vince nulla.
 */
export function estraiAiutiDiStato(
  squadre: readonly SquadraInLotteria[],
  montepremiPrecedente: number,
  rng: () => number = Math.random,
): RisultatoAiutiDiStato {
  if (squadre.length !== 7) {
    throw new Error('Servono esattamente le 7 squadre candidate (posizioni 4ª-10ª).');
  }
  const pesoDi = new Map(
    PROBABILITA_AIUTI_DI_STATO.map((r) => [r.posizione, r.probabilita] as const),
  );

  let rimaste = squadre.map((s) => ({ ...s, peso: pesoDi.get(s.posizione) ?? 0 }));
  const vincite: VincitaAiutoDiStato[] = [];

  for (let turno = 0; turno < BONUS_AIUTI_DI_STATO.length; turno++) {
    const totalePesi = rimaste.reduce((s, r) => s + r.peso, 0);
    let x = rng() * totalePesi;
    let scelta = rimaste[rimaste.length - 1];
    for (const r of rimaste) {
      x -= r.peso;
      if (x <= 0) {
        scelta = r;
        break;
      }
    }
    const bonusPerc = BONUS_AIUTI_DI_STATO[turno];
    vincite.push({
      teamId: scelta.teamId,
      teamName: scelta.teamName,
      posizione: scelta.posizione,
      ordineEstrazione: turno + 1,
      bonusPerc,
      bonusEuro: Math.round(bonusPerc * montepremiPrecedente * 100) / 100,
    });
    rimaste = rimaste.filter((r) => r.teamId !== scelta.teamId);
  }

  const esclusa = rimaste[0];
  return {
    vincite,
    esclusa: { teamId: esclusa.teamId, teamName: esclusa.teamName, posizione: esclusa.posizione },
  };
}
