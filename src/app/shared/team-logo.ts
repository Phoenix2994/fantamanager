import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { logoUrlPerNome } from '../core/team-logos';

/**
 * Logo di una squadra, o un'icona generica di scorta se il nome non ha un
 * logo mappato (vedi core/team-logos.ts). Dimensione e forma (rotonda,
 * quadrata, ...) sono decise dal contesto che lo usa via CSS sull'host —
 * qui l'immagine riempie semplicemente lo spazio disponibile mantenendo
 * le proporzioni, senza ritagli forzati (i loghi hanno già forme diverse:
 * scudo, cerchio, quadrato).
 */
@Component({
  selector: 'app-team-logo',
  imports: [MatIconModule],
  template: `
    @if (url(); as src) {
      <img [src]="src" [alt]="name() ? name() + ' logo' : 'Logo squadra'" />
    } @else {
      <mat-icon aria-hidden="true">shield</mat-icon>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  `,
})
export class TeamLogo {
  readonly name = input<string | null | undefined>(null);
  readonly url = computed(() => logoUrlPerNome(this.name()));
}
