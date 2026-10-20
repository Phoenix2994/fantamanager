import { MAX_GIOCATORI } from './services/asta.service';

/** Dati necessari a decidere se una squadra può presentare (o aggiornare) una busta */
export interface LimiteBusteInput {
  /** Giocatori attualmente in rosa (0-28) */
  giocatoriInRosa: number;
  /** Aste aperte, DIVERSE da questa, in cui la squadra è già l'ultima rilanciante */
  astePosseduteAltrove: number;
  /** true se la squadra è già l'ultima rilanciante PROPRIO per questa asta */
  staGiaVincendoQuesta: boolean;
  /** Buste già presentate dalla squadra su ALTRE aste che non sta vincendo (esclusa questa) */
  busteEsistentiSuAltriNonVinti: number;
}

/**
 * Una squadra può sempre presentare (o aggiornare) la busta per un giocatore
 * che sta già vincendo (è l'ultimo rilanciante): non le farebbe guadagnare
 * un posto in rosa in più rispetto a quanto già "prenotato" dal rilancio.
 *
 * Per una busta su un giocatore CHE NON STA VINCENDO, invece, il numero di
 * buste "nuove" che può avere in giro contemporaneamente è limitato dagli
 * slot di rosa liberi meno quelli già "prenotati" dalle aste che sta già
 * vincendo altrove (se le vince tutte, quei posti sono comunque occupati).
 *
 * Esempi concordati con l'utente:
 * - 3 liberi, in testa altrove in 1 asta → 2 buste su giocatori diversi + 1
 *   (senza limite) su quello che sta già vincendo.
 * - 1 libero, in testa altrove in 1 asta → 0 buste su altri, 1 su quello che
 *   sta già vincendo.
 * - 1 libero, in testa altrove in 0 aste → 1 busta a scelta su un giocatore
 *   qualsiasi tra quelli eleggibili.
 */
export function puoInviareBusta(input: LimiteBusteInput): boolean {
  if (input.staGiaVincendoQuesta) {
    return true;
  }
  const slotLiberi = MAX_GIOCATORI - input.giocatoriInRosa;
  const slotNuoviDisponibili = Math.max(0, slotLiberi - input.astePosseduteAltrove);
  return input.busteEsistentiSuAltriNonVinti + 1 <= slotNuoviDisponibili;
}

/** Quante buste "nuove" (su giocatori che non sta già vincendo) può ancora presentare in totale */
export function slotNuoveBusteDisponibili(
  giocatoriInRosa: number,
  astePosseduteAltrove: number,
): number {
  return Math.max(0, MAX_GIOCATORI - giocatoriInRosa - astePosseduteAltrove);
}
