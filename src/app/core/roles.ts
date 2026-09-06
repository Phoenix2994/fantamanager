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

/**
 * Chiave di ordinamento: posizione del ruolo "più lontano" (ultimo
 * nell'ordine canonico) tra quelli del giocatore — non il primo. Un
 * giocatore Dd;Dc va quindi ordinato dopo i puri Dc (posizione di Dd),
 * non insieme a loro: i ruoli aggiuntivi lo spostano più in basso nella
 * lista, mai più in alto.
 */
export function roleSortKey(ruolo: string): number {
  let worst = -1;
  for (const r of splitRoles(ruolo)) {
    const idx = ROLE_ORDER.indexOf(r);
    if (idx > worst) {
      worst = idx;
    }
  }
  return worst < 0 ? ROLE_ORDER.length : worst;
}
