import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { HistorySection } from '../dashboard/sections/history-section';

/**
 * Pagina dedicata allo storico operazioni (/storico), raggiungibile dal
 * menù di navigazione principale — prima era una sezione incorporata nella
 * dashboard (colonna desktop / tab tablet / voce bottom-nav mobile).
 * Visibile solo agli admin, come lo era lì.
 */
@Component({
  selector: 'app-storico-page',
  imports: [MatButtonModule, MatIconModule, RouterLink, NavMenu, HistorySection],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <mat-icon class="header-logo" aria-hidden="true">sports_soccer</mat-icon>
        <h1 class="app-title">{{ leagueName }}</h1>
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
          @if (isAdmin()) {
            <app-history-section />
          } @else {
            <p class="solo-admin">Accedi come admin per vedere lo storico operazioni.</p>
          }
        </section>
      </main>
    </div>
  `,
  styles: `
    .solo-admin {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `,
})
export class StoricoPage {
  private readonly authService = inject(AuthService);

  readonly leagueName = environment.leagueName;

  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
