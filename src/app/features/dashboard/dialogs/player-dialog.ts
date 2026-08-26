import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  calcolaProssimaSpesaRinnovo,
  calcolaValoreAttuale,
} from '../../../core/finance-calculator';
import { CONTRACT_TYPES, Player } from '../../../core/models';

/** Da dove arriva il giocatore: determina la voce di spesa da incrementare */
export type ProvenienzaAcquisto =
  | 'astaSettembre'
  | 'infrasettimanale'
  | 'astaGennaio'
  | 'trasferimenti';

export interface PlayerDialogData {
  mode: 'create' | 'edit';
  player?: Player;
}

/** Risultato del dialog: dati giocatore + provenienza dell'acquisto */
export interface PlayerDialogResult {
  name: string;
  ruolo: string;
  contractType: string;
  acquistoRinnovoSpesa: number;
  prossimaPercRinnovo: number;
  quotazioneIniziale: number;
  quotazioneAttuale: number;
  valoreIniziale: number;
  provenienza: ProvenienzaAcquisto;
}

/**
 * Dialog di creazione/modifica giocatore.
 * In creazione chiede anche la provenienza dell'acquisto: i soldi spesi
 * verranno sommati alla voce di spesa corrispondente.
 */
@Component({
  selector: 'app-player-dialog',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data.mode === 'create' ? 'Nuovo giocatore' : 'Modifica: ' + data.player?.name }}
    </h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field appearance="fill">
          <mat-label>Nome</mat-label>
          <input matInput formControlName="name" />
        </mat-form-field>

        <div class="row">
          <mat-form-field appearance="fill">
            <mat-label>Ruolo</mat-label>
            <input matInput formControlName="ruolo" placeholder="es. Dc oppure Dd;Dc" />
          </mat-form-field>

          <mat-form-field appearance="fill">
            <mat-label>Contratto</mat-label>
            <mat-select formControlName="contractType">
              @for (tipo of contractTypes; track tipo) {
                <mat-option [value]="tipo">{{ tipo }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="row">
          <mat-form-field appearance="fill">
            <mat-label>Soldi spesi €</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="acquistoRinnovoSpesa" />
          </mat-form-field>

          <mat-form-field appearance="fill">
            <mat-label>% prossimo rinnovo</mat-label>
            <input matInput type="number" min="0.01" step="0.001" formControlName="prossimaPercRinnovo" />
            <mat-hint>es. 0.85 = 85%</mat-hint>
          </mat-form-field>
        </div>

        @if (data.mode === 'create') {
          <mat-form-field appearance="fill" class="full-width">
            <mat-label>Provenienza acquisto</mat-label>
            <mat-select formControlName="provenienza">
              <mat-option value="astaSettembre">Asta di settembre</mat-option>
              <mat-option value="infrasettimanale">Asta infrasettimanale</mat-option>
              <mat-option value="astaGennaio">Asta di gennaio</mat-option>
              <mat-option value="trasferimenti">Trasferimenti</mat-option>
            </mat-select>
            <mat-hint>I soldi spesi vengono sommati alla voce di spesa scelta</mat-hint>
          </mat-form-field>
        }

        <div class="row">
          <mat-form-field appearance="fill">
            <mat-label>Q.I.</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="quotazioneIniziale" />
          </mat-form-field>

          <mat-form-field appearance="fill">
            <mat-label>Q.A.</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="quotazioneAttuale" />
          </mat-form-field>

          <mat-form-field appearance="fill">
            <mat-label>V.I. €</mat-label>
            <input matInput type="number" min="0" step="0.1" formControlName="valoreIniziale" />
          </mat-form-field>
        </div>

        <p class="preview">
          V.A. calcolato: <strong>{{ valoreAttualePreview() | number: '1.2-2' }} €</strong>
          · Spesa rinnovo: <strong>{{ spesaRinnovoPreview() | number: '1.2-2' }} €</strong>
        </p>
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
      min-width: 320px;
    }

    .row {
      display: flex;
      gap: 8px;
    }

    .row mat-form-field {
      flex: 1;
    }

    .full-width {
      width: 100%;
    }

    .preview {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 4px 0 0;
    }
  `,
})
export class PlayerDialog {
  readonly data = inject<PlayerDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PlayerDialog, PlayerDialogResult>);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly contractTypes = CONTRACT_TYPES;

  readonly form = this.fb.group({
    name: [this.data.player?.name ?? '', Validators.required],
    ruolo: [this.data.player?.ruolo ?? '', Validators.required],
    contractType: [this.data.player?.contractType ?? CONTRACT_TYPES[0], Validators.required],
    acquistoRinnovoSpesa: [this.data.player?.acquistoRinnovoSpesa ?? 0],
    prossimaPercRinnovo: [
      this.data.player?.prossimaPercRinnovo ?? 1,
      [Validators.required, Validators.min(0.01)],
    ],
    quotazioneIniziale: [this.data.player?.quotazioneIniziale ?? 0],
    quotazioneAttuale: [this.data.player?.quotazioneAttuale ?? 0],
    valoreIniziale: [this.data.player?.valoreIniziale ?? 0],
    provenienza: ['astaSettembre' as ProvenienzaAcquisto, Validators.required],
  });

  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  readonly valoreAttualePreview = computed(() => {
    const v = this.formValue();
    return calcolaValoreAttuale(v.valoreIniziale, v.quotazioneIniziale, v.quotazioneAttuale);
  });

  readonly spesaRinnovoPreview = computed(() =>
    calcolaProssimaSpesaRinnovo(this.valoreAttualePreview(), this.formValue().prossimaPercRinnovo),
  );

  save(): void {
    if (this.form.invalid) {
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }
}