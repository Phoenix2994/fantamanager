import { eEleggibilePerBusta, squadreDaAggiungereAEleggibili } from './asta-infrasettimanale-eleggibilita-busta';

describe('eEleggibilePerBusta', () => {
  it('è eleggibile chi compare già nell’elenco', () => {
    const asta = { rilanciatoDaTeamId: 'akatsuki', squadreEleggibiliBusta: ['phoenix', 'akatsuki'] };
    expect(eEleggibilePerBusta('phoenix', asta)).toBe(true);
    expect(eEleggibilePerBusta('akatsuki', asta)).toBe(true);
  });

  it('non è eleggibile chi non è né in elenco né è l’attuale rilanciante (elenco non vuoto)', () => {
    const asta = { rilanciatoDaTeamId: 'akatsuki', squadreEleggibiliBusta: ['phoenix'] };
    expect(eEleggibilePerBusta('dynamo-cocito', asta)).toBe(false);
  });

  it('se nessuno ha mai rilanciato in fase 2 (elenco vuoto), l’attuale rilanciante (leader di fine fase 1) è comunque eleggibile', () => {
    const asta = { rilanciatoDaTeamId: 'phoenix', squadreEleggibiliBusta: [] as string[] };
    expect(eEleggibilePerBusta('phoenix', asta)).toBe(true);
  });

  it('con elenco vuoto, chi NON è il rilanciante non è eleggibile', () => {
    const asta = { rilanciatoDaTeamId: 'phoenix', squadreEleggibiliBusta: [] as string[] };
    expect(eEleggibilePerBusta('akatsuki', asta)).toBe(false);
  });
});

describe('squadreDaAggiungereAEleggibili', () => {
  it('al primo rilancio di fase 2 (elenco ancora vuoto), aggiunge sia il leader di fine fase 1 sia il nuovo rilanciante', () => {
    const asta = { rilanciatoDaTeamId: 'phoenix', squadreEleggibiliBusta: [] as string[] };
    expect(squadreDaAggiungereAEleggibili(asta, 'akatsuki')).toEqual(['phoenix', 'akatsuki']);
  });

  it('ai rilanci successivi (elenco già non vuoto), aggiunge solo il nuovo rilanciante', () => {
    const asta = { rilanciatoDaTeamId: 'akatsuki', squadreEleggibiliBusta: ['phoenix', 'akatsuki'] };
    expect(squadreDaAggiungereAEleggibili(asta, 'dynamo-cocito')).toEqual(['dynamo-cocito']);
  });
});
