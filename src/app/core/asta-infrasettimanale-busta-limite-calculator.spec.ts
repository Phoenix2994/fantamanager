import { puoInviareBusta, slotNuoveBusteDisponibili } from './asta-infrasettimanale-busta-limite-calculator';

describe('puoInviareBusta', () => {
  it('3 slot liberi, in testa altrove in 1 asta: 2 buste su giocatori diversi + 1 illimitata su quello che vince', () => {
    const base = { giocatoriInRosa: 25, astePosseduteAltrove: 1, staGiaVincendoQuesta: false };
    expect(puoInviareBusta({ ...base, busteEsistentiSuAltriNonVinti: 0 })).toBe(true); // 1a busta su altro
    expect(puoInviareBusta({ ...base, busteEsistentiSuAltriNonVinti: 1 })).toBe(true); // 2a busta su altro
    expect(puoInviareBusta({ ...base, busteEsistentiSuAltriNonVinti: 2 })).toBe(false); // 3a busta su altro: bloccata
    // sul giocatore che sta già vincendo, sempre consentita, a prescindere dal conteggio
    expect(
      puoInviareBusta({ ...base, staGiaVincendoQuesta: true, busteEsistentiSuAltriNonVinti: 5 }),
    ).toBe(true);
  });

  it('1 slot libero, in testa altrove in 1 asta: nessuna busta su altri, solo su quello che vince', () => {
    expect(
      puoInviareBusta({
        giocatoriInRosa: 27,
        astePosseduteAltrove: 1,
        staGiaVincendoQuesta: false,
        busteEsistentiSuAltriNonVinti: 0,
      }),
    ).toBe(false);
    expect(
      puoInviareBusta({
        giocatoriInRosa: 27,
        astePosseduteAltrove: 1,
        staGiaVincendoQuesta: true,
        busteEsistentiSuAltriNonVinti: 0,
      }),
    ).toBe(true);
  });

  it('1 slot libero, in testa altrove in 0 aste: 1 busta a scelta su un giocatore qualsiasi', () => {
    const base = { giocatoriInRosa: 27, astePosseduteAltrove: 0, staGiaVincendoQuesta: false };
    expect(puoInviareBusta({ ...base, busteEsistentiSuAltriNonVinti: 0 })).toBe(true);
    expect(puoInviareBusta({ ...base, busteEsistentiSuAltriNonVinti: 1 })).toBe(false);
  });

  it('aggiornare l’importo di una busta già presentata non consuma un nuovo slot (il chiamante esclude quella corrente dal conteggio)', () => {
    // Se lo slot è esattamente pieno con le buste esistenti (esclusa quella che si sta per riscrivere),
    // la riscrittura della busta corrente resta comunque consentita.
    expect(
      puoInviareBusta({
        giocatoriInRosa: 26,
        astePosseduteAltrove: 0,
        staGiaVincendoQuesta: false,
        busteEsistentiSuAltriNonVinti: 1, // l'altra busta, non quella che si sta aggiornando
      }),
    ).toBe(true);
  });

  it('zero slot liberi (rosa piena o sovra-impegnata): nessuna busta nuova, solo su chi si sta già vincendo', () => {
    expect(
      puoInviareBusta({
        giocatoriInRosa: 28,
        astePosseduteAltrove: 0,
        staGiaVincendoQuesta: false,
        busteEsistentiSuAltriNonVinti: 0,
      }),
    ).toBe(false);
    expect(
      puoInviareBusta({
        giocatoriInRosa: 20,
        astePosseduteAltrove: 8,
        staGiaVincendoQuesta: false,
        busteEsistentiSuAltriNonVinti: 0,
      }),
    ).toBe(false);
  });
});

describe('slotNuoveBusteDisponibili', () => {
  it('calcola slot liberi meno aste già possedute altrove, mai sotto zero', () => {
    expect(slotNuoveBusteDisponibili(25, 1)).toBe(2);
    expect(slotNuoveBusteDisponibili(27, 1)).toBe(0);
    expect(slotNuoveBusteDisponibili(27, 0)).toBe(1);
    expect(slotNuoveBusteDisponibili(20, 8)).toBe(0);
  });
});
