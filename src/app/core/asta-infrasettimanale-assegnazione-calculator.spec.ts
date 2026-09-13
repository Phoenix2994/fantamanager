import { Timestamp } from 'firebase/firestore';
import { calcolaPropostaAssegnazione } from './asta-infrasettimanale-assegnazione-calculator';
import { AstaInfrasettimanale, BustaInfrasettimanale } from './models';

function ts(millis: number): Timestamp {
  return { toMillis: () => millis } as unknown as Timestamp;
}

function busta(teamId: string, teamName: string, importo: number, millis: number): BustaInfrasettimanale {
  return { teamId, teamName, importo, timestamp: ts(millis) };
}

const ASTA_BASE: AstaInfrasettimanale = {
  id: 'a1',
  giocatoreNome: 'ABANKWAH',
  ruolo: 'Dd;Dc',
  squadra: 'UDI',
  quotazione: 3,
  prezzoAttuale: 0.5,
  rilanciatoDaTeamId: 'phoenix',
  rilanciatoDaTeamName: 'Phoenix',
  chiamataDaTeamId: 'phoenix',
  chiamataDaTeamName: 'Phoenix',
  squadreEleggibiliBusta: ['phoenix', 'akatsuki', 'dynamo-cocito'],
  chiusa: false,
};

describe('calcolaPropostaAssegnazione', () => {
  it('senza buste, vince l\'ultimo rilancio al prezzo di rilancio', () => {
    const proposta = calcolaPropostaAssegnazione(ASTA_BASE, []);
    expect(proposta).toEqual({
      teamId: 'phoenix',
      teamName: 'Phoenix',
      prezzo: 0.5,
      motivo: 'nessunaBusta',
    });
  });

  it('con più buste, vince la più alta al suo importo', () => {
    const buste = [
      busta('akatsuki', 'Akatsuki', 1.0, 100),
      busta('dynamo-cocito', 'Dynamo Cocito', 1.5, 200),
    ];
    const proposta = calcolaPropostaAssegnazione(ASTA_BASE, buste);
    expect(proposta).toEqual({
      teamId: 'dynamo-cocito',
      teamName: 'Dynamo Cocito',
      prezzo: 1.5,
      motivo: 'bustaPiuAlta',
    });
  });

  it('a parità di importo, vince la busta inserita per prima', () => {
    const buste = [
      busta('akatsuki', 'Akatsuki', 1.2, 500),
      busta('dynamo-cocito', 'Dynamo Cocito', 1.2, 100),
    ];
    const proposta = calcolaPropostaAssegnazione(ASTA_BASE, buste);
    expect(proposta.teamId).toBe('dynamo-cocito');
    expect(proposta.motivo).toBe('bustaPiuAlta');
  });

  it('se l\'unica busta è di chi ha già l\'ultimo rilancio, assegna al prezzo di rilancio (non di busta)', () => {
    const buste = [busta('phoenix', 'Phoenix', 5.0, 100)];
    const proposta = calcolaPropostaAssegnazione(ASTA_BASE, buste);
    expect(proposta).toEqual({
      teamId: 'phoenix',
      teamName: 'Phoenix',
      prezzo: 0.5,
      motivo: 'autobusta',
    });
  });

  it('se il leader presenta busta insieme ad altri, vale la regola normale (busta più alta)', () => {
    const buste = [
      busta('phoenix', 'Phoenix', 5.0, 100),
      busta('akatsuki', 'Akatsuki', 6.0, 200),
    ];
    const proposta = calcolaPropostaAssegnazione(ASTA_BASE, buste);
    expect(proposta).toEqual({
      teamId: 'akatsuki',
      teamName: 'Akatsuki',
      prezzo: 6.0,
      motivo: 'bustaPiuAlta',
    });
  });
});
