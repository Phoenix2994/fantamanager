import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** Voce del menù di navigazione principale */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
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
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink, RouterLinkActive],
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
      @for (item of items; track item.path) {
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
  protected readonly items = NAV_ITEMS;
}
