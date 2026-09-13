import { AstaInfrasettimanaleConfig, MomentoSettimanale } from './models';

/** Le 4 fasi del ciclo, più "disabilitata" quando l'admin ha spento il prossimo ciclo */
export type FaseInfrasettimanale =
  | 'disabilitata'
  | 'chiamata'
  | 'soloRilanci'
  | 'buste'
  | 'assegnazione';

const GIORNI_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Giorno (0=domenica…6=sabato, come Date.getDay()) e minuti dalla mezzanotte,
 * nel fuso Europe/Rome — indipendente dal fuso del dispositivo/server, unico
 * modo affidabile per leggere data/ora locale di un altro fuso in JS senza
 * librerie esterne (si formattano le parti nel fuso voluto e si ricompongono).
 */
function componentiRoma(now: Date): { giorno: number; minutiNelGiorno: number } {
  const parti = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekday = parti.find((p) => p.type === 'weekday')!.value;
  // Intl con hour12:false può restituire "24" per la mezzanotte invece di "0"
  const ora = Number(parti.find((p) => p.type === 'hour')!.value) % 24;
  const minuto = Number(parti.find((p) => p.type === 'minute')!.value);

  return { giorno: GIORNI_EN.indexOf(weekday), minutiNelGiorno: ora * 60 + minuto };
}

/** Minuti trascorsi dall'inizio della settimana (domenica 00:00) fino a questo momento, fuso Europe/Rome */
function minutoDellaSettimana(now: Date): number {
  const { giorno, minutiNelGiorno } = componentiRoma(now);
  return giorno * 24 * 60 + minutiNelGiorno;
}

/** Stesso calcolo, ma per un confine configurato (giorno + "HH:mm") invece che per un istante reale */
function minutoDelConfine(momento: MomentoSettimanale): number {
  const [ore, minuti] = momento.ora.split(':').map(Number);
  return momento.giorno * 24 * 60 + ore * 60 + (minuti || 0);
}

/**
 * Fase corrente del ciclo di asta infrasettimanale, dati la configurazione e
 * l'istante attuale. Le 4 fasi si susseguono in un'unica settimana (chiamata
 * → solo rilanci → buste → assegnazione); "assegnazione" dura fino alla
 * chiamata della settimana SUCCESSIVA, quindi cattura anche i minuti prima
 * del primo confine (avvolgimento di fine settimana).
 */
export function calcolaFaseInfrasettimanale(
  config: AstaInfrasettimanaleConfig | undefined,
  now: Date,
): FaseInfrasettimanale {
  if (!config || !config.abilitata) {
    return 'disabilitata';
  }

  const adesso = minutoDellaSettimana(now);
  const inizioChiamata = minutoDelConfine(config.inizioChiamata);
  const inizioSoloRilanci = minutoDelConfine(config.inizioSoloRilanci);
  const inizioBuste = minutoDelConfine(config.inizioBuste);
  const inizioAssegnazione = minutoDelConfine(config.inizioAssegnazione);

  if (adesso >= inizioChiamata && adesso < inizioSoloRilanci) {
    return 'chiamata';
  }
  if (adesso >= inizioSoloRilanci && adesso < inizioBuste) {
    return 'soloRilanci';
  }
  if (adesso >= inizioBuste && adesso < inizioAssegnazione) {
    return 'buste';
  }
  // adesso >= inizioAssegnazione, oppure prima di inizioChiamata: stessa fase,
  // solo "srotolata" sull'altro lato del confine di fine settimana
  return 'assegnazione';
}
