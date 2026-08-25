import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmAssegnazioneData {
  /** nome del giocatore in asta */
  giocatoreNome: string;
  /** squadra reale del giocatore (opzionale) */
  squadra?: string;
  /** nome della squadra vincitrice */
  teamName: string;
  /** cifra finale di assegnazione (€) */
  prezzo: number;
  /** etichetta della voce di spesa (es. "Asta settembre") */
  provenienzaLabel: string;
}

/**
 * Dialog di conferma assegnazione all'asta: riepiloga squadra vincitrice,
 * giocatore e cifra finale prima che l'admin finalizza l'operazione.
 * Restituisce true se confermato.
 */
@Component({
  selector: 'app-confirm-assegnazione-dialog',
  imports: [DecimalPipe, MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Conferma assegnazione</h2>

    <mat-dialog-content>
      <div class="info">
        <div class="info-row">
          <span>Giocatore</span>
          <strong>
            {{ data.giocatoreNome }}
            @if (data.squadra) {
              <span class="squadra-giocatore">({{ data.squadra }})</span>
            }
          </strong>
        </div>
        <div class="info-row">
          <span>Squadra vincitrice</span>
          <strong>{{ data.teamName }}</strong>
        </div>
        <div class="info-row">
          <span>Voce di spesa</span>
          <strong>{{ data.provenienzaLabel }}</strong>
        </div>
        <div class="info-row prezzo">
          <span>Cifra finale</span>
          <strong>{{ data.prezzo | number: '1.2-2' }} €</strong>
        </div>
      </div>
      <p class="hint">
        L'operazione aggiunge il giocatore alla rosa e somma la spesa alla voce
        selezionata. Non è reversibile.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: l'assegnazione non deve mai
           essere confondibile con una conferma -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button matButton="filled" type="button" [mat-dialog-close]="true">
        Conferma e assegna
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .info {
      margin-bottom: 16px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      font-size: 0.875rem;
    }

    .info-row span {
      color: var(--mat-sys-on-surface-variant);
    }

    .info-row.prezzo strong {
      font-size: 1.125rem;
      color: var(--mat-sys-primary);
    }

    .squadra-giocatore {
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
    }

    .hint {
      margin: 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class ConfirmAssegnazioneDialog {
  readonly dialogRef = inject(MatDialogRef<ConfirmAssegnazioneDialog, boolean>);
  readonly data = inject<ConfirmAssegnazioneData>(MAT_DIALOG_DATA);
}
