import { Component, inject } from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { LOAN_CONTRACT_TYPES, LoanContractType } from '../../../core/models';

export interface LoanDialogData {
  /** Nomi delle squadre della lega (per il select destinatario) */
  teamNames: string[];
}

export interface LoanDialogResult {
  playerName: string;
  toTeam: string;
  contractType: LoanContractType;
}

/** Dialog di registrazione giocatore ceduto in prestito. */
@Component({
  selector: 'app-loan-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>Nuovo prestito</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field appearance="outline">
          <mat-label>Giocatore</mat-label>
          <input matInput formControlName="playerName" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Squadra destinataria</mat-label>
          <mat-select formControlName="toTeam">
            @for (name of data.teamNames; track name) {
              <mat-option [value]="name">{{ name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Tipo di prestito</mat-label>
          <mat-select formControlName="contractType">
            @for (tipo of loanTypes; track tipo) {
              <mat-option [value]="tipo">{{ tipo }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: la cancellazione non deve mai
           essere confondibile con un risultato valido -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button matButton="filled" type="button" [disabled]="form.invalid" (click)="save()">
        Salva
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 300px;
    }
  `,
})
export class LoanDialog {
  readonly data = inject<LoanDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<LoanDialog, LoanDialogResult>);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loanTypes = LOAN_CONTRACT_TYPES;

  readonly form = this.fb.group({
    playerName: ['', Validators.required],
    toTeam: ['', Validators.required],
    contractType: [LOAN_CONTRACT_TYPES[0], Validators.required],
  });

  save(): void {
    if (this.form.invalid) {
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }
}