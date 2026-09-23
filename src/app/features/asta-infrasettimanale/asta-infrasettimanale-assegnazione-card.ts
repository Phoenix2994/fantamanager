import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { calcolaPropostaAssegnazione } from '../../core/asta-infrasettimanale-assegnazione-calculator';
import { squadreEleggibili } from '../../core/asta-infrasettimanale-eleggibilita-busta';
import { AstaInfrasettimanale, BustaInfrasettimanale, Team } from '../../core/models';
import { roleColor, splitRoles } from '../../core/roles';
import {
  AstaInfrasettimanaleService,
  FaseInfrasettimanale,
} from '../../core/services/asta-infrasettimanale.service';
import { TeamService } from '../../core/services/team.service';
import { SerieALogo } from '../../shared/serie-a-logo';
import { TeamLogo } from '../../shared/team-logo';
import { ConfirmDialog } from '../dashboard/dialogs/confirm-dialog';

const MOTIVO_LABEL: Record<string, string> = {
  nessunaBusta: 'Nessuna busta: vince l’ultimo rilancio',
  bustaPiuAlta: 'Busta più alta',
  autobusta: 'Unica busta, già in testa: vale il prezzo di rilancio',
};

/**
 * Card di assegnazione per UNA asta infrasettimanale, mostrata solo
 * all'admin. In fase "assegnazione" mostra sempre buste, proposta e
 * controlli di assegnazione. In fase "buste" (fase.input === 'buste')
 * mostra solo l'elenco delle squadre eleggibili finché sono più di una —
 * appena resta un solo eleggibile (nessuna reale contesa possibile),
 * sblocca lo stesso pannello di assegnazione in anticipo, senza aspettare
 * la fine della fase: le regole Firestore lasciano comunque leggere le
 * buste all'admin in ogni momento (vedi asta-infrasettimanale-piano),
 * quindi qui è solo una scelta di UI. L'admin può sempre correggere
 * manualmente prima di confermare — mai un'assegnazione automatica
 * silenziosa.
 */
@Component({
  selector: 'app-asta-infrasettimanale-assegnazione-card',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    SerieALogo,
    TeamLogo,
  ],
  template: `
    <mat-card class="assegna-card">
      <div class="header">
        <span class="chips">
          @for (r of rolesOf(asta().ruolo); track r) {
            <span class="role-chip" [style.color]="colorFor(r)">{{ r }}</span>
          }
        </span>
        <app-serie-a-logo [sigla]="asta().squadra" class="club-logo" />
        <span class="name">{{ asta().giocatoreNome }}</span>
        <span class="rilancio">Ultimo rilancio: {{ asta().rilanciatoDaTeamName }} · {{ asta().prezzoAttuale | number: '1.2-2' }} €</span>
      </div>

      <p class="eleggibili">
        <mat-icon>how_to_vote</mat-icon>
        Eleggibili alle buste: <strong>{{ nomiEleggibili().join(', ') }}</strong>
      </p>

      @if (mostraDettaglioAssegnazione()) {
        @if (buste().length === 0) {
          <p class="hint">Nessuna busta presentata.</p>
        } @else {
          <ul class="buste-list">
            @for (b of busteOrdinate(); track b.teamId) {
              <li>
                <app-team-logo [name]="b.teamName" class="busta-logo" />
                {{ b.teamName }}
                <strong>{{ b.importo | number: '1.2-2' }} €</strong>
              </li>
            }
          </ul>
        }

        <p class="proposta">
          <mat-icon>lightbulb</mat-icon>
          Proposta: <strong>{{ proposta().teamName }}</strong> a
          <strong>{{ proposta().prezzo | number: '1.2-2' }} €</strong>
          <span class="motivo">({{ motivoLabel() }})</span>
        </p>

        <div class="override-row">
          <mat-form-field appearance="fill" subscriptSizing="dynamic">
            <mat-label>Squadra vincitrice</mat-label>
            <mat-select
              [value]="teamIdSelezionato()"
              (selectionChange)="overrideTeamId.set($event.value)"
            >
              @for (t of teams(); track t.id) {
                <mat-option [value]="t.id">{{ t.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="fill" subscriptSizing="dynamic">
            <mat-label>Prezzo (€)</mat-label>
            <input
              matInput
              type="number"
              step="0.1"
              [value]="prezzoSelezionato()"
              (input)="overridePrezzo.set($any($event.target).valueAsNumber)"
            />
          </mat-form-field>
        </div>

        @if (fase() === 'buste') {
          <p class="hint anticipo">
            Resta un solo eleggibile: puoi assegnare subito, senza aspettare la fine della fase
            buste.
          </p>
        }

        <div class="actions">
          <button matButton (click)="chiudiSenzaAssegnare()" [disabled]="salvataggioInCorso()">
            Chiudi senza assegnare
          </button>
          <button matButton="filled" (click)="conferma()" [disabled]="salvataggioInCorso()">
            <mat-icon>check</mat-icon>
            Assegna
          </button>
        </div>
      } @else {
        <p class="hint">
          Il pannello di assegnazione si sblocca a fine fase buste, o prima se resta un solo
          eleggibile.
        </p>
      }
    </mat-card>
  `,
  styles: `
    .assegna-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 16px;
      margin-bottom: 12px;
    }

    .header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chips {
      display: flex;
      gap: 4px;
    }

    .role-chip {
      display: inline-flex;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1.3px solid currentColor;
    }

    .club-logo {
      width: 18px;
      height: 18px;
    }

    .name {
      font-weight: 800;
      font-size: 1rem;
    }

    .rilancio {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .hint {
      margin: 0;
      font-size: 0.82rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .hint.anticipo {
      color: var(--mat-sys-primary);
    }

    .eleggibili {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-size: 0.82rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .eleggibili mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .buste-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .buste-list li {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
    }

    .busta-logo {
      width: 18px;
      height: 18px;
    }

    .buste-list strong {
      margin-left: auto;
      color: var(--mat-sys-primary);
    }

    .proposta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font-size: 0.85rem;
    }

    .motivo {
      font-size: 0.75rem;
      opacity: 0.8;
    }

    .override-row {
      display: flex;
      gap: 8px;
    }

    .override-row mat-form-field {
      flex: 1;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class AstaInfrasettimanaleAssegnazioneCard {
  private readonly astaInfraService = inject(AstaInfrasettimanaleService);
  private readonly teamService = inject(TeamService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly asta = input.required<AstaInfrasettimanale>();
  readonly fase = input.required<FaseInfrasettimanale>();

  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });

  readonly eleggibiliIds = computed(() => squadreEleggibili(this.asta()));

  readonly nomiEleggibili = computed(() =>
    this.eleggibiliIds().map((id) => this.teams().find((t) => t.id === id)?.name ?? id),
  );

  /** In fase "buste" l'assegnazione anticipata si sblocca solo con un solo eleggibile rimasto */
  readonly mostraDettaglioAssegnazione = computed(
    () => this.fase() === 'assegnazione' || this.eleggibiliIds().length <= 1,
  );

  readonly buste = toSignal(
    toObservable(this.asta).pipe(
      switchMap((a) => this.astaInfraService.tutteLeBuste$(a.id)),
    ),
    { initialValue: [] as BustaInfrasettimanale[] },
  );

  readonly busteOrdinate = computed(() =>
    [...this.buste()].sort((a, b) => b.importo - a.importo),
  );

  readonly proposta = computed(() => calcolaPropostaAssegnazione(this.asta(), this.buste()));

  readonly overrideTeamId = signal<string | null>(null);
  readonly overridePrezzo = signal<number | null>(null);
  readonly salvataggioInCorso = signal(false);

  readonly teamIdSelezionato = computed(() => this.overrideTeamId() ?? this.proposta().teamId);
  readonly prezzoSelezionato = computed(() => this.overridePrezzo() ?? this.proposta().prezzo);

  readonly motivoLabel = computed(() => MOTIVO_LABEL[this.proposta().motivo] ?? '');

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }

  async conferma(): Promise<void> {
    const teamId = this.teamIdSelezionato();
    const prezzo = this.prezzoSelezionato();
    const team = this.teams().find((t) => t.id === teamId);
    if (!team || prezzo == null || Number.isNaN(prezzo) || prezzo < 0) {
      this.snackBar.open('Squadra o prezzo non validi', undefined, { duration: 3000 });
      return;
    }
    const confermato = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Assegna giocatore',
            message: `Assegnare ${this.asta().giocatoreNome} a ${team.name} per ${prezzo.toFixed(2)} €? L'operazione è annullabile da Storico.`,
            confirmLabel: 'Assegna',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confermato) {
      return;
    }
    this.salvataggioInCorso.set(true);
    try {
      await this.astaInfraService.assegna(this.asta().id, team.id, team.name, prezzo);
      this.snackBar.open(`${this.asta().giocatoreNome} assegnato a ${team.name}`, undefined, {
        duration: 3000,
      });
    } catch (e) {
      this.snackBar.open(
        e instanceof Error ? e.message : 'Errore durante l’assegnazione',
        undefined,
        { duration: 3500 },
      );
    } finally {
      this.salvataggioInCorso.set(false);
    }
  }

  async chiudiSenzaAssegnare(): Promise<void> {
    const confermato = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Chiudi senza assegnare',
            message: `Chiudere l'asta su ${this.asta().giocatoreNome} senza assegnarlo a nessuno?`,
            confirmLabel: 'Chiudi',
          },
          width: '95vw',
          maxWidth: '400px',
        })
        .afterClosed(),
    );
    if (!confermato) {
      return;
    }
    this.salvataggioInCorso.set(true);
    try {
      await this.astaInfraService.chiudiSenzaAssegnare(this.asta().id);
      this.snackBar.open('Asta chiusa senza assegnazione', undefined, { duration: 3000 });
    } catch (e) {
      this.snackBar.open(e instanceof Error ? e.message : 'Errore durante la chiusura', undefined, {
        duration: 3500,
      });
    } finally {
      this.salvataggioInCorso.set(false);
    }
  }
}
