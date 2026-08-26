import { Component, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Player } from '../core/models';
import { roleColor, splitRoles } from '../core/roles';
import { PlayerDetailGrid } from './player-detail-grid';

/**
 * Card espandibile di un giocatore: riga compatta (ruoli, nome, V.A.) che
 * apre i dettagli contrattuali al tocco — stesso aspetto ovunque compaia un
 * giocatore in forma di card (rosa mobile, risultati "Nelle rose" su
 * Svincolati).
 *
 * `compact` riduce l'altezza della riga chiusa (per allinearla alle righe
 * più sottili di una lista, es. lo svincolati): di default usa l'altezza
 * "touch-friendly" della rosa. `extraLabel` mostra un'etichetta aggiuntiva
 * sulla riga compatta (es. il nome della squadra proprietaria, quando la
 * card compare fuori dal contesto della propria rosa). Le azioni (bottoni
 * admin) sono proiettate: il chiamante decide se e quali mostrarne.
 */
@Component({
  selector: 'app-expandable-player-card',
  imports: [DecimalPipe, MatIconModule, PlayerDetailGrid],
  template: `
    <div class="player-card" [class.is-fuori-serie-a]="player().fuoriSerieA">
      <button
        type="button"
        class="card-head"
        [class.compact]="compact()"
        [class.is-renewed]="player().acquistoRinnovoSpesa > 0"
        (click)="expanded.set(!expanded())"
      >
        <span class="chips">
          @for (r of rolesOf(); track r) {
            <span class="chip" [style.border-color]="colorFor(r)" [style.color]="colorFor(r)">{{
              r
            }}</span>
          }
        </span>
        <span class="card-name">{{ player().name }}</span>
        @if (extraLabel()) {
          <span class="card-extra">{{ extraLabel() }}</span>
        }
        <span class="card-va">{{ player().valoreAttuale | number: '1.2-2' }} €</span>
        <mat-icon class="chevron">{{ expanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
      </button>

      @if (expanded()) {
        <div class="card-body">
          <app-player-detail-grid [player]="player()" />
          <ng-content select="[cardActions]" />
        </div>
      }
    </div>
  `,
  styles: `
    .player-card {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 14px;
      background: var(--mat-sys-surface-container-low);
      box-shadow: var(--mat-sys-level1, 0 1px 3px rgba(0, 0, 0, 0.3));
      overflow: hidden;
    }

    /* Giocatore fuori Serie A (non in alcun listone): evidenziazione rosa più scura */
    .player-card.is-fuori-serie-a {
      background: rgba(252, 185, 203, 0.4);
    }

    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 52px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
    }

    /* Variante compatta: stessa altezza di una riga di lista semplice */
    .card-head.compact {
      min-height: 0;
      padding: 6px 12px;
    }

    /* Riga evidenziata se il giocatore è rinnovato (soldi spesi > 0): il
       ruolo "secondary" di Material è la stessa tinta del primary ma
       desaturata apposta per gli accenti tenui — molto meno acceso del
       verde vivo usato per bottoni/valori. */
    .card-head.is-renewed {
      background: var(--mat-sys-secondary-container);
    }

    .chips {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1.5px solid currentColor;
      font-size: 0.72rem;
      font-weight: 700;
      line-height: 1.4;
      white-space: nowrap;
    }

    /* Se la riga è troppo stretta, deve accorciarsi per prima l'etichetta
       extra (nome squadra): flex-shrink molto più alto di .card-name, così
       il nome del giocatore resta leggibile finché possibile. */
    .card-name {
      flex: 1 1 auto;
      min-width: 3em;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-extra {
      flex: 0 1000 auto;
      min-width: 0;
      max-width: 45%;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-va {
      font-weight: 700;
      color: var(--mat-sys-primary);
      white-space: nowrap;
    }

    .chevron {
      color: var(--mat-sys-on-surface-variant);
    }

    .card-body {
      padding: 4px 12px 12px;
      border-top: 1px dashed var(--mat-sys-outline-variant);
    }

    ::ng-deep .card-body app-player-detail-grid {
      display: block;
      margin-top: 10px;
    }
  `,
})
export class ExpandablePlayerCard {
  readonly player = input.required<Player>();
  /** Etichetta aggiuntiva sulla riga compatta (es. nome squadra proprietaria) */
  readonly extraLabel = input<string | null>(null);
  /** true = riga chiusa alta come una lista semplice (es. svincolati) */
  readonly compact = input(false);

  readonly expanded = signal(false);

  rolesOf(): string[] {
    return splitRoles(this.player().ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }
}
