import { parseDecimale } from './decimal-utils';

describe('parseDecimale', () => {
  it('accetta la virgola come separatore decimale', () => {
    expect(parseDecimale('12,5')).toBe(12.5);
    expect(parseDecimale('0,25')).toBe(0.25);
  });

  it('accetta il punto come separatore decimale', () => {
    expect(parseDecimale('12.5')).toBe(12.5);
  });

  it('accetta interi e spazi attorno', () => {
    expect(parseDecimale(' 7 ')).toBe(7);
  });

  it('restituisce NaN per testo vuoto o non numerico', () => {
    expect(parseDecimale('')).toBeNaN();
    expect(parseDecimale(null)).toBeNaN();
    expect(parseDecimale('abc')).toBeNaN();
    expect(parseDecimale('1,2,3')).toBeNaN();
  });
});
