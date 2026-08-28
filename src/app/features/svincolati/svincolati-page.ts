import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { SvincolatiSection } from '../dashboard/sections/svincolati-section';

/**
 * Pagina dedicata ai calciatori svincolati (/svincolati).
 * Riusa la stessa sezione incorporata nella dashboard: qui è mostrata a
 * schermo intero come destinazione del menù di navigazione mobile.
 */
@Component({
  selector: 'app-svincolati-page',
  imports: [MatButtonModule, MatIconModule, NavMenu, SvincolatiSection, HeaderAuthStatus],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <img src="icons/logo-emblema.png" class="header-logo" alt="" />
        <h1 class="app-title">Svincolati</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
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
  readonly leagueName = environment.leagueName;
}
