import { Component, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Player } from '../../core/models';

/** Acquisto effettuato durante l'asta */
export interface AcquistoAsta {
  nome: string;
  prezzo: number;
}

/** Statistica di una squadra per il pannello dell'asta */
export interface TeamStatAsta {
  id: string;
  name: string;
  giocatori: number;
  bilancio: number;
  /** prima soglia scaglioni − imponibile fairplay finanziario (spesaAnnuale) */
  residuoAlleMulte: number;
  /** giocatori acquistati durante l'asta con il costo di ciascuno */
  acquisti: AcquistoAsta[];
}

/**
 * Acquisti fatti durante l'asta: giocatori della rosa creati da ieri a
 * mezzanotte in poi (l'asta può superare la mezzanotte, quindi valgono
 * anche gli acquisti della giornata precedente; il campo createdAt è
 * valorizzato da teamService.addPlayer al momento dell'assegnazione).
 */
export function estraiAcquistiAsta(players: Player[]): AcquistoAsta[] {
  const inizio = new Date();
  inizio.setDate(inizio.getDate() - 1);
  inizio.setHours(0, 0, 0, 0);
  return players
    .filter((p) => {
      const created = p.createdAt?.toDate?.();
      return created instanceof Date && created >= inizio;
    })
    .map((p) => ({ nome: p.name, prezzo: p.acquistoRinnovoSpesa }));
}

/**
 * Pannello "Statistiche squadre" dell'asta, condiviso tra la pagina asta
 * (tab mobile + sezione desktop) e la vista TV.
 *
 * Per ogni squadra mostra giocatori su 28, bilancio e — espandendo la riga —
 * l'elenco degli acquisti fatti durante l'asta con il costo di ciascuno.
 * Con sempreAperto=true (vista TV) gli elenchi restano aperti.
 */
@Component({
  selector: 'app-asta-stats-panel',
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div
      class="stats-list"
      [class.colonne]="colonne()"
      [style.grid-template-columns]="colonne() ? colonneGriglia() : null"
    >
      @for (t of stats(); track t.id) {
        <div class="stat-block">
          @if (sempreAperto()) {
            <span class="stat-name">{{ t.name }}</span>
            <div class="stat-row static">
              <span class="stat-count" [class.full]="t.giocatori >= 28">
                {{ t.giocatori }}/28
              </span>
              <span class="stat-bilancio" [class.negative]="t.bilancio < 0">
                {{ t.bilancio | number: '1.2-2' }} €
              </span>
            </div>
          } @else {
            <button type="button" class="stat-row" (click)="toggle(t.id)">
              <mat-icon class="chevron" [class.open]="aperto(t.id)">expand_more</mat-icon>
              <span class="stat-name">{{ t.name }}</span>
              <span class="stat-count" [class.full]="t.giocatori >= 28">
                {{ t.giocatori }}/28
              </span>
              <span class="stat-bilancio" [class.negative]="t.bilancio < 0">
                {{ t.bilancio | number: '1.2-2' }} €
              </span>
            </button>
          }

          @if (sempreAperto() || aperto(t.id)) {
            <div class="acquisti">
              @if (t.acquisti.length === 0) {
                <p class="nessun-acquisto">Nessun acquisto all'asta</p>
              } @else {
                @for (a of t.acquisti; track $index) {
                  <div class="acquisto">
                    <span class="acquisto-nome">{{ a.nome }}</span>
                    <span class="acquisto-prezzo">{{ a.prezzo | number: '1.2-2' }} €</span>
                  </div>
                }
                <div class="acquisto totale">
                  <span>Totale acquisti</span>
                  <span>{{ totaleAcquisti(t) | number: '1.2-2' }} €</span>
                </div>
              }
              <div class="acquisto residuo" [class.negative]="t.residuoAlleMulte < 0">
                <span>Residuo alle multe</span>
                <span>{{ t.residuoAlleMulte | number: '1.2-2' }} €</span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .stats-list {
      display: flex;
      flex-direction: column;
    }

    .stat-block {
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
    }

    .stat-block:last-child {
      border-bottom: none;
    }

    .stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 0.875rem;
      width: 100%;
    }

    /* Riga cliccabile (espansione acquisti): reset dello stile bottone */
    button.stat-row {
      border: none;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: 8px;
    }

    .chevron {
      font-size: 20px;
      width: 20px;
      height: 20px;
      transition: transform 150ms ease;
      color: var(--mat-sys-on-surface-variant);
    }

    .chevron.open {
      transform: rotate(180deg);
    }

    .stat-name {
      flex: 1;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stat-count {
      font-weight: 700;
      white-space: nowrap;
    }

    .stat-count.full {
      color: var(--mat-sys-error);
    }

    .stat-bilancio {
      font-weight: 600;
      color: var(--mat-sys-primary);
      white-space: nowrap;
      min-width: 80px;
      text-align: right;
    }

    .stat-bilancio.negative {
      color: var(--mat-sys-error);
    }

    .acquisti {
      padding: 0 0 8px 28px;
    }

    .acquisto {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 3px 0;
      font-size: 0.8125rem;
    }

    .acquisto-nome {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--mat-sys-on-surface-variant);
    }

    .acquisto-prezzo {
      font-weight: 600;
      white-space: nowrap;
    }

    .acquisto.totale {
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-weight: 700;
    }

    .acquisto.residuo {
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px dashed var(--mat-sys-outline-variant);
      font-weight: 700;
      color: var(--mat-sys-primary);
    }

    .acquisto.residuo.negative {
      color: var(--mat-sys-error);
    }

    .nessun-acquisto {
      margin: 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Layout a colonne (vista TV): una colonna per squadra */
    .stats-list.colonne {
      display: grid;
      gap: 12px;
      align-items: start;
    }

    .stats-list.colonne .stat-block {
      border-bottom: none;
      padding: 12px 10px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
    }

    .stats-list.colonne .Svicol {
      /* Il nome occupa un'intera riga: nelle colonne strette lo spazio
         residuo accanto a conteggio e bilancio lo nasconderebbe */
      flex: 1 1 100%;
      white-space: normal;
      line-height: 1.2;
      font-weight: 700;
      font-size: 0.9375rem;
      margin-bottom: 4px;
    }

    .stats-list.colonne .acquisti {
      padding-left: 0;
      max-height: 40vh;
      overflow-y: auto;
    }
  `,
})
export class AstaStatsPanel {
  readonly stats = input.required<TeamStatAsta[]>();

  /** true nella vista TV: elenchi degli acquisti sempre aperti */
  readonly sempreAperto = input(false);

  /** Layout a griglia con una colonna per squadra (vista TV) */
  readonly colonne = input(false);

  private readonly espanse = signal<ReadonlySet<string>>(new Set<string>());

  /** Una colonna per squadra, con larghezza minima per la leggibilità */
  colonneGriglia(): string {
    return `repeat(${Math.max(this.stats().length, 1)}, minmax(150px, 1fr))`;
  }

  aperto(id: string): boolean {
    return this.espanse().has(id);
  }

  toggle(id: string): void {
    const prossimo = new Set(this.espanse());
    if (!prossimo.delete(id)) {
      prossimo.add(id);
    }
    this.espanse.set(prossimo);
  }

  totaleAcquisti(t: TeamStatAsta): number {
    return t.acquisti.reduce((somma, a) => somma + a.prezzo, 0);
  }
}
