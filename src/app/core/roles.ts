/**
 * Ruoli mantra: ordine canonico, colori dei chip e utilità di parsing —
 * condivisi da tutte le pagine che mostrano il ruolo di un giocatore
 * (rosa, svincolati, scambi), per un aspetto grafico coerente ovunque.
 */

/** Ordine canonico dei ruoli mantra */
export const ROLE_ORDER = ['Por', 'Dc', 'B', 'Dd', 'Ds', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'];

/**
 * Colore del bordo/chip per gruppo di ruolo. Sono custom property (vedi
 * styles.scss, --role-*): stessa mappatura ruolo→gruppo, ma la tonalità
 * effettiva cambia tra tema scuro (di default, più chiara per restare
 * leggibile su sfondo scuro) e tema chiaro (i colori originali, pensati per
 * sfondo bianco).
 */
export const ROLE_COLORS: Record<string, string> = {
  Por: 'var(--role-por)',
  B: 'var(--role-dif)',
  Dd: 'var(--role-dif)',
  Dc: 'var(--role-dif)',
  Ds: 'var(--role-dif)',
  M: 'var(--role-cen)',
  C: 'var(--role-cen)',
  E: 'var(--role-cen)',
  W: 'var(--role-est)',
  T: 'var(--role-est)',
  A: 'var(--role-att)',
  Pc: 'var(--role-att)',
};

/** Divide la stringa ruolo composta ("Dd;Dc") nei ruoli singoli */
export function splitRoles(ruolo: string): string[] {
  return ruolo
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Colore associato al gruppo di ruolo (grigio neutro se sconosciuto) */
export function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? 'var(--mat-sys-on-surface-variant)';
}

/** Indici nell'ordine canonico dei ruoli del giocatore, dal più vicino al più lontano */
function indiciOrdinati(ruolo: string): number[] {
  return splitRoles(ruolo)
    .map((r) => ROLE_ORDER.indexOf(r))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
}

/**
 * Confronto tra due stringhe ruolo (anche composte, es. "Dd;Dc") per
 * l'ordinamento nelle liste (rosa, filtri). Gli indici canonici dei ruoli
 * di ciascun giocatore vengono ordinati dal più vicino al più lontano, poi
 * le due sequenze si confrontano lessicograficamente — come si confrontano
 * due parole lettera per lettera: decide il primo ruolo, a parità il
 * secondo, e così via; chi si "esaurisce" prima (meno ruoli aggiuntivi)
 * viene prima.
 *
 * Questo fa sì che:
 * - un ruolo puro preceda le proprie varianti con un ruolo aggiuntivo più
 *   lontano (Dc prima di Dd;Dc, che a sua volta precede Ds;Dc);
 * - un giocatore con un secondo ruolo più vicino di un altro gruppo lo
 *   preceda comunque (E;W prima di M;C, perché E precede M; Ds;E prima
 *   del puro E, perché Ds precede E; C;T prima del puro T, perché C
 *   precede T).
 */
export function compareRuoli(ruoloA: string, ruoloB: string): number {
  const a = indiciOrdinati(ruoloA);
  const b = indiciOrdinati(ruoloB);
  const lunghezza = Math.max(a.length, b.length);
  for (let i = 0; i < lunghezza; i++) {
    const va = a[i];
    const vb = b[i];
    if (va === undefined && vb === undefined) {
      continue;
    }
    if (va === undefined) {
      return -1;
    }
    if (vb === undefined) {
      return 1;
    }
    if (va !== vb) {
      return va - vb;
    }
  }
  return 0;
}
