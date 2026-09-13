import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './services/auth.service';
import { EventoInApp, NotificheInAppService } from './services/notifiche-in-app.service';

/**
 * Banner globale (montato una volta in app.html, fuori dal router-outlet:
 * resta visibile a prescindere dalla pagina) per gli eventi dell'asta
 * infrasettimanale scritti dalle Cloud Functions in notifiche/{teamId}/eventi
 * — copre chi non ha attivato le notifiche push (o è su un browser che non
 * le supporta): appena la squadra reale è nota e ci sono eventi non letti,
 * li mostra uno alla volta, ESPLICITAMENTE da chiudere (non un semplice
 * snackbar che sparisce da solo) — l'obiettivo è che l'utente li veda
 * davvero, non solo che compaiano.
 */
@Component({
  selector: 'app-notifiche-in-app-banner',
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (corrente(); as evento) {
      <div class="notifica-overlay">
        <div
          class="notifica-card"
          role="button"
          tabindex="0"
          (click)="vai(evento)"
          (keydown.enter)="vai(evento)"
        >
          <mat-icon>notifications</mat-icon>
          <div class="notifica-testo">
            <strong>{{ evento.titolo }}</strong>
            <p>{{ evento.corpo }}</p>
          </div>
          <button matIconButton aria-label="Chiudi" (click)="chiudi(evento, $event)">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .notifica-overlay {
      position: fixed;
      top: 12px;
      left: 0;
      right: 0;
      z-index: 1000;
      display: flex;
      justify-content: center;
      padding: 0 12px;
      pointer-events: none;
    }

    .notifica-card {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      max-width: 480px;
      width: 100%;
      padding: 12px 10px 12px 14px;
      border-radius: 14px;
      background: var(--mat-sys-tertiary-container, #2d2a1f);
      color: var(--mat-sys-on-tertiary-container, #fff);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      cursor: pointer;
    }

    .notifica-card:focus-visible {
      outline: 2px solid var(--mat-sys-on-tertiary-container, #fff);
      outline-offset: 2px;
    }

    .notifica-card mat-icon:first-child {
      flex-shrink: 0;
      margin-top: 2px;
    }

    .notifica-testo {
      flex: 1;
      min-width: 0;
    }

    .notifica-testo strong {
      display: block;
      font-size: 0.9rem;
    }

    .notifica-testo p {
      margin: 2px 0 0;
      font-size: 0.85rem;
      line-height: 1.4;
    }

    .notifica-card button {
      flex-shrink: 0;
      margin: -8px -6px 0 0;
    }
  `,
})
export class NotificheInAppBanner {
  private readonly authService = inject(AuthService);
  private readonly notificheService = inject(NotificheInAppService);
  private readonly router = inject(Router);

  private readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null });

  private readonly eventi = toSignal(
    toObservable(this.myTeam).pipe(
      switchMap((team) => (team ? this.notificheService.nonLetti$(team.id) : of([] as EventoInApp[]))),
    ),
    { initialValue: [] as EventoInApp[] },
  );

  /** Un evento alla volta: la coda si smaltisce chiudendoli uno per uno */
  readonly corrente = computed(() => this.eventi()[0]);

  /** Tocco sulla card: apre l'asta infrasettimanale e segna l'evento come letto */
  async vai(evento: EventoInApp): Promise<void> {
    await this.segnaLetto(evento);
    await this.router.navigateByUrl('/asta-infrasettimanale');
  }

  /** Tocco sulla "x": chiude senza navigare (ferma la propagazione verso la card) */
  async chiudi(evento: EventoInApp, event: Event): Promise<void> {
    event.stopPropagation();
    await this.segnaLetto(evento);
  }

  private async segnaLetto(evento: EventoInApp): Promise<void> {
    const team = this.myTeam();
    if (!team) {
      return;
    }
    await this.notificheService.segnaLetto(team.id, evento.id);
  }
}
