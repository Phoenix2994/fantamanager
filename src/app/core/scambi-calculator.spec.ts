import { ContractType, Scambio, ScambioStato, TerminiGiocatoreAvanzato } from './models';
import { Player } from './models';
import {
  PERC_RINNOVO_SCAMBIO,
  calcolaAnteprima,
  giocatoriConBonusAttivo,
  patchGiocatore,
  possedutoATitoloDefinitivo,
} from './scambi-calculator';

/** Factory di un giocatore con i soli campi usati dai calcoli dello scambio */
function player(
  id: string,
  valoreAttuale: number,
  quotazioneAttuale: number,
  contractType: ContractType = 'TITOLO DEFINITIVO',
): Player {
  return {
    id,
    name: `Giocatore ${id}`,
    ruolo: 'Cc',
    contractType,
    acquistoRinnovoSpesa: 0,
    prossimaPercRinnovo: 1.1,
    prossimaSpesaRinnovo: 0,
    quotazioneIniziale: quotazioneAttuale,
    quotazioneAttuale,
    valoreIniziale: valoreAttuale,
    valoreAttuale,
  };
}

/** Factory di una trattativa avanzata, con i soli campi usati da giocatoriConBonusAttivo */
function scambioAvanzato(
  stato: ScambioStato,
  season: string,
  terminiA: TerminiGiocatoreAvanzato[],
  terminiB: TerminiGiocatoreAvanzato[] = [],
): Scambio {
  return {
    id: 's1',
    season,
    squadraA: { teamId: 'a', playerIds: [], ownerUid: null },
    squadraB: { teamId: 'b', playerIds: [], ownerUid: null },
    conguaglio: 0,
    conguaglioPagante: null,
    stato,
    snapshot: {
      nomeSquadraA: 'A',
      nomeSquadraB: 'B',
      giocatoriA: [],
      giocatoriB: [],
      valoreTotaleA: 0,
      valoreTotaleB: 0,
      rivalutazioni: [],
    },
    avanzato: {
      terminiA,
      terminiB,
      conguaglioA: 0,
      conguaglioB: 0,
    },
  };
}

/** Termini minimi per un giocatore in una trattativa avanzata */
function termini(playerId: string, bonusCount: number): TerminiGiocatoreAvanzato {
  return {
    playerId,
    tipoContratto: 'definitivo',
    quotazioneFinale: 10,
    bonus: bonusCount > 0
      ? Array.from({ length: bonusCount }, (_, i) => ({
          id: `b${i}`,
          tipo: 'gol' as const,
          eventiAttesi: 5,
          eventiVerificati: 0,
          rewardPerEvento: 1,
        }))
      : [],
  };
}

describe('scambi-calculator', () => {
  describe('calcolaAnteprima', () => {
    it("riproduce l'esempio concordato: p1 da 5 € + conguaglio 6 € contro p2 da 20 € → p1 sale a 14 €", () => {
      const a = [player('p1', 5, 50)];
      const b = [player('p2', 20, 20)];

      const anteprima = calcolaAnteprima(a, b, 6, 'A');

      expect(anteprima.errore).toBeNull();
      expect(anteprima.totaleEffettivoA).toBe(11); // 5 + 6
      expect(anteprima.totaleEffettivoB).toBe(20);
      expect(anteprima.latoDaRivalutare).toBe('A');
      expect(anteprima.aumentoComplessivo).toBe(9);
      expect(anteprima.rivalutazioni.length).toBe(1);
      expect(anteprima.rivalutazioni[0].aumento).toBe(9);
      expect(anteprima.rivalutazioni[0].valoreDopo).toBe(14);
    });

    it('non rivaluta nulla se i valori sono già bilanciati senza conguaglio', () => {
      const anteprima = calcolaAnteprima([player('a', 10, 10)], [player('b', 10, 10)], 0, null);

      expect(anteprima.errore).toBeNull();
      expect(anteprima.latoDaRivalutare).toBeNull();
      expect(anteprima.rivalutazioni.length).toBe(0);
    });

    it('senza conguaglio la parte più povera sale della differenza esatta', () => {
      const anteprima = calcolaAnteprima(
        [player('a1', 4, 40), player('a2', 3, 30)],
        [player('b1', 12, 12)],
        0,
        null,
      );

      expect(anteprima.latoDaRivalutare).toBe('A');
      expect(anteprima.aumentoComplessivo).toBe(5);
      // Ripartizione proporzionale alle quotazioni attuali (40 e 30),
      // arrotondata a 1 decimale come da convenzione V.A.
      const a1 = anteprima.rivalutazioni.find((r) => r.player.id === 'a1')!;
      const a2 = anteprima.rivalutazioni.find((r) => r.player.id === 'a2')!;
      expect(a1.aumento).toBe(2.9); // round1(5 × 40/70)
      expect(a2.aumento).toBe(2.1); // round1(5 × 30/70)
      // Il bilancio resta pareggiato anche dopo gli arrotondamenti
      const sommaNuova =
        a1.valoreDopo + a2.valoreDopo;
      expect(sommaNuova).toBe(12);
    });

    it('il residuo di arrotondamento viene assorbito mantenendo il totale', () => {
      // Quote teoriche da 10 € su tre giocatori con stessa quotazione: 3.3+3.3+3.3
      // = 9.9 → residuo 0.1 assegnato al primo (quotazione più alta a parità).
      const a = [
        player('a1', 1, 33),
        player('a2', 1, 33),
        player('a3', 1, 33),
      ];
      const b = [player('b1', 13, 100)];

      const anteprima = calcolaAnteprima(a, b, 0, null);

      expect(anteprima.aumentoComplessivo).toBe(10);
      const sommaAumenti = anteprima.rivalutazioni.reduce((s, r) => s + r.aumento, 0);
      expect(sommaAumenti).toBeCloseTo(10, 5);
      const sommaNuova = anteprima.rivalutazioni.reduce((s, r) => s + r.valoreDopo, 0);
      expect(sommaNuova).toBe(13);
    });

    it('un giocatore la cui quota si arrotonda a 0 non compare tra i rivalutati', () => {
      // a1 ha una quotazione enormemente più alta di a2: quasi tutto l'aumento
      // (1 €) va a lui, la quota di a2 si arrotonda a 0.0 — non è "rivalutato"
      // (mostrarlo sarebbe un falso "prima → dopo" con lo stesso numero).
      const a = [player('a1', 5, 999), player('a2', 5, 1)];
      const b = [player('b1', 11, 11)];

      const anteprima = calcolaAnteprima(a, b, 0, null);

      expect(anteprima.aumentoComplessivo).toBe(1);
      expect(anteprima.rivalutazioni.length).toBe(1);
      expect(anteprima.rivalutazioni[0].player.id).toBe('a1');
      expect(anteprima.rivalutazioni.some((r) => r.player.id === 'a2')).toBe(false);
    });

    it('se paga il conguaglio la parte più ricca, la rivalutazione copre tutto lo scambio', () => {
      const a = [player('a1', 5, 50)];
      const b = [player('b1', 20, 20)];

      // B cede 20 di giocatori + 6 di conguaglio = 26; A cede solo p1,
      // che quindi deve salire fino a 26 per pareggiare i conti.
      const anteprima = calcolaAnteprima(a, b, 6, 'B');

      expect(anteprima.totaleEffettivoA).toBe(5);
      expect(anteprima.totaleEffettivoB).toBe(26);
      expect(anteprima.latoDaRivalutare).toBe('A');
      expect(anteprima.rivalutazioni[0].valoreDopo).toBe(26);
    });

    it('segnala errore se una squadra non cede giocatori e non c\u2019è conguaglio', () => {
      const anteprima = calcolaAnteprima([], [player('b1', 10, 10)], 0, null);
      expect(anteprima.errore).toContain('conguaglio');
    });

    it('segnala errore con conguaglio positivo ma senza pagatore', () => {
      const anteprima = calcolaAnteprima(
        [player('a1', 5, 50)],
        [player('b1', 20, 20)],
        6,
        null,
      );
      expect(anteprima.errore).toContain('conguaglio');
    });

    it('vendita per soli soldi: il valore del giocatore sale alla cifra incassata', () => {
      // A vende p1 (V.A. 5) a B per 10 €: B cede solo denaro.
      const a = [player('p1', 5, 50)];
      const anteprima = calcolaAnteprima(a, [], 10, 'B');

      expect(anteprima.errore).toBeNull();
      expect(anteprima.totaleEffettivoA).toBe(5);
      expect(anteprima.totaleEffettivoB).toBe(10); // solo conguaglio
      expect(anteprima.latoDaRivalutare).toBe('A');
      expect(anteprima.rivalutazioni[0].valoreDopo).toBe(10); // 5 → 10
    });

    it('vendita a cifra inferiore al valore: nessuna rivalutazione ma trattativa valida', () => {
      const a = [player('p1', 5, 50)];
      const anteprima = calcolaAnteprima(a, [], 3, 'B');

      expect(anteprima.errore).toBeNull();
      expect(anteprima.latoDaRivalutare).toBeNull(); // la parte povera è B, senza giocatori
      expect(anteprima.rivalutazioni.length).toBe(0);
    });

    it('una trattativa completamente vuota non è valida', () => {
      const anteprima = calcolaAnteprima([], [], 0, null);
      expect(anteprima.errore).toContain('almeno un giocatore');
    });
  });

  describe('patchGiocatore', () => {
    it('imposta la percentuale di prossimo rinnovo al 60% per tutti', () => {
      const p = player('p1', 10, 100);
      const patch = patchGiocatore(p);

      expect(patch.prossimaPercRinnovo).toBe(PERC_RINNOVO_SCAMBIO);
      expect(patch.valoreIniziale).toBeUndefined();
      expect(patch.valoreAttuale).toBeUndefined();
      // Spesa rinnovo ricalcolata sul V.A. invariato
      expect(patch.prossimaSpesaRinnovo).toBeCloseTo(10 * PERC_RINNOVO_SCAMBIO, 1);
    });

    it('per i rivalutati: valoreIniziale = nuovo valore e Q.I. = Q.A.', () => {
      const p = player('p1', 5, 50);
      const anteprima = calcolaAnteprima([p], [player('p2', 20, 20)], 6, 'A');
      const patch = patchGiocatore(p, anteprima.rivalutazioni[0]);

      expect(patch.valoreIniziale).toBe(14);
      expect(patch.quotazioneIniziale).toBe(50); // = quotazioneAttuale
      // V.A. = 14 × (50/50) = 14
      expect(patch.valoreAttuale).toBe(14);
      expect(patch.prossimaPercRinnovo).toBe(0.6);
      expect(patch.prossimaSpesaRinnovo).toBeCloseTo(14 * 0.6, 1);
    });

    it('con resettaPercRinnovo=false (prestito non riscattato) non tocca la percentuale', () => {
      const p = player('p1', 10, 100); // prossimaPercRinnovo di fabbrica: 1.1
      const patch = patchGiocatore(p, undefined, false);

      expect(patch.prossimaPercRinnovo).toBeUndefined();
      // Spesa rinnovo ricalcolata sulla percentuale ESISTENTE del giocatore, non sul 60%
      expect(patch.prossimaSpesaRinnovo).toBeCloseTo(10 * 1.1, 1);
    });

    it('con resettaPercRinnovo=false ma rivalutato: valore cambia, percentuale no', () => {
      const p = player('p1', 5, 50);
      const anteprima = calcolaAnteprima([p], [player('p2', 20, 20)], 6, 'A');
      const patch = patchGiocatore(p, anteprima.rivalutazioni[0], false);

      expect(patch.valoreIniziale).toBe(14);
      expect(patch.prossimaPercRinnovo).toBeUndefined();
      // Spesa rinnovo sul nuovo V.A. (14) ma con la percentuale esistente (1.1), non 60%
      expect(patch.prossimaSpesaRinnovo).toBeCloseTo(14 * 1.1, 1);
    });
  });

  describe('possedutoATitoloDefinitivo', () => {
    it('vero per titolo definitivo (anche recompra)', () => {
      expect(possedutoATitoloDefinitivo(player('p1', 10, 100, 'TITOLO DEFINITIVO'))).toBe(true);
      expect(possedutoATitoloDefinitivo(player('p1', 10, 100, 'TITOLO DEFINITIVO (RECOMPRA)'))).toBe(true);
    });

    it('falso per qualunque tipo di prestito', () => {
      expect(possedutoATitoloDefinitivo(player('p1', 10, 100, 'PRESTITO'))).toBe(false);
      expect(possedutoATitoloDefinitivo(player('p1', 10, 100, 'PRESTITO (DIRITTO)'))).toBe(false);
      expect(possedutoATitoloDefinitivo(player('p1', 10, 100, 'PRESTITO (OBBLIGO)'))).toBe(false);
    });
  });

  describe('giocatoriConBonusAttivo', () => {
    it('include solo i giocatori con bonus di una trattativa CONFERMATA della stagione corrente', () => {
      const scambi = [
        scambioAvanzato('confermata', '2026-27', [termini('p1', 2)], [termini('p2', 0)]),
      ];
      const ids = giocatoriConBonusAttivo(scambi, '2026-27');
      expect(ids.has('p1')).toBe(true);
      expect(ids.has('p2')).toBe(false);
    });

    it('ignora le trattative non confermate (bozza/ufficializzata/annullata)', () => {
      const scambi = [
        scambioAvanzato('bozza', '2026-27', [termini('p1', 1)]),
        scambioAvanzato('ufficializzata', '2026-27', [termini('p2', 1)]),
        scambioAvanzato('annullata', '2026-27', [termini('p3', 1)]),
      ];
      const ids = giocatoriConBonusAttivo(scambi, '2026-27');
      expect(ids.size).toBe(0);
    });

    it('ignora le trattative confermate di stagioni precedenti', () => {
      const scambi = [scambioAvanzato('confermata', '2025-26', [termini('p1', 1)])];
      const ids = giocatoriConBonusAttivo(scambi, '2026-27');
      expect(ids.has('p1')).toBe(false);
    });

    it('ignora le trattative semplici (senza avanzato)', () => {
      const semplice = scambioAvanzato('confermata', '2026-27', []);
      delete (semplice as { avanzato?: unknown }).avanzato;
      const ids = giocatoriConBonusAttivo([semplice], '2026-27');
      expect(ids.size).toBe(0);
    });
  });
});
