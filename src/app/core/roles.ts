/**
 * Ruoli mantra: ordine canonico, colori dei chip e utilità di parsing —
 * condivisi da tutte le pagine che mostrano il ruolo di un giocatore
 * (rosa, svincolati, scambi), per un aspetto grafico coerente ovunque.
 */

/** Ordine canonico dei ruoli mantra */
export const ROLE_ORDER = ['Por', 'B', 'Dd', 'Dc', 'Ds', 'M', 'C', 'E', 'W', 'T', 'A', 'Pc'];

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

/** Chiave di ordinamento: posizione del primo ruolo noto del giocatore */
export function roleSortKey(ruolo: string): number {
  let best = ROLE_ORDER.length;
  for (const r of splitRoles(ruolo)) {
    const idx = ROLE_ORDER.indexOf(r);
    if (idx >= 0 && idx < best) {
      best = idx;
    }
  }
  return best;
}
