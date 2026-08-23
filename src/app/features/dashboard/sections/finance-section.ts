import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  DEFAULT_TAX_BRACKETS,
  EMPTY_FINANCE_INPUTS,
  SeasonFinance,
  SeasonFinanceInputs,
  TaxBracket,
} from '../../../core/models';
import { AuthService } from '../../../core/services/auth.service';
import { FinanceService } from '../../../core/services/finance.service';
import { TeamSelectionService } from '../../../core/services/team-selection.service';
import { TeamService } from '../../../core/services/team.service';

interface RowDef {
  key: keyof SeasonFinanceInputs;
  label: string;
}

const ENTRATE: RowDef[] = [
  { key: 'indennizzoSettembre', label: 'Indennizzo settembre' },
  { key: 'indennizzoGennaio', label: 'Indennizzo gennaio' },
  { key: 'rimborsi', label: 'Rimborsi' },
  { key: 'trasferimentiEntrata', label: 'Proventi da trasferimenti' },
  { key: 'premi', label: 'Premi' }
];

const USCITE: RowDef[] = [
  { key: 'rinnovi', label: 'Rinnovi' },
  { key: 'acquistiAstaSettembre', label: 'Asta settembre' },
  { key: 'acquistiMercatoInfrasettimanale', label: 'Asta infrasettimanale' },
  { key: 'acquistiAstaGennaio', label: 'Asta gennaio' },
  { key: 'rescissioni', label: 'Rescissioni' },
  { key: 'trasferimentiUscita', label: 'Costi per trasferimenti' },
  { key: 'penali', label: 'Multe condotta antisportiva' },
  { key: 'tasse', label: 'Multe fairplay finanziario' }
];

interface ComputedRow {
  label: string;
  value: number;
  /** true se il valore negativo è un'anomalia da evidenziare in rosso */
  warnNegative?: boolean;
}

type FinanceForm = FormGroup<Record<keyof SeasonFinanceInputs, FormControl<number>>>;

@Component({
  selector: 'app-finance-section',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: `
    <div class="section-header">
      <h2>Spese societarie — {{ season }}</h2>
      @if (isAdmin() && selectedTeamId()) {
        @if (editing()) {
          <div class="header-actions">
            <button matButton (click)="cancelEdit()">
              <mat-icon>close</mat-icon>
              Annulla
            </button>
            <button matButton="filled" (click)="save()">
              <mat-icon>save</mat-icon>
              Salva
            </button>
          </div>
        } @else {
          <button matButton="tonal" (click)="enterEdit()">
            <mat-icon>edit</mat-icon>
            Modifica
          </button>
        }
      }
    </div>

    @if (!selectedTeamId()) {
      <p class="empty-state">Seleziona una squadra nella sezione Rosa.</p>
    } @else if (!editing() && !finance()) {
      <p class="empty-state">
        Nessun dato di spesa per questa squadra.
        @if (isAdmin()) {
          Usa "Modifica" per inserire i valori.
        }
      </p>
    } @else {
      <div class="finance-grid" [formGroup]="financeForm ?? emptyForm">
        <!-- ENTRATE -->
        <div class="group">
          <h3>Entrate</h3>
          @for (row of entrate; track row.key) {
            <div class="row">
              <span>{{ row.label }}</span>
              @if (editing() && financeForm) {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="edit-field">
                  <input matInput type="number" step="0.01" [formControlName]="row.key" />
                </mat-form-field>
              } @else {
                <strong [class.negative]="isNegative(row.key)">
                  {{ valueOf(row.key) | number: '1.2-2' }} €
                </strong>
              }
            </div>
          }
        </div>

        <!-- USCITE -->
        <div class="group">
          <h3>Uscite</h3>
          @for (row of uscite; track row.key) {
            <div class="row">
              <span>{{ row.label }}</span>
              @if (editing() && financeForm) {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="edit-field">
                  <input matInput type="number" step="0.01" [formControlName]="row.key" />
                </mat-form-field>
              } @else {
                <strong [class.negative]="isNegative(row.key)">
                  {{ valueOf(row.key) | number: '1.2-2' }} €
                </strong>
              }
            </div>
          }
        </div>

        <!-- BILANCIO (primo campo editabile, resto read-only) -->
        <div class="group computed">
          <h3>Bilancio</h3>
          <div class="row">
            <span>Soldi versati alla Lega</span>
            @if (editing() && financeForm) {
              <mat-form-field appearance="outline" subscriptSizing="dynamic" class="edit-field">
                <input matInput type="number" step="0.01" formControlName="soldiVersati" />
              </mat-form-field>
            } @else {
              <strong>{{ valueOf('soldiVersati') | number: '1.2-2' }} €</strong>
            }
          </div>
          @for (row of calcolati(); track row.label) {
            <div class="row">
              <span>{{ row.label }}</span>
              <strong [class.negative]="row.warnNegative && row.value < 0">
                {{ row.value | number: '1.2-2' }} €
              </strong>
            </div>
          }
        </div>

        <!-- FAIR PLAY FINANZIARIO -->
        <div class="group computed">
          <h3>Fairplay finanziario</h3>
          <div class="row">
            <span>Imponibile fairplay finanziario</span>
            <strong [class.negative]="imponibile() < 0">
              {{ imponibile() | number: '1.2-2' }} €
            </strong>
          </div>
          <table class="brackets">
            <thead>
              <tr>
                <th>Scaglione</th>
                <th>Soglia €</th>
                <th>Aliquota</th>
              </tr>
            </thead>
            <tbody>
              @for (b of brackets(); track b.bracketIndex) {
                <tr [class.active]="isBracketActive(b)">
                  <td>{{ b.bracketIndex }}</td>
                  <td>{{ b.limiteSogliaEuro | number: '1.2-2' }}</td>
                  <td>{{ percentuale(b.aliquota) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
  styles: `
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    h3 {
      margin: 0 0 8px;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--mat-sys-on-surface-variant);
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }

    .finance-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .group {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 12px;
    }

    .group.computed {
      background: var(--mat-sys-surface-container-lowest, #fafafa);
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.875rem;
      min-height: 40px;
    }

    .row span {
      color: var(--mat-sys-on-surface-variant);
    }

    .edit-field {
      width: 140px;
    }

    .negative {
      color: var(--mat-sys-error);
    }

    .brackets {
      width: 100%;
      margin-top: 8px;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    .brackets th,
    .brackets td {
      padding: 4px 6px;
      text-align: right;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
    }

    .brackets th:first-child,
    .brackets td:first-child {
      text-align: left;
    }

    .brackets th {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 500;
    }

    .brackets tr.active td {
      font-weight: 700;
      color: var(--mat-sys-primary);
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `,
})
export class FinanceSection {
  private readonly financeService = inject(FinanceService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly selection = inject(TeamSelectionService);
  readonly selectedTeamId = this.selection.selectedTeamId;

  readonly season = environment.season;

  readonly entrate = ENTRATE;
  readonly uscite = USCITE;

  readonly isAdmin = toSignal(this.authService.isAuthenticated$, { initialValue: false });
  readonly editing = signal(false);

  financeForm: FinanceForm | null = null;

  /** Form vuoto: usato come parent quando non si è in editing */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected readonly emptyForm = new FormGroup({}) as any;

  readonly finance = toSignal(
    toObservable(this.selectedTeamId).pipe(
      switchMap((id) =>
        id
          ? this.financeService.seasonFinance$(id)
          : of(undefined as SeasonFinance | undefined),
      ),
    ),
    { initialValue: undefined as SeasonFinance | undefined },
  );

  /** Giocatori della squadra selezionata: servono per il valore rosa */
  private readonly players = toSignal(
    toObservable(this.selectedTeamId).pipe(
      switchMap((id) =>
        id ? this.teamService.players$(id) : of([] as { valoreAttuale: number }[]),
      ),
    ),
    { initialValue: [] as { valoreAttuale: number }[] },
  );

  readonly valoreRosa = computed(() =>
    Math.round(this.players().reduce((sum, p) => sum + (p.valoreAttuale || 0), 0) * 100) / 100,
  );

  /** Scaglioni fiscali della lega (con fallback ai default) */
  readonly brackets = toSignal(this.financeService.taxBrackets$, {
    initialValue: [...DEFAULT_TAX_BRACKETS] as TaxBracket[],
  });

  /** Imponibile fair play finanziario = spesa annuale */
  readonly imponibile = computed(() => this.finance()?.spesaAnnuale ?? 0);

  /** true se l'imponibile corrente rientra in questo scaglione */
  isBracketActive(b: TaxBracket): boolean {
    const sorted = this.brackets().sort((x, y) => x.bracketIndex - y.bracketIndex);
    const idx = sorted.indexOf(b);
    const next = idx + 1 < sorted.length ? sorted[idx + 1].limiteSogliaEuro : Infinity;
    const imp = this.imponibile();
    return imp > b.limiteSogliaEuro && imp <= next;
  }

  /** 0.35 → "35%" */
  percentuale(aliquota: number): string {
    return `${Math.round((aliquota || 0) * 100)}%`;
  }

  readonly calcolati = computed<ComputedRow[]>(() => {
    const f = this.finance();
    if (!f) {
      return [];
    }
    return [
      { label: 'Bilancio stagionale', value: f.bilancioSocietarioStagionale, warnNegative: true },
    ];
  });

  valueOf(key: keyof SeasonFinanceInputs): number {
    return this.finance()?.[key] ?? 0;
  }

  isNegative(key: keyof SeasonFinanceInputs): boolean {
    return (this.finance()?.[key] ?? 0) < 0;
  }

  enterEdit(): void {
    const current = this.finance();
    const values: SeasonFinanceInputs = current
      ? {
          rinnovi: current.rinnovi,
          acquistiMercatoInfrasettimanale: current.acquistiMercatoInfrasettimanale ?? 0,
          acquistiAstaSettembre: current.acquistiAstaSettembre,
          acquistiAstaGennaio: current.acquistiAstaGennaio,
          rescissioni: current.rescissioni,
          penali: current.penali,
          trasferimentiUscita: current.trasferimentiUscita,
          trasferimentiEntrata: current.trasferimentiEntrata,
          indennizzoSettembre: current.indennizzoSettembre,
          indennizzoGennaio: current.indennizzoGennaio,
          rimborsi: current.rimborsi,
          premi: current.premi,
          soldiVersati: current.soldiVersati,
          tasse: current.tasse,
        }
      : { ...EMPTY_FINANCE_INPUTS };

    const controls = {} as Record<keyof SeasonFinanceInputs, FormControl<number>>;
    for (const key of Object.keys(values) as (keyof SeasonFinanceInputs)[]) {
      controls[key] = this.fb.control(values[key]);
    }
    this.financeForm = this.fb.group(controls);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.financeForm = null;
  }

  async save(): Promise<void> {
    if (!this.financeForm || !this.selectedTeamId()) {
      return;
    }
    const partial = this.financeForm.getRawValue();
    try {
      await this.financeService.saveFinanceInputs(
        this.selectedTeamId()!,
        partial,
        this.valoreRosa(),
        this.finance(),
      );
      this.snackBar.open('Spese salvate e ricalcolate', undefined, { duration: 2500 });
      this.cancelEdit();
    } catch {
      this.snackBar.open('Errore durante il salvataggio', undefined, { duration: 3000 });
    }
  }
}
