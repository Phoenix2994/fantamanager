/** Normalizza una stringa per il confronto/ricerca: minuscole e senza accenti */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Slug: minuscolo, accent-folding, spazi/simboli → trattini (come lo script Python) */
export function slugify(value: string): string {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}
