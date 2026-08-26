import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { SvincolatiSection } from '../dashboard/sections/svincolati-section';

/**
 * Pagina dedicata ai calciatori svincolati (/svincolati).
 * Riusa la stessa sezione incorporata nella dashboard: qui è mostrata a
 * schermo intero come destinazione del menù di navigazione mobile.
 */
@Component({
  selector: 'app-svincolati-page',
  imports: [MatButtonModule, MatIconModule, RouterLink, NavMenu, SvincolatiSection],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <mat-icon class="header-logo" aria-hidden="true">sports_soccer</mat-icon>
        <h1 class="app-title">Svincolati</h1>
        <span class="spacer"></span>
        @if (isAdmin()) {
          <button matIconButton aria-label="Esci" (click)="logout()">
            <mat-icon>logout</mat-icon>
          </button>
        } @else {
          <a matButton="tonal" routerLink="/login">
            <mat-icon>login</mat-icon>
            Accedi
          </a>
        }
      </header>

      <main class="content">
        <section class="panel">
          <app-svincolati-section />
        </section>
      </main>
    </div>
  `,
})
export class SvincolatiPage {
  private readonly authService = inject(AuthService);

  readonly leagueName = environment.leagueName;

  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
