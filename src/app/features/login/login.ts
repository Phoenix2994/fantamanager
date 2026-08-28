import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { environment } from '../../../environments/environment';
import { Team } from '../../core/models';
import { AuthService, teamLoginEmail } from '../../core/services/auth.service';
import { TeamSelectionService } from '../../core/services/team-selection.service';
import { TeamService } from '../../core/services/team.service';
import { TeamLogo } from '../../shared/team-logo';

type Modalita = 'admin' | 'squadra';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TeamLogo,
  ],
  template: `
    <div class="login-wrapper">
      <mat-card class="login-card">
        <div class="logo-row">
          <img src="icons/logo-emblema.png" class="logo" alt="" />
          <h1>{{ leagueName }}</h1>
          <p class="subtitle">
            La consultazione è libera — accedi solo per gestire i dati (admin)
            o per le funzioni riservate alla tua squadra
          </p>
        </div>

        <mat-button-toggle-group
          class="mode-toggle"
          [value]="modalita()"
          (change)="modalita.set($event.value)"
        >
          <mat-button-toggle value="squadra">La mia squadra</mat-button-toggle>
          <mat-button-toggle value="admin">Admin</mat-button-toggle>
        </mat-button-toggle-group>

        @if (modalita() === 'admin') {
          <form [formGroup]="adminForm" (ngSubmit)="submitAdmin()">
            <mat-form-field appearance="fill" class="full-width">
              <mat-label>Password della lega</mat-label>
              <input
                matInput
                [type]="hide() ? 'password' : 'text'"
                formControlName="password"
                autocomplete="current-password"
              />
              <button
                type="button"
                matIconButton
                matSuffix
                (click)="hide.set(!hide())"
                [attr.aria-label]="'Mostra o nascondi la password'"
              >
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (adminForm.controls.password.hasError('required')) {
                <mat-error>Inserisci la password</mat-error>
              }
            </mat-form-field>

            @if (error()) {
              <p class="error" role="alert">{{ error() }}</p>
            }

            <button
              matButton="filled"
              type="submit"
              class="submit-btn full-width"
              [disabled]="loading()"
            >
              {{ loading() ? 'Accesso in corso…' : 'Accedi come admin' }}
            </button>
          </form>
        } @else {
          <form [formGroup]="squadraForm" (ngSubmit)="submitSquadra()">
            <mat-form-field appearance="fill" class="full-width">
              <mat-label>Squadra</mat-label>
              <mat-select formControlName="teamId">
                @for (team of teams(); track team.id) {
                  <mat-option [value]="team.id">
                    <span class="option-row">
                      <app-team-logo [name]="team.name" class="option-logo" />
                      {{ team.name }}
                    </span>
                  </mat-option>
                }
              </mat-select>
              @if (squadraForm.controls.teamId.hasError('required')) {
                <mat-error>Seleziona la tua squadra</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="fill" class="full-width">
              <mat-label>Password della squadra</mat-label>
              <input
                matInput
                [type]="hide() ? 'password' : 'text'"
                formControlName="password"
                autocomplete="current-password"
              />
              <button
                type="button"
                matIconButton
                matSuffix
                (click)="hide.set(!hide())"
                [attr.aria-label]="'Mostra o nascondi la password'"
              >
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (squadraForm.controls.password.hasError('required')) {
                <mat-error>Inserisci la password</mat-error>
              }
            </mat-form-field>

            @if (error()) {
              <p class="error" role="alert">{{ error() }}</p>
            }

            <button
              matButton="filled"
              type="submit"
              class="submit-btn full-width"
              [disabled]="loading()"
            >
              {{ loading() ? 'Accesso in corso…' : 'Accedi alla mia squadra' }}
            </button>
          </form>
        }
      </mat-card>
    </div>
  `,
  styles: `
    .login-wrapper {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background:
        radial-gradient(circle at 20% 20%, rgba(25, 118, 210, 0.08), transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(245, 124, 0, 0.08), transparent 40%);
    }

    .login-card {
      width: 100%;
      max-width: 400px;
      padding: 32px 24px;
    }

    .logo-row {
      text-align: center;
      margin-bottom: 20px;
    }

    .logo {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--mat-sys-primary);
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 8px 0 4px;
    }

    .subtitle {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
      margin: 0;
    }

    .mode-toggle {
      display: flex;
      width: 100%;
      margin-bottom: 20px;
    }

    .mode-toggle ::ng-deep .mat-button-toggle {
      flex: 1;
      text-align: center;
    }

    .full-width {
      width: 100%;
    }

    .error {
      color: var(--mat-sys-error);
      font-size: 0.875rem;
      margin: 4px 0 8px;
    }

    .submit-btn {
      height: 48px;
      margin-top: 8px;
    }

    .option-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .option-logo {
      width: 22px;
      height: 22px;
    }
  `,
})
export class Login {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly selection = inject(TeamSelectionService);
  private readonly router = inject(Router);

  readonly leagueName = environment.leagueName;

  readonly modalita = signal<Modalita>('squadra');
  readonly hide = signal(true);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  readonly adminForm = this.formBuilder.group({
    password: ['', Validators.required],
  });

  readonly squadraForm = this.formBuilder.group({
    teamId: ['', Validators.required],
    password: ['', Validators.required],
  });

  async submitAdmin(): Promise<void> {
    if (this.adminForm.invalid) {
      this.adminForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.login(this.adminForm.getRawValue().password);
      await this.router.navigateByUrl('/dashboard');
    } catch {
      this.error.set('Password errata. Riprova.');
    } finally {
      this.loading.set(false);
    }
  }

  async submitSquadra(): Promise<void> {
    if (this.squadraForm.invalid) {
      this.squadraForm.markAllAsTouched();
      return;
    }

    const { teamId, password } = this.squadraForm.getRawValue();
    const team = this.teams().find((t) => t.id === teamId);
    if (!team) {
      this.error.set('Squadra non trovata.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.loginTeam(teamLoginEmail(team.name), password);
      // Selezione esplicita, non lasciata al solo auto-select "se non c'è
      // già una squadra selezionata": TeamSelectionService è un signal
      // singleton che sopravvive alla navigazione SPA verso /dashboard, e
      // se nel tab era già rimasta selezionata un'altra squadra (da una
      // navigazione precedente, anche da anonimi) l'auto-select non la
      // sovrascrive mai — occorre imporla qui, al momento del login.
      this.selection.select(team.id);
      await this.router.navigateByUrl('/dashboard');
    } catch {
      this.error.set('Password errata. Riprova.');
    } finally {
      this.loading.set(false);
    }
  }
}
