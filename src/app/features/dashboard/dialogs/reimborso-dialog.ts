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
import { round2 } from '../../../core/finance-calculator';
import { Player } from '../../../core/models';

export type MeseIndennizzo = 'settembre' | 'gennaio';

export interface ReimborsoDialogData {
  player: Player;
}

export interface ReimborsoDialogResult {
  percRimborso: number;
  percIndennizzo: number;
  mese: MeseIndennizzo;
}

/**
 * Dialog di rimborso/rescissione di un giocatore.
 *
 * Calcoli (anteprima live):
 * - Rimborso   = % rimborso   × soldi spesi del giocatore → somma ai Rimborsi
 * - Indennizzo = % indennizzo × V.A. del giocatore        → somma agli Indennizzi
 *                di settembre o gennaio (a scelta)
 *
 * ATTENZIONE: alla conferma il giocatore viene ELIMINATO dalla rosa.
 */
@Component({
  selector: 'app-reimborso-dialog',
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
    <h2 mat-dialog-title>Rimborso: {{ data.player.name }}</h2>

    <mat-dialog-content>
      <div class="info">
        <div class="info-row">
          <span>Soldi spesi (base rimborso)</span>
          <strong>{{ data.player.acquistoRinnovoSpesa | number: '1.2-2' }} €</strong>
        </div>
        <div class="info-row">
          <span>V.A. (base indennizzo e rinnovo)</span>
          <strong>{{ data.player.valoreAttuale | number: '1.2-2' }} €</strong>
        </div>
      </div>

      <form [formGroup]="form" class="dialog-form">
        <div class="row">
          <mat-form-field appearance="fill">
            <mat-label>% rimborso</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="percRimborso" />
            <mat-hint>es. 0.5 = 50%</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="fill">
            <mat-label>% indennizzo</mat-label>
            <input matInput type="number" min="0" step="0.01" formControlName="percIndennizzo" />
            <mat-hint>es. 0.2 = 20%</mat-hint>
          </mat-form-field>
        </div>

        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Indennizzo da richiedere per</mat-label>
          <mat-select formControlName="mese">
            <mat-option value="settembre">Settembre</mat-option>
            <mat-option value="gennaio">Gennaio</mat-option>
          </mat-select>
        </mat-form-field>

        <div class="preview">
          <div class="preview-row">
            <span>Rimborso → Rimborsi</span>
            <strong>+{{ rimborsoPreview() | number: '1.2-2' }} €</strong>
          </div>
          <div class="preview-row">
            <span>Indennizzo → Indennizzi {{ form.controls.mese.value }}</span>
            <strong>+{{ indennizzoPreview() | number: '1.2-2' }} €</strong>
          </div>
        </div>

        <p class="warning">
          ⚠ Alla conferma il giocatore verrà <strong>eliminato dalla rosa</strong>.
        </p>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <!-- Chiude ESPLICITAMENTE con null: la cancellazione non deve mai
           essere confondibile con un risultato valido -->
      <button matButton type="button" [mat-dialog-close]="null">Annulla</button>
      <button matButton="filled" type="button" [disabled]="form.invalid" (click)="save()">
        Applica rimborso
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
      padding: 4px 0;
      font-size: 0.85rem;
    }

    .info-row span {
      color: var(--mat-sys-on-surface-variant);
    }

    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
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
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 8px 12px;
      margin-top: 4px;
    }

    .preview-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 3px 0;
      font-size: 0.85rem;
    }

    .preview-row span {
      color: var(--mat-sys-on-surface-variant);
    }

    .warning {
      font-size: 0.8rem;
      color: var(--mat-sys-error);
      margin: 8px 0 0;
    }
  `,
})
export class ReimborsoDialog {
  readonly data = inject<ReimborsoDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ReimborsoDialog, ReimborsoDialogResult>);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly form = this.fb.group({
    percRimborso: [0, [Validators.required, Validators.min(0)]],
    percIndennizzo: [0.2, [Validators.required, Validators.min(0)]],
    mese: ['settembre' as MeseIndennizzo, Validators.required],
  });

  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  readonly rimborsoPreview = computed(() =>
    round2(this.formValue().percRimborso * (this.data.player.acquistoRinnovoSpesa || 0)),
  );

  readonly indennizzoPreview = computed(() =>
    round2(this.formValue().percIndennizzo * (this.data.player.valoreAttuale || 0)),
  );

  save(): void {
    if (this.form.invalid) {
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }

  perc(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }
}