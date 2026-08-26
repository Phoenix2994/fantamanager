import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Team } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { TeamSelectionService } from '../../core/services/team-selection.service';
import { TeamService } from '../../core/services/team.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { FinanceSection } from './sections/finance-section';
import { PlayersSection } from './sections/players-section';
import { SvincolatiSection } from './sections/svincolati-section';

/**
 * Shell della dashboard con layout responsive. La squadra selezionata è
 * unica e condivisa (TeamSelectionService): il dropdown vive qui, sopra le
 * sezioni, così resta visibile e utilizzabile qualunque sezione si stia
 * guardando — anche su mobile, dove prima il dropdown viveva solo dentro
 * "Giocatori" e spariva passando a "Spese".
 * - Desktop (>1024px): 2 colonne (giocatori | spese)
 * - Tablet (640–1024px): giocatori + tab (spese/svincolati)
 * - Mobile (<640px): tab Giocatori/Spese a schermo pieno
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTabsModule,
    RouterLink,
    NavMenu,
    PlayersSection,
    SvincolatiSection,
    FinanceSection,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);

  /** Soglie coerenti con lo spec: mobile <640, tablet 640–1024, desktop >1024 */
  private static readonly MOBILE_QUERY = '(max-width: 639.98px)';
  private static readonly TABLET_QUERY = '(min-width: 640px) and (max-width: 1023.98px)';

  readonly leagueName = environment.leagueName;

  /** true se l'utente ha effettuato il login come admin */
  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });

  readonly isMobile = signal(false);
  readonly isTablet = signal(false);

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  /** Squadra selezionata, condivisa da giocatori/spese/storico */
  readonly selection = inject(TeamSelectionService);

  /** Tab attiva su mobile: 0 = Giocatori, 1 = Spese */
  readonly mobileTab = signal(0);

  constructor() {
    this.breakpointObserver
      .observe([Dashboard.MOBILE_QUERY, Dashboard.TABLET_QUERY])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ breakpoints }) => {
        this.isMobile.set(!!breakpoints[Dashboard.MOBILE_QUERY]);
        this.isTablet.set(!!breakpoints[Dashboard.TABLET_QUERY]);
      });
  }

  /** Logout: la sessione admin termina, l'utente resta come visitatore */
  async logout(): Promise<void> {
    await this.authService.logout();
  }
}