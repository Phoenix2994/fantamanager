import { AstaInfrasettimanale, BustaInfrasettimanale } from './models';

/** Proposta di assegnazione calcolata per un'asta infrasettimanale in fase "assegnazione" */
export interface PropostaAssegnazione {
  teamId: string;
  teamName: string;
  prezzo: number;
  motivo: 'nessunaBusta' | 'bustaPiuAlta' | 'autobusta';
}

/** Millisecondi di un Timestamp Firestore (0 se assente) — per ordinare le buste a parità di importo */
function timestampMillis(busta: BustaInfrasettimanale): number {
  return busta.timestamp?.toMillis() ?? 0;
}

/**
 * Calcola la proposta di assegnazione per un'asta, secondo le regole
 * concordate (vedi memoria di progetto "asta-infrasettimanale-piano"):
 * - nessuna busta → vince l'ultimo rilancio, al prezzo di rilancio;
 * - buste presenti → vince la busta più alta (a parità, la inserita per
 *   prima); MA se l'unica busta presentata è di chi ha già l'ultimo
 *   rilancio, si assegna comunque al prezzo di rilancio (più basso), non a
 *   quello di busta — altrimenti chi è già in testa pagherebbe di più
 *   presentando comunque una busta.
 *
 * Puramente indicativa: l'admin può sempre correggere manualmente prima di
 * finalizzare (vedi AstaInfrasettimanaleService.assegna).
 */
export function calcolaPropostaAssegnazione(
  asta: AstaInfrasettimanale,
  buste: readonly BustaInfrasettimanale[],
): PropostaAssegnazione {
  if (buste.length === 0) {
    return {
      teamId: asta.rilanciatoDaTeamId,
      teamName: asta.rilanciatoDaTeamName,
      prezzo: asta.prezzoAttuale,
      motivo: 'nessunaBusta',
    };
  }

  if (buste.length === 1 && buste[0].teamId === asta.rilanciatoDaTeamId) {
    return {
      teamId: asta.rilanciatoDaTeamId,
      teamName: asta.rilanciatoDaTeamName,
      prezzo: asta.prezzoAttuale,
      motivo: 'autobusta',
    };
  }

  const vincitrice = [...buste].sort((a, b) => {
    if (b.importo !== a.importo) {
      return b.importo - a.importo;
    }
    return timestampMillis(a) - timestampMillis(b);
  })[0];

  return {
    teamId: vincitrice.teamId,
    teamName: vincitrice.teamName,
    prezzo: vincitrice.importo,
    motivo: 'bustaPiuAlta',
  };
}
