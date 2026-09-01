/**
 * Mappa sigla squadra reale di Serie A (come salvata in Firestore, es. "UDI")
 * -> slug del file logo in public/loghi-serie-a/{slug}.png. Stessa
 * filosofia di team-logos.ts, ma per i club reali (svincolati/asta) invece
 * delle squadre della lega fantacalcio.
 *
 * Manutenzione manuale: le sigle mancanti qui ricadono su un testo di
 * scorta (vedi SerieALogo) — non è un errore bloccante, capita ad ogni
 * promozione/retrocessione finché non si aggiunge il logo del nuovo club.
 */
const LOGO_SLUG_PER_SQUADRA: Readonly<Record<string, string>> = {
  ATA: 'atalanta',
  BOL: 'bologna',
  CAG: 'cagliari',
  COM: 'como',
  FIO: 'fiorentina',
  FRO: 'frosinone',
  GEN: 'genoa',
  INT: 'inter',
  JUV: 'juventus',
  LAZ: 'lazio',
  LEC: 'lecce',
  MIL: 'milan',
  MON: 'monza',
  NAP: 'napoli',
  PAR: 'parma',
  ROM: 'roma',
  SAS: 'sassuolo',
  TOR: 'torino',
  UDI: 'udinese',
  VEN: 'venezia',
};

/**
 * URL del logo di un club reale (per sigla), o null se non mappato. Path
 * RELATIVO apposta (vedi logoUrlPerNome in team-logos.ts per lo stesso
 * ragionamento su base href e GitHub Pages).
 */
export function logoUrlPerSquadra(sigla: string | null | undefined): string | null {
  if (!sigla) {
    return null;
  }
  const slug = LOGO_SLUG_PER_SQUADRA[sigla];
  return slug ? `loghi-serie-a/${slug}.png` : null;
}
