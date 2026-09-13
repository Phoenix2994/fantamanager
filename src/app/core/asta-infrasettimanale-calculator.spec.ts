import { calcolaFaseInfrasettimanale, calcolaInfoFaseInfrasettimanale } from './asta-infrasettimanale-calculator';
import { AstaInfrasettimanaleConfig } from './models';

/**
 * Costruisce l'istante UTC corrispondente alle ore:minuti locali di Roma in
 * un giorno dato — settembre è CEST (+02:00): 2026-09-01 è verificatamente
 * un martedì, così i giorni successivi seguono in ordine naturale.
 */
function romaUtc(giorno: number, ora: number, minuto = 0): Date {
  return new Date(Date.UTC(2026, 8, giorno, ora - 2, minuto));
}

const CONFIG: AstaInfrasettimanaleConfig = {
  abilitata: true,
  inizioChiamata: { giorno: 2, ora: '10:00' }, // martedì
  inizioSoloRilanci: { giorno: 2, ora: '17:00' },
  inizioBuste: { giorno: 3, ora: '00:00' }, // mercoledì
  inizioAssegnazione: { giorno: 3, ora: '14:00' },
};

describe('calcolaFaseInfrasettimanale', () => {
  it('è "disabilitata" se manca la configurazione', () => {
    expect(calcolaFaseInfrasettimanale(undefined, romaUtc(1, 12))).toBe('disabilitata');
  });

  it('è "disabilitata" se abilitata=false, a prescindere dall’ora', () => {
    expect(calcolaFaseInfrasettimanale({ ...CONFIG, abilitata: false }, romaUtc(1, 12))).toBe(
      'disabilitata',
    );
  });

  it('è "chiamata" da martedì 10:00 fino a (esclusa) le 17:00', () => {
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(1, 10, 0))).toBe('chiamata');
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(1, 16, 59))).toBe('chiamata');
  });

  it('prima delle 10:00 di martedì non è ancora "chiamata"', () => {
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(1, 9, 59))).not.toBe('chiamata');
  });

  it('è "soloRilanci" dalle 17:00 di martedì a mezzanotte', () => {
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(1, 17, 0))).toBe('soloRilanci');
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(1, 23, 59))).toBe('soloRilanci');
  });

  it('è "buste" da mezzanotte alle 14:00 di mercoledì', () => {
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(2, 0, 0))).toBe('buste');
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(2, 13, 59))).toBe('buste');
  });

  it('è "assegnazione" dalle 14:00 di mercoledì fino alla chiamata successiva', () => {
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(2, 14, 0))).toBe('assegnazione');
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(6, 12, 0))).toBe('assegnazione'); // domenica
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(8, 9, 59))).toBe('assegnazione'); // martedì succ., appena prima
    expect(calcolaFaseInfrasettimanale(CONFIG, romaUtc(8, 10, 0))).toBe('chiamata'); // il ciclo ricomincia
  });
});

describe('calcolaInfoFaseInfrasettimanale', () => {
  it('senza config, ritorna solo "disabilitata" senza fine/faseSuccessiva', () => {
    expect(calcolaInfoFaseInfrasettimanale(undefined, romaUtc(1, 12))).toEqual({
      fase: 'disabilitata',
    });
  });

  it('in "chiamata", finisce a inizioSoloRilanci e la fase successiva è "soloRilanci"', () => {
    expect(calcolaInfoFaseInfrasettimanale(CONFIG, romaUtc(1, 12))).toEqual({
      fase: 'chiamata',
      fine: CONFIG.inizioSoloRilanci,
      faseSuccessiva: 'soloRilanci',
    });
  });

  it('in "soloRilanci", finisce a inizioBuste e la fase successiva è "buste"', () => {
    expect(calcolaInfoFaseInfrasettimanale(CONFIG, romaUtc(1, 20))).toEqual({
      fase: 'soloRilanci',
      fine: CONFIG.inizioBuste,
      faseSuccessiva: 'buste',
    });
  });

  it('in "buste", finisce a inizioAssegnazione e la fase successiva è "assegnazione"', () => {
    expect(calcolaInfoFaseInfrasettimanale(CONFIG, romaUtc(2, 5))).toEqual({
      fase: 'buste',
      fine: CONFIG.inizioAssegnazione,
      faseSuccessiva: 'assegnazione',
    });
  });

  it('in "assegnazione", finisce a inizioChiamata (della settimana dopo) e la fase successiva è "chiamata"', () => {
    expect(calcolaInfoFaseInfrasettimanale(CONFIG, romaUtc(2, 15))).toEqual({
      fase: 'assegnazione',
      fine: CONFIG.inizioChiamata,
      faseSuccessiva: 'chiamata',
    });
  });
});
