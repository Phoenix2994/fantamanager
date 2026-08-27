import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Player } from '../../../core/models';
import { calcolaProssimaSpesaRinnovo, round2 } from '../../../core/finance-calculator';
import { roleColor, splitRoles } from '../../../core/roles';
import { AuthService } from '../../../core/services/auth.service';
import { TeamService } from '../../../core/services/team.service';
import { ConfirmDialog } from './confirm-dialog';

export interface RenewPreviewDialogData {
  teamId: string;
  teamName: string;
  /** Solo i giocatori NON ancora rinnovati quest'anno (acquistoRinnovoSpesa === 0) */
  players: Player[];
  /** Bilancio societario stagionale ATTUALE della squadra, prima di questi rinnovi */
  bilancioAttuale: number;
  /** Valore rosa ATTUALE (tutti i giocatori, non solo quelli da rinnovare): serve alla tassa progressiva */
  valoreRosa: number;
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
        <label class="player-row select-all">
          <mat-checkbox [checked]="tuttiSelezionati()" (change)="toggleTutti()" />
          <span class="nome">Seleziona tutti</span>
        </label>

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

        <div class="bilancio">
          <div class="riga">
            <span>Bilancio stagionale attuale</span>
            <strong>{{ data.bilancioAttuale | number: '1.2-2' }} €</strong>
          </div>
          <div class="riga">
            <span>Bilancio dopo questi rinnovi</span>
            <strong [class.negativo]="bilancioDopo() < 0">{{ bilancioDopo() | number: '1.2-2' }} €</strong>
          </div>
        </div>

        @if (isAdmin()) {
          <p class="hint admin-hint">
            <mat-icon>admin_panel_settings</mat-icon>
            Solo per l'admin: esegue DAVVERO tutti i rinnovi selezionati,
            uno dopo l'altro (stesso effetto del rinnovo singolo, incluso
            l'aggiornamento delle finanze).
          </p>
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="null">Chiudi</button>
      @if (isAdmin() && selezionati().size > 0) {
        <button
          matButton="filled"
          type="button"
          [disabled]="rinnovoInCorso()"
          (click)="rinnovaSelezionati()"
        >
          <mat-icon>bolt</mat-icon>
          Rinnova selezionati ({{ selezionati().size }})
        </button>
      }
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

    .select-all {
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 0;
      margin-bottom: 4px;
      font-weight: 600;
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

    .bilancio {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px dashed var(--mat-sys-outline-variant);
      font-size: 0.85rem;
    }

    .bilancio .riga {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .bilancio span {
      color: var(--mat-sys-on-surface-variant);
    }

    .bilancio .negativo {
      color: var(--mat-sys-error);
    }

    .admin-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 10px 0 0;

      mat-icon {
        color: var(--mat-sys-primary);
      }
    }
  `,
})
export class RenewPreviewDialog {
  readonly data = inject<RenewPreviewDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RenewPreviewDialog>);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });
  readonly rinnovoInCorso = signal(false);

  readonly selezionati = signal<Set<string>>(new Set());

  readonly totale = computed(() => {
    const set = this.selezionati();
    return this.data.players
      .filter((p) => set.has(p.id))
      .reduce((sum, p) => sum + this.costoRinnovo(p), 0);
  });

  /** Bilancio stagionale se si eseguissero DAVVERO tutti i rinnovi selezionati: sono un costo, quindi lo riducono */
  readonly bilancioDopo = computed(() => round2(this.data.bilancioAttuale - this.totale()));

  /** true se OGNI giocatore della lista è selezionato (per lo stato della checkbox "tutti") */
  readonly tuttiSelezionati = computed(
    () => this.data.players.length > 0 && this.data.players.every((p) => this.selezionati().has(p.id)),
  );

  toggle(playerId: string): void {
    const next = new Set(this.selezionati());
    if (next.has(playerId)) {
      next.delete(playerId);
    } else {
      next.add(playerId);
    }
    this.selezionati.set(next);
  }

  /** Seleziona tutti se non lo erano già tutti, altrimenti deseleziona tutti */
  toggleTutti(): void {
    this.selezionati.set(
      this.tuttiSelezionati() ? new Set() : new Set(this.data.players.map((p) => p.id)),
    );
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

  /**
   * Esegue DAVVERO il rinnovo di tutti i giocatori selezionati (solo
   * admin): a differenza del resto del dialog, che è pura anteprima, qui
   * si scrive su Firestore — per questo passa da una conferma esplicita.
   */
  rinnovaSelezionati(): void {
    const selezionati = this.data.players.filter((p) => this.selezionati().has(p.id));
    if (selezionati.length === 0) {
      return;
    }
    const elenco = selezionati
      .map((p) => `${p.name} (${round2(this.costoRinnovo(p))} €)`)
      .join(', ');
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Rinnovo massivo',
        message:
          `Rinnovare DAVVERO ${selezionati.length} giocatori di ${this.data.teamName}?` +
          `\n\n${elenco}` +
          `\n\nTotale: ${round2(this.totale())} €. L'operazione è annullabile dallo storico.`,
        confirmLabel: 'Rinnova tutti',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confermato) => {
      if (!confermato) {
        return;
      }
      this.rinnovoInCorso.set(true);
      try {
        const { totale, count } = await this.teamService.eseguiRinnoviMassivi(
          this.data.teamId,
          selezionati.map((p) => p.id),
          this.data.valoreRosa,
        );
        this.snackBar.open(`${count} giocatori rinnovati: +${round2(totale)} € ai rinnovi`, 'OK', {
          duration: 4000,
        });
        this.dialogRef.close();
      } catch (err) {
        console.error(err);
        this.snackBar.open(
          err instanceof Error ? err.message : 'Errore durante il rinnovo massivo.',
          'Chiudi',
          { duration: 5000 },
        );
      } finally {
        this.rinnovoInCorso.set(false);
      }
    });
  }
}
