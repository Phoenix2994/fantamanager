/**
 * Converte il testo di un campo importo in numero, accettando sia la virgola
 * (tastierino iPhone in italiano) sia il punto come separatore decimale.
 * Restituisce NaN se il testo è vuoto o non numerico.
 */
export function parseDecimale(testo: string | null | undefined): number {
  const pulito = (testo ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (pulito === '') {
    return NaN;
  }
  return Number(pulito);
}
