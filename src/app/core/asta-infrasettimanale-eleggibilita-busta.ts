/** I soli campi dell'asta che servono per decidere l'eleggibilità alle buste */
export interface AstaPerEleggibilita {
  rilanciatoDaTeamId: string;
  squadreEleggibiliBusta: readonly string[];
}

/**
 * Eleggibili a presentare una busta: le squadre che hanno rilanciato durante
 * la fase "solo rilanci" (tracciate in `squadreEleggibiliBusta`), PIÙ — se
 * quell'elenco è ancora vuoto — la squadra che sta vincendo il giocatore
 * (l'ultima rilanciante), perché nessuno l'ha mai sfidata durante la fase 2.
 *
 * Corregge un buco della regola originale ("solo chi rilancia in fase 2"):
 * se nessuno rilancia affatto in quella fascia, il presidente che stava
 * vincendo alla fine della fase 1 va comunque considerato eleggibile — non
 * deve restarne escluso solo perché nessuno l'ha sfidato.
 */
export function eEleggibilePerBusta(teamId: string, asta: AstaPerEleggibilita): boolean {
  if (asta.squadreEleggibiliBusta.includes(teamId)) {
    return true;
  }
  return asta.squadreEleggibiliBusta.length === 0 && asta.rilanciatoDaTeamId === teamId;
}

/**
 * Squadre da aggiungere a `squadreEleggibiliBusta` (via arrayUnion) quando
 * `nuovoRilanciante` rilancia con successo durante la fase "solo rilanci".
 * Se è il PRIMO rilancio di questa fase per l'asta (elenco ancora vuoto),
 * porta con sé anche chi era rilanciante fino a quel momento (il vincitore
 * della fase 1, altrimenti mai tracciato se nessun altro rilancia dopo di
 * lui) — altrimenti solo il nuovo rilanciante si aggiunge.
 */
export function squadreDaAggiungereAEleggibili(
  asta: AstaPerEleggibilita,
  nuovoRilanciante: string,
): readonly string[] {
  if (asta.squadreEleggibiliBusta.length === 0) {
    return [asta.rilanciatoDaTeamId, nuovoRilanciante];
  }
  return [nuovoRilanciante];
}
