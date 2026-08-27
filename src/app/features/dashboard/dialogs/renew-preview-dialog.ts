import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Player } from '../../../core/models';
import { calcolaProssimaSpesaRinnovo } from '../../../core/finance-calculator';
import { roleColor, splitRoles } from '../../../core/roles';

export interface RenewPreviewDialogData {
  teamName: string;
  /** Solo i giocatori NON ancora rinnovati quest'anno (acquistoRinnovoSpesa === 0) */
  players: Player[];
}

/**
 * Anteprima AGGREGATA del costo di rinnovo per una selezione di giocatori
 * non ancora rinnovati — riservata alle squadre autenticate, sulla propria
 * rosa. Puramente informativa: non esegue nessun rinnovo (resta un'azione
 * solo admin, vedi TeamService.eseguiRinnovo), quindi non c'è nessun invio
 * dei dati, solo un calcolo client-side con le stesse funzioni pure usate
 * dall'admin per il rinnovo reale.
 */
@Component({
  selector: 'app-renew-preview-dialog',
  imports: [DecimalPipe, MatButtonModule, MatCheckboxModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Anteprima rinnovi — {{ data.teamName }}</h2>

    <mat-dialog-content>
      <p class="hint">
        Seleziona i giocatori non ancora rinnovati per vedere il totale che
        verrebbe speso rinnovandoli tutti alla loro prossima percentuale.
        È solo un'anteprima: il rinnovo vero resta un'operazione dell'admin.
      </p>

      @if (data.players.length === 0) {
        <p class="empty-state">Tutti i giocatori della rosa sono già stati rinnovati.</p>
      } @else {
        <ul class="player-list">
          @for (p of data.players; track p.id) {
            <li>
              <label class="player-row" [class.selected]="selezionati().has(p.id)">
                <mat-checkbox
                  [checked]="selezionati().has(p.id)"
                  (change)="toggle(p.id)"
                />
                <span class="chips">
                  @for (r of rolesOf(p); track r) {
                    <span
                      class="chip"
                      [style.border-color]="colorFor(r)"
                      [style.color]="colorFor(r)"
                    >{{ r }}</span>
                  }
                </span>
                <span class="nome">{{ p.name }}</span>
                <span class="perc">{{ perc(p.prossimaPercRinnovo) }}</span>
                <span class="costo">{{ costoRinnovo(p) | number: '1.2-2' }} €</span>
              </label>
            </li>
          }
        </ul>

        <div class="totale">
          <span>{{ selezionati().size }} giocatori selezionati</span>
          <strong>{{ totale() | number: '1.2-2' }} €</strong>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" type="button" [mat-dialog-close]="null">Chiudi</button>
    </mat-dialog-actions>
  `,
  styles: `
    .hint {
      margin: 0 0 12px;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }

    .player-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 50vh;
      overflow-y: auto;
    }

    .player-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 10px;
      cursor: pointer;
    }

    .player-row.selected {
      background: var(--mat-sys-secondary-container);
    }

    .chips {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .chip {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1.5px solid currentColor;
      font-size: 0.68rem;
      font-weight: 700;
      line-height: 1.4;
      white-space: nowrap;
    }

    .nome {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }

    .perc {
      flex-shrink: 0;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .costo {
      flex-shrink: 0;
      font-weight: 600;
      min-width: 5.5em;
      text-align: right;
    }

    .totale {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
      font-size: 0.95rem;
    }

    .totale strong {
      font-size: 1.15rem;
      color: var(--mat-sys-primary);
    }
  `,
})
export class RenewPreviewDialog {
  readonly data = inject<RenewPreviewDialogData>(MAT_DIALOG_DATA);

  readonly selezionati = signal<Set<string>>(new Set());

  readonly totale = computed(() => {
    const set = this.selezionati();
    return this.data.players
      .filter((p) => set.has(p.id))
      .reduce((sum, p) => sum + this.costoRinnovo(p), 0);
  });

  toggle(playerId: string): void {
    const next = new Set(this.selezionati());
    if (next.has(playerId)) {
      next.delete(playerId);
    } else {
      next.add(playerId);
    }
    this.selezionati.set(next);
  }

  costoRinnovo(player: Player): number {
    return calcolaProssimaSpesaRinnovo(player.valoreAttuale, player.prossimaPercRinnovo);
  }

  rolesOf(player: Player): string[] {
    return splitRoles(player.ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }

  perc(value: number): string {
    return `${Math.round((value || 0) * 100)}%`;
  }
}
