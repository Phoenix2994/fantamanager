import {
  GiocatoreAvanzato,
  calcolaScambioAvanzato,
  calcolaScambioAvanzatoConTetto,
} from './scambi-avanzati-calculator';

describe('scambi-avanzati-calculator', () => {
  describe('caso 1 — un giocatore in prestito 12 mesi, pagato 40€ (cash-only)', () => {
    it('il suo valore finale diventa esattamente 50€, qualunque sia il valore di partenza sotto i 50€', () => {
      const giocatore: GiocatoreAvanzato = {
        id: 'p1',
        name: 'Giocatore',
        ruolo: 'A',
        valoreAttuale: 30, // <50, come da caso reale ("vale meno di 50 euro")
        quotazioneAttuale: 10,
        quotazioneFinale: 10, // nessun riscatto in questo caso: la QF non entra nel calcolo
        tipoContratto: 'prestito',
        durataPrestito: 12,
      };

      const risultato = calcolaScambioAvanzato([], [giocatore], 40, 0, true);

      expect(risultato.errore).toBeNull();
      const finale = risultato.risultati.find((r) => r.giocatore.id === 'p1');
      expect(finale?.valoreDopo).toBeCloseTo(50, 2);
    });
  });

  describe('caso 2 — tre giocatori (1 definitivo + 2 prestiti), pagati 40€ complessivi', () => {
    it('diventano rispettivamente 6,59€, 53,95€ e 14,79€', () => {
      const definitivo: GiocatoreAvanzato = {
        id: 'def',
        name: 'Definitivo',
        ruolo: 'D',
        valoreAttuale: 1.1,
        quotazioneAttuale: 4,
        quotazioneFinale: 4,
        tipoContratto: 'definitivo',
      };
      const prestito6: GiocatoreAvanzato = {
        id: 'p6',
        name: 'Prestito 6 mesi',
        ruolo: 'C',
        valoreAttuale: 2.5,
        quotazioneAttuale: 15,
        quotazioneFinale: 15,
        tipoContratto: 'prestito',
        durataPrestito: 6,
      };
      const prestito12: GiocatoreAvanzato = {
        id: 'p12',
        name: 'Prestito 12 mesi',
        ruolo: 'A',
        valoreAttuale: 4.5,
        quotazioneAttuale: 6,
        quotazioneFinale: 6,
        tipoContratto: 'prestito',
        durataPrestito: 12,
      };

      const risultato = calcolaScambioAvanzato([], [definitivo, prestito6, prestito12], 40, 0, true);

      expect(risultato.errore).toBeNull();
      const trova = (id: string) => risultato.risultati.find((r) => r.giocatore.id === id)?.valoreDopo;
      expect(trova('def')).toBeCloseTo(6.59, 2);
      expect(trova('p6')).toBeCloseTo(53.95, 2);
      expect(trova('p12')).toBeCloseTo(14.79, 2);
    });
  });

  describe('caso 3 — riscatto + bonus + definitivo scambiati con un prestito non riscattato + conguaglio', () => {
    it('i tre giocatori diventano 181,73€, 9,71€ e 45,29€', () => {
      const giocatoreA: GiocatoreAvanzato = {
        id: 'A',
        name: 'Giocatore A',
        ruolo: 'C',
        valoreAttuale: 1.1,
        quotazioneAttuale: 4,
        quotazioneFinale: 9,
        tipoContratto: 'prestitoDiritto',
        durataPrestito: 6,
        riscattato: true,
        cifraRiscatto: 20,
        bonus: [
          { id: 'b1', tipo: 'gol', eventiAttesi: 4, eventiVerificati: 0, rewardPerEvento: 2 },
          { id: 'b2', tipo: 'assist', eventiAttesi: 5, eventiVerificati: 0, rewardPerEvento: 4 },
        ],
      };
      const giocatoreB: GiocatoreAvanzato = {
        id: 'B',
        name: 'Giocatore B',
        ruolo: 'D',
        valoreAttuale: 0.1,
        quotazioneAttuale: 5,
        quotazioneFinale: 3,
        tipoContratto: 'definitivo',
      };
      const giocatoreC: GiocatoreAvanzato = {
        id: 'C',
        name: 'Giocatore C',
        ruolo: 'A',
        valoreAttuale: 35,
        quotazioneAttuale: 17,
        quotazioneFinale: 22,
        tipoContratto: 'prestitoDiritto',
        durataPrestito: 12,
        riscattato: false,
        // "presenze" è un bonus A SOGLIA (non a eventi): nel caso reale
        // originale contribuiva 5€ al calcolo iniziale (5 presenze attese ×
        // 1€, riscritto qui come soglia già considerata raggiunta per
        // ottenere lo stesso contributo — vedi valoreBonusAtteso).
        bonus: [{ id: 'b3', tipo: 'presenze', soglia: 5, verificato: true, rewardUnaTantum: 5 }],
      };

      // {A,B} ceduti dal lato "nostro" (A), {C} ceduto dall'altro lato (B),
      // che paga anche 20€ di conguaglio.
      const risultato = calcolaScambioAvanzato([giocatoreA, giocatoreB], [giocatoreC], 0, 20, true);

      expect(risultato.errore).toBeNull();
      const trova = (id: string) => risultato.risultati.find((r) => r.giocatore.id === id)?.valoreDopo;
      expect(trova('A')).toBeCloseTo(181.73, 1);
      expect(trova('B')).toBeCloseTo(9.71, 2);
      expect(trova('C')).toBeCloseTo(45.29, 2);
    });
  });

  // I due casi seguenti NON vengono da esempi reali della lega (a differenza
  // dei tre sopra): il tetto bonus è una regola nuova, verificata solo a
  // mano seguendo passo-passo l'algoritmo (vedi i calcoli nel commit che ha
  // introdotto calcolaScambioAvanzatoConTetto).
  describe('tetto bonus — un giocatore può salire al massimo al doppio del suo valore "senza bonus"', () => {
    it('lato con un solo giocatore: il tetto non ha effetto (l\'eccesso torna comunque a lui, non c\'è nessun altro su cui spalmarlo)', () => {
      // X (unico ceduto dal lato A) vale 5€, quotazione 5, senza QF/riscatto.
      // Bonus atteso: 10 gol attesi × 3€ = 30€. Senza tetto l'algoritmo lo
      // porterebbe a 35€ (verificato riga per riga a mano). Il tetto sul
      // "valore senza bonus" (5€ → tetto 10€) lo limiterebbe a 10€, ma
      // ridistribuendo i 25€ di eccesso SOLO su di lui (è l'unico del suo
      // lato) si torna esattamente a 35€.
      const x: GiocatoreAvanzato = {
        id: 'x',
        name: 'X',
        ruolo: 'A',
        valoreAttuale: 5,
        quotazioneAttuale: 5,
        quotazioneFinale: 5,
        tipoContratto: 'definitivo',
        bonus: [{ id: 'bx', tipo: 'gol', eventiAttesi: 10, eventiVerificati: 0, rewardPerEvento: 3 }],
      };
      const y: GiocatoreAvanzato = {
        id: 'y',
        name: 'Y',
        ruolo: 'A',
        valoreAttuale: 5,
        quotazioneAttuale: 5,
        quotazioneFinale: 5,
        tipoContratto: 'definitivo',
      };

      const senzaTetto = calcolaScambioAvanzato([x], [y], 0, 0, true);
      expect(senzaTetto.risultati.find((r) => r.giocatore.id === 'x')?.valoreDopo).toBeCloseTo(35, 2);

      const conTetto = calcolaScambioAvanzatoConTetto([x], [y], 0, 0, true);
      expect(conTetto.errore).toBeNull();
      const trova = (id: string) => conTetto.risultati.find((r) => r.giocatore.id === id)?.valoreDopo;
      expect(trova('x')).toBeCloseTo(35, 2);
      expect(trova('y')).toBeCloseTo(5, 2);
    });

    it('lato con due giocatori: il compagno assorbe la quota di eccesso per quotazione, il totale del lato resta invariato', () => {
      // Lato A: X (val 1€, quot 1, bonus atteso 2 gol×3€=6€) + Z (val 20€,
      // quot 1, nessun bonus). Lato B: Y (val 21€, quot 21), nessun bonus.
      // Senza tetto: il divario di questo passaggio (6€, tutto dovuto al
      // bonus di X) va per intero a X, che è l'unico ad averlo — X=7€,
      // Z resta a 20€ (verificato a mano, bug reale corretto: prima veniva
      // spalmato per quotazione anche su Z, che non aveva realizzato nulla).
      // Il tetto di X è 2×1=2€ (il suo valore "senza bonus" resta 1€):
      // eccesso 7-2=5€, ridistribuito per quotazione tra X e Z (quotazione 1
      // e 1 → metà ciascuno): X = 2 + 2,5 = 4,5€, Z = 20 + 2,5 = 22,5€. Il
      // totale del lato A (27€) è identico con o senza tetto: il tetto
      // sposta valore da un giocatore all'altro dello stesso lato, non lo fa
      // sparire.
      const x: GiocatoreAvanzato = {
        id: 'x2',
        name: 'X2',
        ruolo: 'A',
        valoreAttuale: 1,
        quotazioneAttuale: 1,
        quotazioneFinale: 1,
        tipoContratto: 'definitivo',
        bonus: [{ id: 'bx2', tipo: 'gol', eventiAttesi: 2, eventiVerificati: 0, rewardPerEvento: 3 }],
      };
      const z: GiocatoreAvanzato = {
        id: 'z2',
        name: 'Z2',
        ruolo: 'D',
        valoreAttuale: 20,
        quotazioneAttuale: 1,
        quotazioneFinale: 1,
        tipoContratto: 'definitivo',
      };
      const y: GiocatoreAvanzato = {
        id: 'y2',
        name: 'Y2',
        ruolo: 'A',
        valoreAttuale: 21,
        quotazioneAttuale: 21,
        quotazioneFinale: 21,
        tipoContratto: 'definitivo',
      };

      const senzaTetto = calcolaScambioAvanzato([x, z], [y], 0, 0, true);
      const trovaSenza = (id: string) => senzaTetto.risultati.find((r) => r.giocatore.id === id)?.valoreDopo ?? 0;
      expect(trovaSenza('x2')).toBeCloseTo(7, 2);
      expect(trovaSenza('z2')).toBeCloseTo(20, 2);

      const conTetto = calcolaScambioAvanzatoConTetto([x, z], [y], 0, 0, true);
      expect(conTetto.errore).toBeNull();
      const trova = (id: string) => conTetto.risultati.find((r) => r.giocatore.id === id)?.valoreDopo;
      expect(trova('x2')).toBeCloseTo(4.5, 2);
      expect(trova('z2')).toBeCloseTo(22.5, 2);
      expect(trova('y2')).toBeCloseTo(21, 2);
      expect((trova('x2') ?? 0) + (trova('z2') ?? 0)).toBeCloseTo(trovaSenza('x2') + trovaSenza('z2'), 2);
    });

    it('lato "più pesante" che diventa tale solo per il bonus: il compagno senza bonus non deve muoversi (bug reale segnalato dalla lega)', () => {
      // Scambio reale segnalato: Pinamonti (11,9€, quot 12, bonus gol) e
      // Thuram K. (12,7€, quot 10, bonus gol) del lato A, contro Butez
      // (14,8€, quot 16) del lato B. Simulando 20 gol di Thuram K. a 1€
      // l'evento (0 per Pinamonti), il lato A pesa di più anche a bonus
      // zero, quindi la revisione del passaggio 1 dipende SOLO dal bonus di
      // Thuram K.: prima del fix veniva spalmata per quotazione su
      // entrambi (17,46€ e 17,34€, Pinamonti compreso pur non avendo
      // segnato nulla); ora va per intero a chi il bonus lo realizza, sotto
      // al tetto del raddoppio (25,4€) quindi senza alcuno sconfinamento.
      const pinamonti: GiocatoreAvanzato = {
        id: 'pinamonti',
        name: 'PINAMONTI',
        ruolo: 'A',
        valoreAttuale: 11.9,
        quotazioneAttuale: 12,
        quotazioneFinale: 12,
        tipoContratto: 'definitivo',
        bonus: [{ id: 'bp', tipo: 'gol', eventiAttesi: 0, eventiVerificati: 0, rewardPerEvento: 1 }],
      };
      const thuramK: GiocatoreAvanzato = {
        id: 'thuram-k',
        name: 'THURAM K.',
        ruolo: 'C',
        valoreAttuale: 12.7,
        quotazioneAttuale: 10,
        quotazioneFinale: 10,
        tipoContratto: 'definitivo',
        bonus: [{ id: 'bt', tipo: 'gol', eventiAttesi: 0, eventiVerificati: 20, rewardPerEvento: 1 }],
      };
      const butez: GiocatoreAvanzato = {
        id: 'butez',
        name: 'BUTEZ',
        ruolo: 'Por',
        valoreAttuale: 14.8,
        quotazioneAttuale: 16,
        quotazioneFinale: 16,
        tipoContratto: 'definitivo',
      };

      // false = ricalcolo sui bonus REALIZZATI (come fa "Simula cambio valori")
      const risultato = calcolaScambioAvanzatoConTetto([pinamonti, thuramK], [butez], 0, 0, false);
      expect(risultato.errore).toBeNull();
      const trova = (id: string) => risultato.risultati.find((r) => r.giocatore.id === id)?.valoreDopo;
      expect(trova('pinamonti')).toBeCloseTo(11.9, 2);
      expect(trova('thuram-k')).toBeCloseTo(22.9, 2);
      expect(trova('butez')).toBeCloseTo(14.8, 2);
    });
  });
});
