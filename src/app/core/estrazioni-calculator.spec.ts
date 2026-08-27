import {
  BONUS_AIUTI_DI_STATO,
  PROBABILITA_AIUTI_DI_STATO,
  RisultatoAiutiDiStato,
  SquadraInLotteria,
  estraiAiutiDiStato,
  sorteggiaGironi,
} from './estrazioni-calculator';

const DIECI_SQUADRE = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `Squadra ${i}` }));

// Ordinate per posizione crescente (4ª...10ª), come nella tabella del regolamento
const SETTE_CANDIDATE: SquadraInLotteria[] = [
  { teamId: 'jonica', teamName: 'S.S. Jonica 106', posizione: 4 },
  { teamId: 'nicaragua', teamName: 'Nicaragua Pacamara Gigante', posizione: 5 },
  { teamId: 'ciaccati', teamName: 'Ac. Ciaccati', posizione: 6 },
  { teamId: 'dashaus', teamName: 'Das Haus', posizione: 7 },
  { teamId: 'granchi', teamName: 'Granchi Avatori', posizione: 8 },
  { teamId: 'phoenix', teamName: 'Phoenix', posizione: 9 },
  { teamId: 'barurumon', teamName: 'Loco Barurumon', posizione: 10 },
];

/** Verifica le invarianti strutturali comuni a QUALUNQUE esito valido, a prescindere dall'RNG */
function verificaInvarianti(risultato: RisultatoAiutiDiStato): void {
  expect(risultato.vincite.length).toBe(6);
  expect(risultato.vincite.map((v) => v.ordineEstrazione)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(risultato.vincite.map((v) => v.bonusPerc)).toEqual([...BONUS_AIUTI_DI_STATO]);

  const idVincitori = risultato.vincite.map((v) => v.teamId);
  expect(new Set(idVincitori).size).toBe(6); // nessuna squadra vince due volte
  expect(idVincitori).not.toContain(risultato.esclusa.teamId); // l'esclusa non è tra le vincitrici

  const tuttiGliId = [...idVincitori, risultato.esclusa.teamId].sort();
  expect(tuttiGliId).toEqual(SETTE_CANDIDATE.map((s) => s.teamId).sort()); // nessuno perso o duplicato
}

describe('estrazioni-calculator', () => {
  describe('sorteggiaGironi', () => {
    it('rifiuta un numero di squadre diverso da 10', () => {
      expect(() => sorteggiaGironi(DIECI_SQUADRE.slice(0, 9))).toThrowError();
    });

    it('divide sempre in due gironi da 5, senza perdere o duplicare squadre', () => {
      let i = 0;
      const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.6, 0.4, 0.8, 0.05];
      const rng = () => seq[i++ % seq.length];
      const { gironeA, gironeB } = sorteggiaGironi(DIECI_SQUADRE, rng);
      expect(gironeA.length).toBe(5);
      expect(gironeB.length).toBe(5);
      const tuttiGliId = [...gironeA, ...gironeB].map((s) => s.id).sort();
      expect(tuttiGliId).toEqual(DIECI_SQUADRE.map((s) => s.id).sort());
    });

    it('è deterministico: lo stesso RNG produce sempre lo stesso risultato', () => {
      const r1 = sorteggiaGironi(DIECI_SQUADRE, () => 0.42);
      const r2 = sorteggiaGironi(DIECI_SQUADRE, () => 0.42);
      expect([...r1.gironeA, ...r1.gironeB].map((s) => s.id)).toEqual(
        [...r2.gironeA, ...r2.gironeB].map((s) => s.id),
      );
    });
  });

  describe('estraiAiutiDiStato', () => {
    it('rifiuta un numero di squadre diverso da 7', () => {
      expect(() => estraiAiutiDiStato(SETTE_CANDIDATE.slice(0, 6), 1000)).toThrowError();
    });

    it('con rng=0 sceglie sempre la prima squadra ancora in lizza (ordine di lista)', () => {
      // x = 0: il primo peso positivo incontrato nel ciclo fa già scattare la scelta,
      // quindi ad ogni turno vince chi è rimasto per primo nell'array originale.
      const risultato = estraiAiutiDiStato(SETTE_CANDIDATE, 2591.75, () => 0);
      verificaInvarianti(risultato);
      expect(risultato.vincite.map((v) => v.posizione)).toEqual([4, 5, 6, 7, 8, 9]);
      expect(risultato.esclusa.posizione).toBe(10);
    });

    it('con rng vicino a 1 la prima estrazione premia la squadra col peso più alto (10ª)', () => {
      // x = rng * totale finisce nell'ultima fetta della torta: al primo turno
      // l'ultimo elemento della lista è la 10ª posizione, quella col peso maggiore.
      const risultato = estraiAiutiDiStato(SETTE_CANDIDATE, 2591.75, () => 0.999999);
      verificaInvarianti(risultato);
      expect(risultato.vincite[0].posizione).toBe(10);
    });

    it('calcola il bonus in € come percentuale del montepremi precedente', () => {
      const risultato = estraiAiutiDiStato(SETTE_CANDIDATE, 2591.75, () => 0);
      // prima estrazione: 1.85% di 2591.75 = 47.947... → 47.95
      expect(risultato.vincite[0].bonusEuro).toBeCloseTo(47.95, 2);
      // seconda: 1.15% di 2591.75 = 29.805125 → 29.81
      expect(risultato.vincite[1].bonusEuro).toBeCloseTo(29.81, 2);
      // ultima (sesta): 0.15% di 2591.75 = 3.89
      expect(risultato.vincite[5].bonusEuro).toBeCloseTo(3.89, 2);
    });

    it('la somma delle probabilità della tabella ufficiale fa ~100%', () => {
      const totale = PROBABILITA_AIUTI_DI_STATO.reduce((s, r) => s + r.probabilita, 0);
      expect(totale).toBeCloseTo(1, 2);
    });
  });
});
