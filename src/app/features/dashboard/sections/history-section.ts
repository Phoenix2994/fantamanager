import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { AuditLogEntry } from '../../../core/models';
import { AuditService } from '../../../core/services/audit.service';

@Component({
  selector: 'app-history-section',
  imports: [DatePipe, MatIconModule, MatTableModule],
  template: `
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
  `,
})
export class HistorySection {
  private readonly auditService = inject(AuditService);

  readonly displayedColumns = ['timestamp', 'entityType', 'operation', 'fieldModified', 'change'] as const;

  readonly entries = toSignal(this.auditService.recent$(50), {
    initialValue: [] as AuditLogEntry[],
  });

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
    const text = String(value);
    return text.length > 40 ? text.slice(0, 37) + '…' : text;
  }
}