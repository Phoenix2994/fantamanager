import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { NavMenu } from '../../core/nav/nav-menu';

/**
 * Pagina degli scambi tra squadre (/scambi).
 * Al momento è un placeholder con empty state: il contenuto reale
 * (proposta/accettazione scambi) sarà aggiunto in una prossima fase.
 */
@Component({
  selector: 'app-scambi-page',
  imports: [MatButtonModule, MatIconModule, RouterLink, NavMenu],
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
          <div class="empty-state">
            <mat-icon aria-hidden="true">swap_horiz</mat-icon>
            <h2>Scambi</h2>
            <p>
              La gestione degli scambi tra le squadre della lega sarà disponibile
              a breve. Torna su questa pagina per proporre e valutare gli scambi
              di giocatori.
            </p>
          </div>
        </section>
      </main>
    </div>
  `,
})
export class ScambiPage {
  private readonly authService = inject(AuthService);

  readonly leagueName = environment.leagueName;

  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
