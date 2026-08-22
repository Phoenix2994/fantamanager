import { Component, inject } from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Player } from '../../../core/models';

export interface RenewDialogData {
  player: Player;
}

/**
 * Dialog di rinnovo: mostra la spesa che diventerà il nuovo
 * "acquisto/rinnovo" e chiede la percentuale per l'anno successivo.
 * Restituisce la nuova percentuale (es. 0.85 = 85%).
 */
@Component({
  selector: 'app-renew-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Rinnova: {{ data.player.name }}</h2>

    <mat-dialog-content>
      <div class="info">
        <div class="info-row">
          <span>Spesa rinnovo attuale → diventerà "Soldi spesi"</span>
          <strong>{{ data.player.prossimaSpesaRinnovo | number: '1.2-2' }} €</strong>
        </div>
        <div class="info-row">
          <span>Percentuale attuale</span>
          <strong>{{ perc(data.player.prossimaPercRinnovo) }}</strong>
        </div>
      </div>

      <form [formGroup]="form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Nuova % rinnovo</mat-label>
          <input matInput type="number" min="0.01" step="0.001" formControlName="nuovaPerc" />
          <mat-hint>es. 1.45 = 145% — la nuova spesa rinnovo sarà ricalcolata sul V.A.</mat-hint>
          @if (form.controls.nuovaPerc.hasError('required')) {
            <mat-error>Inserisci la percentuale</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: la cancellazione non deve mai
           essere confondibile con un risultato valido -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button matButton="filled" type="button" [disabled]="form.invalid" (click)="save()">
        Rinnova
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

    .full-width {
      width: 100%;
    }
  `,
})
export class RenewDialog {
  readonly data = inject<RenewDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RenewDialog, number>);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly form = this.fb.group({
    nuovaPerc: [
      this.data.player.prossimaPercRinnovo || 1,
      [Validators.required, Validators.min(0.01)],
    ],
  });

  save(): void {
    if (this.form.invalid) {
      return;
    }
    this.dialogRef.close(this.form.getRawValue().nuovaPerc);
  }

  perc(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }
}