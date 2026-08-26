import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  template: `
    <div class="login-wrapper">
      <mat-card class="login-card">
        <div class="logo-row">
          <mat-icon class="logo" aria-hidden="true">sports_soccer</mat-icon>
          <h1>{{ leagueName }}</h1>
          <p class="subtitle">
            Accesso amministratori — la consultazione è libera,
            inserisci la password della lega solo per gestire i dati
          </p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()">
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
            @if (form.controls.password.hasError('required')) {
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
            {{ loading() ? 'Accesso in corso…' : 'Accedi' }}
          </button>
        </form>
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
      margin-bottom: 24px;
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
  `,
})
export class Login {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly leagueName = environment.leagueName;

  readonly hide = signal(true);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.formBuilder.group({
    password: ['', Validators.required],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      await this.authService.login(this.form.getRawValue().password);
      await this.router.navigateByUrl('/dashboard');
    } catch {
      this.error.set('Password errata. Riprova.');
    } finally {
      this.loading.set(false);
    }
  }
}