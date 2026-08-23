import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Svincolato } from '../../../core/models';
import { TeamService } from '../../../core/services/team.service';

/** Normalizza per la ricerca: minuscole e senza accenti */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Ordine canonico dei ruoli mantra */
const ROLE_ORDER = ['Por', 'B', 'Dd', 'Dc', 'Ds', 'M', 'C', 'E', 'W', 'T', 'A', 'Pc'];

/** Colore del bordo/chip per gruppo di ruolo */
const ROLE_COLORS: Record<string, string> = {
  Por: '#f9a825',
  B: '#2e7d32',
  Dd: '#2e7d32',
  Dc: '#2e7d32',
  Ds: '#2e7d32',
  M: '#508af4',
  C: '#508af4',
  E: '#508af4',
  W: '#6a1b9a',
  T: '#6a1b9a',
  A: '#c62828',
  Pc: '#c62828',
};

/** Divide la stringa ruolo composta ("M;C") nei ruoli singoli */
function splitRoles(ruolo: string): string[] {
  return ruolo
    .split(';')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Sezione "Svincolati": giocatori presenti nel listone fantacalcio.it
 * ma non in nessuna rosa. Filtri per nome e ruolo, ordinati per quotazione.
 * I giocatori possono avere fino a 3 ruoli (es. "M;C").
 */
@Component({
  selector: 'app-svincolati-section',
  imports: [DecimalPipe, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <div class="section-header">
      <h2>Svincolati</h2>
      <span class="count">{{ filtered().length }} giocatori</span>
    </div>

    <div class="filters">
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Cerca giocatore</mat-label>
        <input matInput [value]="search()" (input)="search.set($any($event.target).value)" />
        <mat-icon matPrefix>search</mat-icon>
      </mat-form-field>

      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Ruolo</mat-label>
        <mat-select [value]="filterRuolo()" (selectionChange)="filterRuolo.set($event.value)">
          <mat-option value="">Tutti</mat-option>
          @for (ruolo of ruoliDisponibili(); track ruolo) {
            <mat-option [value]="ruolo">{{ ruolo }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (filtered().length === 0) {
      <p class="empty-state">
        Nessun svincolato corrisponde ai filtri. La lista viene popolata
        automaticamente dallo script di aggiornamento quotazioni.
      </p>
    } @else {
      <ul class="list">
        @for (p of filtered(); track p.id) {
          <li>
            <span class="chips">
              @for (r of rolesOf(p); track r) {
                <span
                  class="chip"
                  [style.border-color]="colorFor(r)"
                  [style.color]="colorFor(r)"
                >{{ r }}</span>
              }
            </span>
            <span class="name">{{ p.name }}</span>
            <span class="team">{{ p.squadra }}</span>
            <span class="quota">{{ p.quotazioneAttuale | number: '1.0-0' }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    h2 {
      margin: 0;
      font-size: 1.1rem;
    }

    .count {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .filters mat-form-field {
      flex: 1;
      min-width: 140px;
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

    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .list li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      font-size: 0.875rem;
    }

    .chips {
      flex-shrink: 0;
      min-width: 36px;
    }

    .name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .team {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8rem;
      white-space: nowrap;
    }

    .quota {
      font-weight: 700;
      color: var(--mat-sys-primary);
      white-space: nowrap;
      min-width: 32px;
      text-align: right;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
  `,
})
export class SvincolatiSection {
  private readonly teamService = inject(TeamService);

  readonly svincolati = toSignal(this.teamService.svincolati$, {
    initialValue: [] as Svincolato[],
  });

  readonly filterRuolo = signal<string>('');
  readonly search = signal('');

  /** Ruoli distinti presenti nella lista, nell'ordine canonico */
  readonly ruoliDisponibili = computed(() => {
    const set = new Set<string>();
    for (const p of this.svincolati()) {
      for (const r of splitRoles(p.ruolo)) {
        set.add(r);
      }
    }
    return [...set].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  });

  /** Lista filtrata e ordinata per quotazione decrescente */
  readonly filtered = computed(() => {
    const ruolo = this.filterRuolo();
    const term = normalize(this.search());
    return this.svincolati()
      .filter(
        (p) =>
          // il filtro matcha se il giocatore ha quel ruolo tra i suoi
          (!ruolo || splitRoles(p.ruolo).includes(ruolo)) &&
          (!term || normalize(p.name).includes(term)),
      )
      .sort((a, b) => b.quotazioneAttuale - a.quotazioneAttuale);
  });

  colorFor(role: string): string {
    return ROLE_COLORS[role] ?? 'var(--mat-sys-on-surface-variant)';
  }

  /** Ruoli singoli di un giocatore, per i chip */
  rolesOf(player: Svincolato): string[] {
    return splitRoles(player.ruolo);
  }
}