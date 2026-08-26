import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ThemeService } from '../services/theme.service';

/** Voce del menù di navigazione principale */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  /** true se la voce va mostrata solo agli admin loggati */
  adminOnly?: boolean;
}

/**
 * Voci del menù principale dell'app.
 * Per aggiungere una sezione (es. futura area admin) basta una nuova riga qui.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/svincolati', label: 'Svincolati', icon: 'person_search' },
  { path: '/asta', label: 'Asta', icon: 'gavel' },
  { path: '/scambi', label: 'Scambi', icon: 'swap_horiz' },
  { path: '/storico', label: 'Storico', icon: 'history', adminOnly: true },
];

/**
 * Menù di navigazione principale (hamburger).
 * Riutilizzabile nell'header di ogni pagina: apre un menù Material con le
 * voci di NAV_ITEMS ed evidenzia la rotta attiva (routerLinkActive).
 * Il contenuto del mat-menu mantiene gli attributi di scoping del componente,
 * quindi la classe .nav-active funziona anche nel pannello overlay.
 */
@Component({
  selector: 'app-nav-menu',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    RouterLink,
    RouterLinkActive,
  ],
  template: `
    <button
      matIconButton
      type="button"
      [matMenuTriggerFor]="menu"
      aria-label="Apri menù di navigazione"
    >
      <mat-icon>menu</mat-icon>
    </button>
    <mat-menu #menu="matMenu" xPosition="before">
      @for (item of items(); track item.path) {
        <button
          type="button"
          mat-menu-item
          [routerLink]="item.path"
          routerLinkActive="nav-active"
        >
          <mat-icon>{{ item.icon }}</mat-icon>
          <span>{{ item.label }}</span>
        </button>
      }
      <mat-divider />
      <button type="button" mat-menu-item (click)="themeService.toggle()">
        <mat-icon>{{ themeService.tema() === 'scuro' ? 'light_mode' : 'dark_mode' }}</mat-icon>
        <span>Tema {{ themeService.tema() === 'scuro' ? 'chiaro' : 'scuro' }}</span>
      </button>
    </mat-menu>
  `,
  styles: `
    .nav-active {
      color: var(--mat-sys-primary, #1976d2);
      font-weight: 600;
    }

    .nav-active mat-icon {
      color: var(--mat-sys-primary, #1976d2);
    }
  `,
})
export class NavMenu {
  private readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);

  private readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  /** Voci visibili: quelle admin-only compaiono solo per l'admin loggato */
  protected readonly items = computed(() =>
    NAV_ITEMS.filter((item) => !item.adminOnly || this.isAdmin()),
  );
}
