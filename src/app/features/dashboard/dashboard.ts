import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { FinanceSection } from './sections/finance-section';
import { HistorySection } from './sections/history-section';
import { PlayersSection } from './sections/players-section';

export type SectionKey = 'players' | 'finance' | 'history';

/**
 * Shell della dashboard con layout responsive:
 * - Desktop (>1024px): 3 colonne (giocatori | spese | storico)
 * - Tablet (640–1024px): giocatori + tab (spese/storico)
 * - Mobile (<640px): sezione attiva a schermo pieno + bottom nav
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    RouterLink,
    PlayersSection,
    FinanceSection,
    HistorySection,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);

  /** Soglie coerenti con lo spec: mobile <640, tablet 640–1024, desktop >1024 */
  private static readonly MOBILE_QUERY = '(max-width: 639.98px)';
  private static readonly TABLET_QUERY = '(min-width: 640px) and (max-width: 1023.98px)';

  readonly leagueName = environment.leagueName;

  /** true se l'utente ha effettuato il login come admin */
  readonly isAdmin = toSignal(this.authService.isAuthenticated$, {
    initialValue: false,
  });

  readonly isMobile = signal(false);
  readonly isTablet = signal(false);

  /** Sezione attiva su mobile e tablet */
  readonly activeSection = signal<SectionKey>('players');

  constructor() {
    this.breakpointObserver
      .observe([Dashboard.MOBILE_QUERY, Dashboard.TABLET_QUERY])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ breakpoints }) => {
        this.isMobile.set(!!breakpoints[Dashboard.MOBILE_QUERY]);
        this.isTablet.set(!!breakpoints[Dashboard.TABLET_QUERY]);
      });
  }

  selectSection(section: SectionKey): void {
    this.activeSection.set(section);
  }

  /** Logout: la sessione admin termina, l'utente resta come visitatore */
  async logout(): Promise<void> {
    await this.authService.logout();
  }
}