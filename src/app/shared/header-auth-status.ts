import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { Team } from '../core/models';
import { AuthService } from '../core/services/auth.service';

/**
 * Stato del login nell'header, uguale su tutte le pagine: mostra chi ha
 * fatto accesso (admin O una squadra — prima erano indistinguibili, il
 * pulsante "Accedi" restava sempre visibile anche loggati come squadra) e
 * offre il logout da lì. Un solo componente condiviso invece di ripetere la
 * stessa logica @if isAdmin()/@else in ogni pagina, per evitare che
 * restassero disallineate.
 */
@Component({
  selector: 'app-header-auth-status',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, RouterLink],
  template: `
    @if (isAdmin()) {
      <button matButton="tonal" [matMenuTriggerFor]="menu">
        <mat-icon>admin_panel_settings</mat-icon>
        Admin
      </button>
    } @else if (myTeam(); as squadra) {
      <button matButton="tonal" [matMenuTriggerFor]="menu">
        <mat-icon>shield</mat-icon>
        <span class="team-name">{{ squadra.name }}</span>
      </button>
    } @else {
      <a matButton="tonal" routerLink="/login">
        <mat-icon>login</mat-icon>
        Accedi
      </a>
    }

    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" (click)="logout()">
        <mat-icon>logout</mat-icon>
        Esci
      </button>
    </mat-menu>
  `,
  styles: `
    .team-name {
      max-width: 22vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class HeaderAuthStatus {
  private readonly authService = inject(AuthService);

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });
  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
