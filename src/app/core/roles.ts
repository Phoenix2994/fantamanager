/**
 * Ruoli mantra: ordine canonico, colori dei chip e utilità di parsing —
 * condivisi da tutte le pagine che mostrano il ruolo di un giocatore
 * (rosa, svincolati, scambi), per un aspetto grafico coerente ovunque.
 */

/** Ordine canonico dei ruoli mantra */
export const ROLE_ORDER = ['Por', 'B', 'Dd', 'Dc', 'Ds', 'M', 'C', 'E', 'W', 'T', 'A', 'Pc'];

/** Colore del bordo/chip per gruppo di ruolo */
export const ROLE_COLORS: Record<string, string> = {
  Por: '#f9a825',
  B: '#2e7d32',
  Dd: '#2e7d32',
  Dc: '#2e7d32',
  Ds: '#2e7d32',
  M: '#508af4',
  C: '#508af4',
  E: '#508af4',
  W: '#6a1b9a',
  T: '#6a1b9a',
  A: '#c62828',
  Pc: '#c62828',
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
