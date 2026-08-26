import { DEFAULT_TAX_BRACKETS, EMPTY_FINANCE_INPUTS, SeasonFinance } from './models';
import {
  preparaAcquistoAsta,
  preparaReimborso,
  preparaRescissione,
  preparaRinnovo,
  preparaTrasferimento,
  primaSogliaMulte,
  residuoAlleMulte,
} from './finance-calculator';

/** Documento finanze completo di partenza, coi soli campi che servono ai test */
function finance(partial: Partial<SeasonFinance> = {}): SeasonFinance {
  return {
    ...EMPTY_FINANCE_INPUTS,
    spesaAnnuale: 0,
    tasse: 0,
    spesaDaVersare: 0,
    spesaTotale: 0,
    soldiDaVersare: 0,
    valoreRosa: 0,
    bilancioSocietarioStagionale: 0,
    taxMinimumHistoric: 0,
    ...partial,
  };
}

describe('finance-calculator: operazioni annullabili', () => {
  describe('preparaRinnovo', () => {
    it('senza documento precedente crea rinnovi da zero', () => {
      const { data, rinnovo } = preparaRinnovo(
        undefined,
        { valoreAttuale: 10 },
        0.85,
        50,
        DEFAULT_TAX_BRACKETS,
      );
      expect(rinnovo).toBe(8.5); // round1(0.85 × 10)
      expect(data.rinnovi).toBe(8.5);
      expect(data.valoreRosa).toBe(50);
    });

    it('somma al totale rinnovi esistente senza toccare le altre voci', () => {
      const current = finance({ rinnovi: 20, acquistiAstaSettembre: 5 });
      const { data, rinnovo } = preparaRinnovo(
        current,
        { valoreAttuale: 4 },
        1.1,
        30,
        DEFAULT_TAX_BRACKETS,
      );
      expect(rinnovo).toBe(4.4); // round1(1.1 × 4)
      expect(data.rinnovi).toBe(24.4);
      expect(data.acquistiAstaSettembre).toBe(5);
    });
  });

  describe('preparaReimborso', () => {
    it('somma rimborso e indennizzo di settembre alle voci corrette', () => {
      const { data, rimborso, indennizzo } = preparaReimborso(
        undefined,
        { acquistoRinnovoSpesa: 10, valoreAttuale: 8 },
        { percRimborso: 0.5, percIndennizzo: 0.2, mese: 'settembre' },
        40,
        DEFAULT_TAX_BRACKETS,
      );
      expect(rimborso).toBe(5); // 0.5 × 10
      expect(indennizzo).toBe(1.6); // 0.2 × 8
      expect(data.rimborsi).toBe(5);
      expect(data.indennizzoSettembre).toBe(1.6);
      expect(data.indennizzoGennaio).toBe(0);
    });

    it('accumula sulla voce di gennaio invece che su settembre', () => {
      const current = finance({ indennizzoGennaio: 3 });
      const { data } = preparaReimborso(
        current,
        { acquistoRinnovoSpesa: 4, valoreAttuale: 2 },
        { percRimborso: 0.25, percIndennizzo: 0.2, mese: 'gennaio' },
        20,
        DEFAULT_TAX_BRACKETS,
      );
      expect(data.indennizzoGennaio).toBe(3.4); // 3 + 0.2×2
      expect(data.indennizzoSettembre).toBe(0);
    });
  });

  describe('preparaRescissione', () => {
    it('somma il costo fisso alla voce rescissioni', () => {
      const current = finance({ rescissioni: 3 });
      const { data } = preparaRescissione(current, 1.5, 60, DEFAULT_TAX_BRACKETS);
      expect(data.rescissioni).toBe(4.5);
    });
  });

  describe('preparaAcquistoAsta', () => {
    it('somma alla voce di provenienza scelta', () => {
      const current = finance({ acquistiAstaSettembre: 10 });
      const { data } = preparaAcquistoAsta(
        current,
        'acquistiAstaSettembre',
        7.5,
        80,
        DEFAULT_TAX_BRACKETS,
      );
      expect(data.acquistiAstaSettembre).toBe(17.5);
    });

    it('non tocca le altre voci di spesa', () => {
      const current = finance({ acquistiAstaSettembre: 10, acquistiAstaGennaio: 2 });
      const { data } = preparaAcquistoAsta(
        current,
        'acquistiMercatoInfrasettimanale',
        3,
        80,
        DEFAULT_TAX_BRACKETS,
      );
      expect(data.acquistiMercatoInfrasettimanale).toBe(3);
      expect(data.acquistiAstaSettembre).toBe(10);
      expect(data.acquistiAstaGennaio).toBe(2);
    });
  });

  describe('preparaTrasferimento', () => {
    it('somma il conguaglio in uscita e ricalcola con la nuova rosa', () => {
      const data = preparaTrasferimento(
        undefined,
        'trasferimentiUscita',
        6,
        44,
        DEFAULT_TAX_BRACKETS,
      );
      expect(data.trasferimentiUscita).toBe(6);
      expect(data.valoreRosa).toBe(44);
    });
  });

  describe('primaSogliaMulte / residuoAlleMulte', () => {
    it('prende la soglia più bassa tra gli scaglioni', () => {
      expect(primaSogliaMulte(DEFAULT_TAX_BRACKETS)).toBe(437.15);
    });

    it('è positivo sotto soglia e negativo oltre soglia', () => {
      expect(residuoAlleMulte(300, DEFAULT_TAX_BRACKETS)).toBe(137.15);
      expect(residuoAlleMulte(500, DEFAULT_TAX_BRACKETS)).toBe(-62.85);
    });

    it('è zero se non ci sono scaglioni configurati', () => {
      expect(primaSogliaMulte([])).toBe(0);
    });
  });
});
