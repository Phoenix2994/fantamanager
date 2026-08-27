import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { switchMap, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { ScambiService } from '../../core/services/scambi.service';
import { TeamService } from '../../core/services/team.service';
import { Player, Scambio, Team } from '../../core/models';
import { roleColor, splitRoles } from '../../core/roles';
import {
  LatoScambio,
  PERC_RINNOVO_SCAMBIO,
  ScambioAnteprima,
  calcolaAnteprima,
} from '../../core/scambi-calculator';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { ConfirmDialog } from '../dashboard/dialogs/confirm-dialog';

/** Giocatore mostrato nel selettore di una trattativa */
interface PlayerOption {
  id: string;
  name: string;
  ruolo: string;
  valoreAttuale: number;
}

/** Riga del riepilogo giocatori coinvolti, mostrata già nell'anteprima */
interface RiepilogoGiocatore {
  id: string;
  name: string;
  ruolo: string;
  squadra: string;
  valoreAttuale: number;
  valoreFinale: number;
  rivalutato: boolean;
}

/**
 * Pagina degli scambi (/scambi): preparazione delle trattative tra squadre.
 *
 * - L'admin seleziona le due squadre, i giocatori ceduti da ciascuna e un
 *   eventuale conguaglio; un'anteprima live mostra la rivalutazione della
 *   parte più "povera" (proporzionale alle quotazioni attuali).
 * - Le trattative sono salvate come BOZZE su Firestore (scambi/{id}) e
 *   possono essere confermate dall'admin in un secondo momento.
 * - I visitatori vedono l'elenco delle trattative in sola lettura.
 */
@Component({
  selector: 'app-scambi-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
    NavMenu,
    HeaderAuthStatus,
  ],
  templateUrl: './scambi-page.html',
  styleUrls: ['../../core/nav/page-shell.scss', './scambi-page.scss'],
})
export class ScambiPage {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly scambiService = inject(ScambiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly leagueName = environment.leagueName;
  /** Percentuale di prossimo rinnovo applicata ai giocatori coinvolti */
  readonly percRinnovoScambio = PERC_RINNOVO_SCAMBIO;
  /** Lati della trattativa, per i cicli del template */
  readonly LATI: readonly LatoScambio[] = ['A', 'B'];

  readonly isAdmin = toSignal(this.authService.isAdmin$, {
    initialValue: false,
  });
  /** Squadra di cui l'utente corrente è proprietario, se ha fatto login come squadra */
  readonly myTeam = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });
  readonly teams = toSignal(this.teamService.teams$, { initialValue: [] as Team[] });
  readonly trattative = toSignal(this.scambiService.scambi$, { initialValue: [] as Scambio[] });

  // ---------- Stato del form "nuova trattativa" ----------
  // Chi ha fatto login come squadra propone SEMPRE per la propria: Squadra A
  // è bloccata sulla propria squadra (vedi effect nel costruttore).
  readonly squadraAId = signal<string | null>(null);
  readonly squadraBId = signal<string | null>(null);
  readonly selezioneA = signal<string[]>([]);
  readonly selezioneB = signal<string[]>([]);
  readonly conguaglio = signal<number | null>(0);
  readonly pagatore = signal<LatoScambio | null>(null);

  constructor() {
    // Blocca Squadra A sulla propria squadra appena si è loggati: una
    // trattativa proposta è sempre "la mia squadra contro un'altra".
    effect(() => {
      const mia = this.myTeam();
      if (mia && this.squadraAId() !== mia.id) {
        this.squadraChange('A', mia.id);
      }
    });
  }

  /** Rose realtime delle squadre selezionate */
  readonly rosterA = toSignal(
    toObservable(this.squadraAId).pipe(
      switchMap((id) => (id ? this.teamService.players$(id) : of([] as Player[]))),
    ),
    { initialValue: [] as Player[] },
  );
  readonly rosterB = toSignal(
    toObservable(this.squadraBId).pipe(
      switchMap((id) => (id ? this.teamService.players$(id) : of([] as Player[]))),
    ),
    { initialValue: [] as Player[] },
  );

  /** Opzioni selezionabili: solo giocatori in Serie A, ordinati per V.A. */
  readonly opzioniA = computed(() => this.toOptions(this.rosterA()));
  readonly opzioniB = computed(() => this.toOptions(this.rosterB()));

  readonly nomeSquadraA = computed(
    () => this.teams().find((t) => t.id === this.squadraAId())?.name ?? '',
  );
  readonly nomeSquadraB = computed(
    () => this.teams().find((t) => t.id === this.squadraBId())?.name ?? '',
  );

  /** Errori di configurazione non coperti dall'anteprima */
  readonly erroreSquadre = computed(() => {
    if (!this.squadraAId() || !this.squadraBId()) {
      return null;
    }
    return this.squadraAId() === this.squadraBId()
      ? 'Le due squadre devono essere diverse.'
      : null;
  });

  /** Anteprima live della trattativa corrente */
  readonly anteprima = computed<ScambioAnteprima>(() =>
    calcolaAnteprima(
      this.giocatoriSelezionati(this.rosterA(), this.selezioneA()),
      this.giocatoriSelezionati(this.rosterB(), this.selezioneB()),
      this.conguaglio() ?? 0,
      (this.conguaglio() ?? 0) > 0 ? this.pagatore() : null,
    ),
  );

  /**
   * Riepilogo di TUTTI i giocatori coinvolti (entrambe le squadre) col loro
   * valore finale — anche quelli che non cambiano valore, non solo i
   * rivalutati.
   */
  readonly riepilogoGiocatori = computed<RiepilogoGiocatore[]>(() => {
    const a = this.anteprima();
    const valoreFinalePerId = new Map(a.rivalutazioni.map((r) => [r.player.id, r.valoreDopo]));
    const riga = (p: Player, squadra: string): RiepilogoGiocatore => ({
      id: p.id,
      name: p.name,
      ruolo: p.ruolo,
      squadra,
      valoreAttuale: p.valoreAttuale,
      valoreFinale: valoreFinalePerId.get(p.id) ?? p.valoreAttuale,
      rivalutato: valoreFinalePerId.has(p.id),
    });
    return [
      ...this.giocatoriSelezionati(this.rosterA(), this.selezioneA()).map((p) =>
        riga(p, this.nomeSquadraA()),
      ),
      ...this.giocatoriSelezionati(this.rosterB(), this.selezioneB()).map((p) =>
        riga(p, this.nomeSquadraB()),
      ),
    ];
  });


  /** Lato opposto a quello passato */
  altroLato(lato: LatoScambio): LatoScambio {
    return lato === 'A' ? 'B' : 'A';
  }

  /** Cambio squadra di un lato: resetta la selezione giocatori di quel lato */
  squadraChange(lato: LatoScambio, teamId: string): void {
    const idOrNull = teamId || null;
    if (lato === 'A') {
      this.squadraAId.set(idOrNull);
      this.selezioneA.set([]);
    } else {
      this.squadraBId.set(idOrNull);
      this.selezioneB.set([]);
    }
    // Se l'altro lato era la stessa squadra, va svuotato
    const altroId = lato === 'A' ? this.squadraBId() : this.squadraAId();
    if (idOrNull && altroId === idOrNull) {
      if (lato === 'A') {
        this.squadraBId.set(null);
        this.selezioneB.set([]);
      } else {
        this.squadraAId.set(null);
        this.selezioneA.set([]);
      }
    }
  }

  toggleGiocatore(lato: LatoScambio, playerId: string): void {
    const sig = lato === 'A' ? this.selezioneA : this.selezioneB;
    const current = sig();
    sig.set(
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId],
    );
  }

  conguaglioChange(value: number | null): void {
    const safe = value && value > 0 ? value : 0;
    this.conguaglio.set(safe);
    if (!safe) {
      this.pagatore.set(null);
      return;
    }
    if (!this.pagatore()) {
      // Default: paga la parte di minor valore
      this.pagatore.set(
        this.anteprima().valoreTotaleA <= this.anteprima().valoreTotaleB ? 'A' : 'B',
      );
    }
  }

  /** Salva la bozza su Firestore con lo snapshot dei dati correnti */
  async salvaBozza(): Promise<void> {
    if (!this.squadraAId() || !this.squadraBId() || this.anteprima().errore) {
      return;
    }
    if (!this.myTeam()) {
      this.snackBar.open('Accedi come la tua squadra per proporre uno scambio.', 'Chiudi', {
        duration: 4000,
      });
      return;
    }
    try {
      await this.scambiService.saveBozza({
        squadraA: {
          teamId: this.squadraAId()!,
          playerIds: [...this.selezioneA()],
          ownerUid: this.ownerUidOf(this.squadraAId()!),
        },
        squadraB: {
          teamId: this.squadraBId()!,
          playerIds: [...this.selezioneB()],
          ownerUid: this.ownerUidOf(this.squadraBId()!),
        },
        conguaglio: this.conguaglio() ?? 0,
        conguaglioPagante: (this.conguaglio() ?? 0) > 0 ? this.pagatore() : null,
        snapshot: this.costruisciSnapshot(),
      });
      this.snackBar.open('Bozza salvata — visibile solo a te e alla controparte.', 'OK', {
        duration: 3500,
      });
      this.resetForm();
    } catch (err) {
      console.error(err);
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore salvando la trattativa.',
        'Chiudi',
        { duration: 4000 },
      );
    }
  }

  private ownerUidOf(teamId: string): string | null {
    return this.teams().find((t) => t.id === teamId)?.ownerUid ?? null;
  }

  private resetForm(): void {
    // Squadra A resta sulla propria squadra se si è loggati (l'effect nel
    // costruttore la rimetterebbe comunque, ma evita un flash a null).
    this.squadraAId.set(this.myTeam()?.id ?? null);
    this.squadraBId.set(null);
    this.selezioneA.set([]);
    this.selezioneB.set([]);
    this.conguaglio.set(0);
    this.pagatore.set(null);
  }

  /** Conferma definitiva della trattativa (solo admin) */
  conferma(scambio: Scambio): void {
    const riv = scambio.snapshot.rivalutazioni
      .map((r) => `${r.playerName}: ${r.valorePrima} → ${r.valoreDopo} €`)
      .join(', ');
    const message =
      `Confermare lo scambio ${scambio.snapshot.nomeSquadraA} ↔ ` +
      `${scambio.snapshot.nomeSquadraB}?` +
      `\n\nVerranno eseguiti:` +
      `\n• passaggio di ${
        scambio.snapshot.giocatoriA.length + scambio.snapshot.giocatoriB.length
      } giocatori;` +
      (riv ? `\n• rivalutazioni: ${riv};` : '') +
      `\n• prossima percentuale rinnovo al 60% per tutti i coinvolti` +
      (scambio.conguaglio > 0
        ? `;\n• conguaglio di ${scambio.conguaglio} € da ${
            scambio.conguaglioPagante === 'A'
              ? scambio.snapshot.nomeSquadraA
              : scambio.snapshot.nomeSquadraB
          }`
        : '') +
      '.';
    const ref = this.dialog.open(ConfirmDialog, {
      data: { title: 'Conferma scambio', message, confirmLabel: 'Conferma scambio' },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.conferma(scambio);
        this.snackBar.open('Scambio confermato e registrato.', 'OK', { duration: 3500 });
      } catch (err) {
        console.error(err);
        this.snackBar.open(
          err instanceof Error ? err.message : 'Errore durante la conferma.',
          'Chiudi',
          { duration: 5000 },
        );
      }
    });
  }

  /** Ruoli singoli di una stringa ruolo composta ("M;C"), per i chip */
  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  /** Colore associato al gruppo di ruolo */
  colorFor(role: string): string {
    return roleColor(role);
  }

  statoLabel(stato: Scambio['stato']): string {
    switch (stato) {
      case 'bozza':
        return 'Bozza';
      case 'ufficializzata':
        return 'Ufficializzata';
      case 'confermata':
        return 'Confermata';
      case 'annullata':
        return 'Annullata';
    }
  }

  /** Rende la bozza visibile agli admin per la conferma finale (basta una delle due squadre) */
  async ufficializza(scambio: Scambio): Promise<void> {
    try {
      await this.scambiService.ufficializza(scambio);
      this.snackBar.open('Trattativa ufficializzata: ora la vedono anche gli admin.', 'OK', {
        duration: 3500,
      });
    } catch (err) {
      console.error(err);
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore ufficializzando la trattativa.',
        'Chiudi',
        { duration: 4000 },
      );
    }
  }

  elimina(scambio: Scambio): void {
    const ref = this.dialog.open(ConfirmDialog, {
      data: {
        title: 'Elimina trattativa',
        message: `Eliminare la bozza ${scambio.snapshot.nomeSquadraA} ↔ ${scambio.snapshot.nomeSquadraB}?`,
        confirmLabel: 'Elimina',
      },
      autoFocus: false,
    });
    ref.afterClosed().subscribe(async (confirmed) => {
      if (!confirmed) {
        return;
      }
      try {
        await this.scambiService.elimina(scambio);
      } catch (err) {
        console.error(err);
        this.snackBar.open('Errore eliminando la trattativa.', 'Chiudi', { duration: 4000 });
      }
    });
  }

  // ---------- Helper ----------

  private toOptions(roster: Player[]): PlayerOption[] {
    return roster
      .filter((p) => !p.fuoriSerieA)
      .slice()
      .sort((a, b) => b.valoreAttuale - a.valoreAttuale)
      .map((p) => ({
        id: p.id,
        name: p.name,
        ruolo: p.ruolo,
        valoreAttuale: p.valoreAttuale,
      }));
  }

  private giocatoriSelezionati(roster: Player[], ids: string[]): Player[] {
    const byId = new Map(roster.map((p) => [p.id, p] as const));
    return ids.flatMap((id) => {
      const p = byId.get(id);
      return p ? [p] : [];
    });
  }

  private costruisciSnapshot() {
    const a = this.anteprima();
    return {
      nomeSquadraA: this.nomeSquadraA(),
      nomeSquadraB: this.nomeSquadraB(),
      giocatoriA: this.opzioniA()
        .filter((p) => this.selezioneA().includes(p.id))
        .map((p) => ({ name: p.name, ruolo: p.ruolo, valoreAttuale: p.valoreAttuale })),
      giocatoriB: this.opzioniB()
        .filter((p) => this.selezioneB().includes(p.id))
        .map((p) => ({ name: p.name, ruolo: p.ruolo, valoreAttuale: p.valoreAttuale })),
      valoreTotaleA: a.valoreTotaleA,
      valoreTotaleB: a.valoreTotaleB,
      rivalutazioni: a.rivalutazioni.map((r) => ({
        playerId: r.player.id,
        playerName: r.player.name,
        valorePrima: r.valorePrima,
        valoreDopo: r.valoreDopo,
      })),
    };
  }
}
