import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AuditLogEntry, UndoLogEntry } from '../../../core/models';
import { AuditService } from '../../../core/services/audit.service';
import { AuthService } from '../../../core/services/auth.service';
import { UndoService } from '../../../core/services/undo.service';
import { ConfirmDialog } from '../dialogs/confirm-dialog';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-history-section',
  imports: [DatePipe, MatButtonModule, MatIconModule, MatTableModule],
  template: `
    <h2>Operazioni annullabili</h2>

    @if (undoEntries().length === 0) {
      <p class="empty-state">Nessuna operazione annullabile registrata finora.</p>
    } @else {
      <ul class="undo-list">
        @for (entry of undoEntries(); track entry.id) {
          <li class="undo-row" [class.undone]="entry.undone">
            <div class="undo-testo">
              <span class="undo-descrizione">{{ entry.descrizione }}</span>
              <span class="undo-data">{{ entry.timestamp?.toDate() | date: 'dd/MM HH:mm' }}</span>
            </div>
            @if (entry.undone) {
              <span class="undo-badge">Annullata</span>
            } @else if (isAdmin()) {
              <button matButton type="button" (click)="annulla(entry)">
                <mat-icon>undo</mat-icon>
                Annulla
              </button>
            }
          </li>
        }
      </ul>
    }

    <h2>Storico operazioni</h2>

    @if (entries().length === 0) {
      <p class="empty-state">
        Nessuna operazione registrata. Lo storico viene popolato automaticamente
        ad ogni modifica di giocatori o spese.
      </p>
    } @else {
      <div class="table-scroll">
        <table mat-table [dataSource]="entries()">
          <ng-container matColumnDef="timestamp">
            <th mat-header-cell *matHeaderCellDef>Data</th>
            <td mat-cell *matCellDef="let entry" class="nowrap">
              {{ entry.timestamp?.toDate() | date: 'dd/MM HH:mm' }}
            </td>
          </ng-container>

          <ng-container matColumnDef="entityType">
            <th mat-header-cell *matHeaderCellDef>Entità</th>
            <td mat-cell *matCellDef="let entry">
              <span class="entity-chip" [class]="'entity-' + entry.entityType">
                {{ entityLabel(entry.entityType) }}
              </span>
            </td>
          </ng-container>

          <ng-container matColumnDef="operation">
            <th mat-header-cell *matHeaderCellDef>Op.</th>
            <td mat-cell *matCellDef="let entry">{{ entry.operation }}</td>
          </ng-container>

          <ng-container matColumnDef="fieldModified">
            <th mat-header-cell *matHeaderCellDef>Campo</th>
            <td mat-cell *matCellDef="let entry" class="mono">{{ entry.fieldModified }}</td>
          </ng-container>

          <ng-container matColumnDef="change">
            <th mat-header-cell *matHeaderCellDef>Prima → Dopo</th>
            <td mat-cell *matCellDef="let entry" class="mono change">
              {{ fmt(entry.valueBefore) }} → {{ fmt(entry.valueAfter) }}
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
        </table>
      </div>
    }
  `,
  styles: `
    h2 {
      margin: 0 0 12px;
      font-size: 1.1rem;
    }

    .table-scroll {
      overflow-x: auto;
    }

    table {
      width: 100%;
      min-width: 520px;
    }

    th {
      font-size: 0.75rem;
      white-space: nowrap;
    }

    td {
      font-size: 0.8rem;
      vertical-align: top;
    }

    .nowrap {
      white-space: nowrap;
    }

    .mono {
      font-family: 'Roboto Mono', ui-monospace, monospace;
      font-size: 0.75rem;
    }

    .change {
      max-width: 220px;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .entity-chip {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 0.7rem;
      background: var(--mat-sys-surface-container-high);
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }

    .undo-list {
      list-style: none;
      margin: 0 0 24px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .undo-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
    }

    .undo-row.undone {
      opacity: 0.6;
    }

    .undo-testo {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .undo-descrizione {
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .undo-data {
      font-size: 0.7rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .undo-badge {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `,
})
export class HistorySection {
  private readonly auditService = inject(AuditService);
  private readonly authService = inject(AuthService);
  private readonly undoService = inject(UndoService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly displayedColumns = ['timestamp', 'entityType', 'operation', 'fieldModified', 'change'] as const;

  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  readonly entries = toSignal(this.auditService.recent$(50), {
    initialValue: [] as AuditLogEntry[],
  });

  readonly undoEntries = toSignal(this.undoService.recenti$, {
    initialValue: [] as UndoLogEntry[],
  });

  async annulla(entry: UndoLogEntry): Promise<void> {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Annulla operazione',
        message: `Annullare "${entry.descrizione}"? Ripristina lo stato precedente di tutti i dati coinvolti.`,
        confirmLabel: 'Annulla operazione',
      },
      autoFocus: false,
    });
    const confirmed = await new Promise<boolean>((resolve) => {
      ref.afterClosed().subscribe((result) => resolve(!!result));
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.undoService.annulla(entry);
      this.snackBar.open('Operazione annullata', undefined, { duration: 3000 });
    } catch (err) {
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore durante l’annullamento.',
        'Chiudi',
        { duration: 4000 },
      );
    }
  }

  entityLabel(type: AuditLogEntry['entityType']): string {
    switch (type) {
      case 'player':
        return 'Giocatore';
      case 'playerLoaned':
        return 'Prestito';
      case 'seasonFinance':
        return 'Spese';
      case 'initial_import':
        return 'Import';
      default:
        return type;
    }
  }

  /** Formatta un valore per la colonna "Prima → Dopo" */
  fmt(value: unknown): string {
    if (value === undefined || value === null || value === '') {
      return '—';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    if (typeof value === 'object') {
      // Oggetti (es. {rinnovi: 100, perc: 0.85}): JSON compatto leggibile
      const text = JSON.stringify(value);
      return text.length > 60 ? text.slice(0, 57) + '…' : text;
    }
    const text = String(value);
    return text.length > 40 ? text.slice(0, 37) + '…' : text;
  }
}