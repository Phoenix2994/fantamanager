import { UndoLogEntry } from './models';
import { pianificaAnnullamento } from './undo-calculator';

/** Voce di undoLog minima per i test, con i soli campi che servono al piano */
function entry(partial: Partial<UndoLogEntry>): UndoLogEntry {
  return {
    id: 'u1',
    timestamp: null,
    tipo: 'rinnovo',
    leagueId: 'lega',
    teamIds: ['teamA'],
    descrizione: 'test',
    docs: [],
    adminId: 'admin',
    undone: false,
    ...partial,
  };
}

describe('undo-calculator: pianificaAnnullamento', () => {
  it('ripristina un documento modificato con set del valore precedente', () => {
    const piano = pianificaAnnullamento(
      entry({
        docs: [{ path: 'teams/A/seasons/2026-27/players/p1', before: { name: 'Pippo', valoreAttuale: 10 } }],
      }),
    );
    expect(piano.operazioni).toEqual([
      {
        path: 'teams/A/seasons/2026-27/players/p1',
        azione: 'set',
        data: { name: 'Pippo', valoreAttuale: 10 },
      },
    ]);
    expect(piano.scambioDaAnnullare).toBeUndefined();
  });

  it('elimina un documento che prima non esisteva (before: null)', () => {
    const piano = pianificaAnnullamento(
      entry({ docs: [{ path: 'league/lega/svincolati/pippo', before: null }] }),
    );
    expect(piano.operazioni).toEqual([{ path: 'league/lega/svincolati/pippo', azione: 'delete' }]);
  });

  it('acquistoAsta: elimina il giocatore creato, ripristina finanze e svincolato', () => {
    const piano = pianificaAnnullamento(
      entry({
        tipo: 'acquistoAsta',
        docs: [
          { path: 'teams/A/seasons/2026-27/players/nuovo', before: null },
          { path: 'teams/A/seasonFinance/2026-27', before: { rinnovi: 5 } },
          { path: 'league/lega/svincolati/pippo', before: { name: 'Pippo' } },
        ],
      }),
    );
    expect(piano.operazioni).toEqual([
      { path: 'teams/A/seasons/2026-27/players/nuovo', azione: 'delete' },
      { path: 'teams/A/seasonFinance/2026-27', azione: 'set', data: { rinnovi: 5 } },
      { path: 'league/lega/svincolati/pippo', azione: 'set', data: { name: 'Pippo' } },
    ]);
  });

  it('scambioConferma: include lo scambioId da riportare ad annullata', () => {
    const piano = pianificaAnnullamento(
      entry({ tipo: 'scambioConferma', scambioId: 'scambio1', docs: [] }),
    );
    expect(piano.scambioDaAnnullare).toBe('scambio1');
  });

  it('un tipo diverso da scambioConferma non tocca mai scambioDaAnnullare, anche se scambioId è presente', () => {
    const piano = pianificaAnnullamento(entry({ tipo: 'rinnovo', scambioId: 'scambio1', docs: [] }));
    expect(piano.scambioDaAnnullare).toBeUndefined();
  });
});
