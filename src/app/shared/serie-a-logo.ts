import { Component, computed, input } from '@angular/core';
import { logoUrlPerSquadra } from '../core/serie-a-logos';

/**
 * Logo di un club reale di Serie A (per sigla, es. "UDI"), o la sigla stessa
 * come testo di scorta se non ha un logo mappato (vedi core/serie-a-logos.ts)
 * — a differenza di TeamLogo (icona generica di scorta), qui la sigla resta
 * comunque leggibile/identificabile finché non si aggiunge il logo mancante.
 */
@Component({
  selector: 'app-serie-a-logo',
  template: `
    @if (url(); as src) {
      <img [src]="src" [class.invertito-su-scuro]="sigla() === 'JUV'" [alt]="sigla() ? sigla() + ' logo' : 'Logo squadra'" />
    } @else {
      <span class="fallback">{{ sigla() }}</span>
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

    /* Lo stemma Juventus attuale è solo nero su sfondo trasparente:
       invisibile sul tema scuro (default dell'app, vedi ThemeService). Un
       semplice invert lo rende bianco, senza dover generare/gestire un
       secondo file immagine per il tema chiaro. */
    :host-context(:not(.light-theme)) img.invertito-su-scuro {
      filter: invert(1);
    }

    .fallback {
      font-size: 0.7em;
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SerieALogo {
  readonly sigla = input<string | null | undefined>(null);
  readonly url = computed(() => logoUrlPerSquadra(this.sigla()));
}
