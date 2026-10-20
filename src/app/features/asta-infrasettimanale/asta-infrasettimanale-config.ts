import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AstaInfrasettimanaleConfig, MomentoSettimanale } from '../../core/models';
import { LeagueService } from '../../core/services/league.service';

/** Etichette dei giorni nell'ordine di Date.getDay() (0 = domenica) */
const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

const DEFAULT_CONFIG: AstaInfrasettimanaleConfig = {
  abilitata: true,
  inizioChiamata: { giorno: 2, ora: '10:00' },
  inizioSoloRilanci: { giorno: 2, ora: '17:00' },
  inizioBuste: { giorno: 3, ora: '00:00' },
  inizioAssegnazione: { giorno: 3, ora: '14:00' },
};

/**
 * Pannello admin (dentro la sezione Svincolati) per configurare giorno e ora
 * delle 4 fasi dell'asta infrasettimanale, senza bisogno di un rilascio della
 * webapp — vedi memoria di progetto "asta-infrasettimanale-piano" per la
 * meccanica completa. Fuso orario: Europe/Rome (i valori sono ora locale,
 * l'interpretazione del fuso è compito di chi legge la configurazione).
 */
@Component({
  selector: 'app-asta-infrasettimanale-config',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <mat-expansion-panel class="config-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>
          <mat-icon>event_repeat</mat-icon>
          Asta infrasettimanale
        </mat-panel-title>
        <mat-panel-description>
          {{ form.controls.abilitata.value ? 'Abilitata' : 'Disabilitata per il prossimo ciclo' }}
        </mat-panel-description>
      </mat-expansion-panel-header>

      <form [formGroup]="form" class="config-form">
        <mat-slide-toggle formControlName="abilitata">
          Abilita il prossimo ciclo di asta infrasettimanale
        </mat-slide-toggle>

        <p class="hint">
          Ciclo ricorrente ogni settimana, orario Europe/Rome. Le 4 fasi devono susseguirsi in ordine:
          chiamata → solo rilanci → buste → assegnazione admin.
        </p>

        <div class="fase" formGroupName="inizioChiamata">
          <span class="fase-label">Inizio chiamata (0,10 €)</span>
          <div class="fase-row">
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Giorno</mat-label>
              <mat-select formControlName="giorno">
                @for (g of giorni; track g.value) {
                  <mat-option [value]="g.value">{{ g.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Ora</mat-label>
              <input matInput type="time" formControlName="ora" />
            </mat-form-field>
          </div>
        </div>

        <div class="fase" formGroupName="inizioSoloRilanci">
          <span class="fase-label">Inizio "solo rilanci" (niente nuove chiamate)</span>
          <div class="fase-row">
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Giorno</mat-label>
              <mat-select formControlName="giorno">
                @for (g of giorni; track g.value) {
                  <mat-option [value]="g.value">{{ g.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Ora</mat-label>
              <input matInput type="time" formControlName="ora" />
            </mat-form-field>
          </div>
        </div>

        <div class="fase" formGroupName="inizioBuste">
          <span class="fase-label">Inizio buste (rilanci chiusi)</span>
          <div class="fase-row">
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Giorno</mat-label>
              <mat-select formControlName="giorno">
                @for (g of giorni; track g.value) {
                  <mat-option [value]="g.value">{{ g.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Ora</mat-label>
              <input matInput type="time" formControlName="ora" />
            </mat-form-field>
          </div>
        </div>

        <div class="fase" formGroupName="inizioAssegnazione">
          <span class="fase-label">Inizio assegnazione admin (buste chiuse)</span>
          <div class="fase-row">
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Giorno</mat-label>
              <mat-select formControlName="giorno">
                @for (g of giorni; track g.value) {
                  <mat-option [value]="g.value">{{ g.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="fill" subscriptSizing="dynamic">
              <mat-label>Ora</mat-label>
              <input matInput type="time" formControlName="ora" />
            </mat-form-field>
          </div>
        </div>

        <button matButton="filled" type="button" (click)="salva()" [disabled]="salvataggioInCorso()">
          Salva configurazione
        </button>
      </form>
    </mat-expansion-panel>
  `,
  styles: `
    :host {
      display: block;
    }

    .config-panel {
      border-radius: 16px !important;
      margin-bottom: 12px;
    }

    .config-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-top: 4px;
    }

    .hint {
      margin: 0;
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .fase {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .fase-label {
      font-size: 0.8rem;
      font-weight: 600;
    }

    .fase-row {
      display: flex;
      gap: 8px;
    }

    .fase-row mat-form-field {
      flex: 1;
    }
  `,
})
export class AstaInfrasettimanaleConfigPanel {
  private readonly leagueService = inject(LeagueService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly giorni = GIORNI.map((label, value) => ({ value, label }));

  private readonly configCorrente = toSignal(this.leagueService.astaInfrasettimanaleConfig$, {
    initialValue: undefined as AstaInfrasettimanaleConfig | undefined,
  });

  readonly salvataggioInCorso = signal(false);

  readonly form = this.fb.group({
    abilitata: DEFAULT_CONFIG.abilitata,
    inizioChiamata: this.momentoGroup(DEFAULT_CONFIG.inizioChiamata),
    inizioSoloRilanci: this.momentoGroup(DEFAULT_CONFIG.inizioSoloRilanci),
    inizioBuste: this.momentoGroup(DEFAULT_CONFIG.inizioBuste),
    inizioAssegnazione: this.momentoGroup(DEFAULT_CONFIG.inizioAssegnazione),
  });

  constructor() {
    // Sovrascrive i default col valore reale da Firestore appena arriva —
    // ma non se l'admin ha già modificato il form (form "sporco"), per non
    // perdere una modifica in corso quando il documento cambia in realtime.
    effect(() => {
      const config = this.configCorrente();
      if (config && !this.form.dirty) {
        this.form.patchValue(config);
      }
    });
  }

  private momentoGroup(valore: MomentoSettimanale) {
    return this.fb.group({
      giorno: valore.giorno,
      ora: valore.ora,
    });
  }

  async salva(): Promise<void> {
    if (this.form.invalid) {
      return;
    }
    this.salvataggioInCorso.set(true);
    try {
      await this.leagueService.salvaAstaInfrasettimanaleConfig(this.form.getRawValue());
      this.snackBar.open('Configurazione salvata', undefined, { duration: 2500 });
      this.form.markAsPristine();
    } catch {
      this.snackBar.open('Errore durante il salvataggio', undefined, { duration: 3000 });
    } finally {
      this.salvataggioInCorso.set(false);
    }
  }
}
