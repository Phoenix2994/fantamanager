import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Player } from '../core/models';

/**
 * Griglia dei dettagli contrattuali di un giocatore (Speso, Spesa rinnovo,
 * % Rinnovo, Q.I.→Q.A., V.I.→V.A., Contratto) — condivisa tra la card
 * espandibile della rosa e quella dei risultati "Nelle rose" su Svincolati,
 * così i due posti restano sempre identici senza doverli aggiornare a mano
 * in due punti.
 */
@Component({
  selector: 'app-player-detail-grid',
  imports: [DecimalPipe],
  template: `
    <div class="detail-grid">
      <div class="detail">
        <span>Speso</span>
        <strong>{{ player().acquistoRinnovoSpesa | number: '1.2-2' }} €</strong>
      </div>
      <!-- Se rinnovato, % e spesa rinnovo si riferiscono alla prossima
           stagione: mostrate in grigio -->
      <div class="detail" [class.muted]="player().acquistoRinnovoSpesa > 0">
        <span>Spesa rinnovo</span>
        <strong>{{ player().prossimaSpesaRinnovo | number: '1.2-2' }} €</strong>
      </div>
      <div class="detail" [class.muted]="player().acquistoRinnovoSpesa > 0">
        <span>% Rinnovo</span>
        <strong>{{ perc(player().prossimaPercRinnovo) }}</strong>
      </div>
      <div class="detail">
        <span>Q.I. → Q.A.</span>
        <strong>
          {{ player().quotazioneIniziale | number: '1.0-2' }} →
          {{ player().quotazioneAttuale | number: '1.0-2' }}
        </strong>
      </div>
      <div class="detail">
        <span>V.I. → V.A.</span>
        <strong>
          {{ player().valoreIniziale | number: '1.2-2' }} € →
          {{ player().valoreAttuale | number: '1.2-2' }} €
        </strong>
      </div>
      <div class="detail wide">
        <span>Contratto</span>
        <strong>{{ player().contractType }}</strong>
      </div>
    </div>
  `,
  styles: `
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .detail span {
      display: block;
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--mat-sys-on-surface-variant);
    }

    .detail strong {
      font-size: 0.85rem;
      font-weight: 600;
    }

    .detail.muted strong {
      color: var(--mat-sys-on-surface-variant);
    }

    .detail.wide {
      grid-column: 1 / -1;
    }
  `,
})
export class PlayerDetailGrid {
  readonly player = input.required<Player>();

  /** 1.45 → "145%" */
  perc(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }
}
