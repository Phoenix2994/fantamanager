/** Normalizza una stringa per il confronto/ricerca: minuscole e senza accenti */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
