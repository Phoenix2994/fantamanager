import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmChiudiAstaData {
  giocatoreNome: string;
  /** presente solo se qualcuno ha già rilanciato: mostra l'avviso che il rilancio va perso */
  rilanciante?: { nome: string; prezzo: number };
  /** true se l'asta era stata aperta da "Apri asta random": mostra la scelta se incatenare il prossimo random */
  apertoDaRandom: boolean;
}

export interface ConfirmChiudiAstaResult {
  /** false solo se l'admin ha esplicitamente deselezionato la checkbox del prossimo random */
  continuaRandom: boolean;
}

/**
 * Dialog di conferma per "Chiudi senza assegnare": avvisa se un rilancio va
 * perso e, per un'asta aperta da random, lascia scegliere se incatenare
 * subito la prossima o fermarsi qui. Restituisce null se annullato.
 */
@Component({
  selector: 'app-confirm-chiudi-asta-dialog',
  imports: [DecimalPipe, MatButtonModule, MatCheckboxModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.rilanciante ? 'Chiudere senza assegnare?' : 'Chiudere l’asta?' }}</h2>

    <mat-dialog-content>
      @if (data.rilanciante) {
        <p class="warning">
          {{ data.rilanciante.nome }} ha rilanciato {{ data.rilanciante.prezzo | number: '1.2-2' }} €
          per {{ data.giocatoreNome }}: chiudendo senza assegnare quel rilancio va perso.
        </p>
      }
      @if (data.apertoDaRandom) {
        <mat-checkbox [checked]="continuaRandom()" (change)="continuaRandom.set($event.checked)">
          Apri subito l'asta sul prossimo giocatore random
        </mat-checkbox>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: l'annullamento non deve mai
           essere confondibile con una conferma -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button
        matButton="filled"
        type="button"
        [mat-dialog-close]="{ continuaRandom: continuaRandom() }"
      >
        {{ data.rilanciante ? 'Chiudi senza assegnare' : 'Chiudi asta' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .warning {
      margin: 0 0 12px;
      font-size: 0.875rem;
    }
  `,
})
export class ConfirmChiudiAstaDialog {
  readonly dialogRef = inject(MatDialogRef<ConfirmChiudiAstaDialog, ConfirmChiudiAstaResult>);
  readonly data = inject<ConfirmChiudiAstaData>(MAT_DIALOG_DATA);
  readonly continuaRandom = signal(true);
}
