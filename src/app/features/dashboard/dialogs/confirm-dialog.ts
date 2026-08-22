import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
}

/** Dialog di conferma generica: restituisce true se confermato. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: la cancellazione non deve mai
           essere confondibile con una conferma -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button matButton="filled" type="button" [mat-dialog-close]="true">
        {{ data.confirmLabel ?? 'Conferma' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialog {
  readonly dialogRef = inject(MatDialogRef<ConfirmDialog, boolean>);
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}