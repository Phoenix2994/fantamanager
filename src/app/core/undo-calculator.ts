import { UndoLogEntry } from './models';

/**
 * Logica pura di pianificazione di un annullamento (nessuna dipendenza da
 * Firestore): dato uno snapshot "prima/dopo per documento", decide quali
 * scritture servono per tornare allo stato precedente. Usata da
 * `UndoService.annulla`, che esegue il piano in un batch atomico.
 */

export interface OperazioneRipristino {
  path: string;
  azione: 'set' | 'delete';
  /** presente solo per azione 'set' */
  data?: Record<string, unknown>;
}

export interface PianoAnnullamento {
  operazioni: OperazioneRipristino[];
  /** solo per tipo 'scambioConferma': id della trattativa da marcare 'annullata' */
  scambioDaAnnullare?: string;
}

export function pianificaAnnullamento(entry: UndoLogEntry): PianoAnnullamento {
  const operazioni: OperazioneRipristino[] = entry.docs.map((snap) =>
    snap.before === null
      ? { path: snap.path, azione: 'delete' }
      : { path: snap.path, azione: 'set', data: snap.before },
  );

  return {
    operazioni,
    scambioDaAnnullare: entry.tipo === 'scambioConferma' ? entry.scambioId : undefined,
  };
}
