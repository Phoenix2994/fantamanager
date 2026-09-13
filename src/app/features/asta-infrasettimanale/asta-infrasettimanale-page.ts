import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AstaInfrasettimanale, BustaInfrasettimanale, Player, Team } from '../../core/models';
import { roleColor, splitRoles } from '../../core/roles';
import { MAX_GIOCATORI, minIncremento } from '../../core/services/asta.service';
import {
  AstaInfrasettimanaleService,
  FaseInfrasettimanale,
} from '../../core/services/asta-infrasettimanale.service';
import { AuthService } from '../../core/services/auth.service';
import { PushNotificationService } from '../../core/services/push-notification.service';
import { TeamService } from '../../core/services/team.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';
import { TeamLogo } from '../../shared/team-logo';
import { SerieALogo } from '../../shared/serie-a-logo';
import { AstaInfrasettimanaleAssegnazioneCard } from './asta-infrasettimanale-assegnazione-card';

const INCREMENTI = [0.1, 0.2, 0.5, 1] as const;

const FASE_LABEL: Record<FaseInfrasettimanale, string> = {
  disabilitata: 'Nessun ciclo attivo',
  chiamata: 'Chiamata aperta — 0,10 € di partenza',
  soloRilanci: 'Solo rilanci — niente nuove chiamate',
  buste: 'Fase buste — i rilanci sono chiusi',
  assegnazione: 'In attesa che l’admin assegni i giocatori',
};

const FASE_ICONA: Record<FaseInfrasettimanale, string> = {
  disabilitata: 'event_busy',
  chiamata: 'campaign',
  soloRilanci: 'gavel',
  buste: 'mail_lock',
  assegnazione: 'hourglass_top',
};

/**
 * Vista "griglia + foglio" per l'asta infrasettimanale: tutte le aste aperte
 * a colpo d'occhio in una griglia compatta (bordo verde = sei in vantaggio),
 * toccando una card si apre un foglio con dettaglio e pulsanti di rilancio —
 * pattern scelto dopo aver confrontato 4 prototipi (vedi memoria di progetto
 * "asta-infrasettimanale-piano").
 *
 * "Chiamare" un nuovo svincolato si fa dalla sezione Svincolati, non qui:
 * questa pagina serve solo a vedere e agire sulle aste già aperte.
 *
 * A differenza dell'asta di settembre (dove la scelta squadra è solo un
 * picker client-side, vedi asta-page.ts), qui la squadra è SEMPRE quella
 * del login reale (AuthService.myTeam$, come già in svincolati-section.ts
 * per "Chiama"): solo chi ha fatto login con l'account della propria
 * squadra può rilanciare o presentare una busta — enforcement vero anche
 * lato Firestore rules (isTeamOwner), non solo un vincolo della UI.
 */
@Component({
  selector: 'app-asta-infrasettimanale-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    RouterLink,
    NavMenu,
    HeaderAuthStatus,
    TeamLogo,
    SerieALogo,
    AstaInfrasettimanaleAssegnazioneCard,
  ],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <img src="icons/logo-emblema.png" class="header-logo" alt="" />
        <h1 class="app-title">Asta infrasettimanale</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">
        <div class="fase-banner" [class.disabilitata]="fase() === 'disabilitata'">
          <mat-icon>{{ faseIcona() }}</mat-icon>
          <span>{{ faseLabel() }}</span>
        </div>

        @if (isAdmin() && fase() === 'assegnazione') {
          <section class="admin-assegnazione">
            <h2>Assegnazione admin</h2>
            @if (asteAperte().length === 0) {
              <p class="empty-state">Nessuna asta da assegnare al momento.</p>
            } @else {
              @for (a of asteAperte(); track a.id) {
                <app-asta-infrasettimanale-assegnazione-card [asta]="a" />
              }
            }
          </section>
        }

        @if (fase() === 'disabilitata') {
          <p class="empty-state">
            Nessun ciclo di asta infrasettimanale attivo al momento. Le chiamate si fanno dalla
            sezione Svincolati quando la fase è aperta.
          </p>
        } @else if (!miaSquadra()) {
          <mat-card class="panel">
            <h2>Accedi come la tua squadra</h2>
            <p class="intro">
              Per chiamare, rilanciare o presentare una busta devi aver effettuato il login con
              l'account della tua squadra (non basta la consultazione pubblica o il login admin).
            </p>
            <a matButton="filled" routerLink="/login">Accedi</a>
          </mat-card>
        } @else {
          <div class="squadra-bar">
            <app-team-logo [name]="miaSquadra()!.name" class="squadra-logo" />
            <span>Stai partecipando come:</span>
            <strong>{{ miaSquadra()!.name }}</strong>
          </div>

          @if (notificheDisponibili() && !notificheAttive()) {
            <button matButton="tonal" class="notifiche-btn" (click)="attivaNotifiche()">
              <mat-icon>notifications</mat-icon>
              Attiva notifiche
            </button>
          }

          @if (asteAperte().length === 0) {
            <p class="empty-state">Nessuna asta infrasettimanale aperta al momento.</p>
          } @else {
            <div class="card-grid">
              @for (a of asteAperte(); track a.id) {
                <button
                  type="button"
                  class="g-card"
                  [class.mine]="a.rilanciatoDaTeamId === miaSquadra()!.id"
                  (click)="apriFoglio(a)"
                >
                  <div class="chips">
                    @for (r of rolesOf(a.ruolo); track r) {
                      <span class="role-chip" [style.color]="colorFor(r)">{{ r }}</span>
                    }
                  </div>
                  <span class="g-name">{{ a.giocatoreNome }}</span>
                  <span class="g-price">{{ a.prezzoAttuale | number: '1.2-2' }} €</span>
                  <span class="leader-pill" [class.mine]="a.rilanciatoDaTeamId === miaSquadra()!.id">
                    {{
                      a.rilanciatoDaTeamId === miaSquadra()!.id
                        ? 'Sei in vantaggio'
                        : a.rilanciatoDaTeamName
                    }}
                  </span>
                </button>
              }
            </div>
          }

          @if (astaSelezionata(); as a) {
            <div class="sheet-backdrop" (click)="chiudiFoglio()"></div>
            <div class="sheet">
              <div class="grabber"></div>
              <div class="chips">
                @for (r of rolesOf(a.ruolo); track r) {
                  <span class="role-chip" [style.color]="colorFor(r)">{{ r }}</span>
                }
              </div>
              <div class="sh-name">{{ a.giocatoreNome }}</div>
              <div class="sh-club">
                <app-serie-a-logo [sigla]="a.squadra" class="sh-club-logo" />
                {{ a.squadra }} · Q. {{ a.quotazione }}
              </div>
              <div class="sh-price">{{ a.prezzoAttuale | number: '1.2-2' }} €</div>
              <span class="leader-pill" [class.mine]="a.rilanciatoDaTeamId === miaSquadra()!.id">
                {{
                  a.rilanciatoDaTeamId === miaSquadra()!.id
                    ? 'Sei in vantaggio'
                    : 'Rilancia ' + a.rilanciatoDaTeamName
                }}
              </span>

              @if (fase() === 'chiamata' || fase() === 'soloRilanci') {
                <div class="bid-row">
                  @for (inc of incrementi; track inc) {
                    <button
                      matButton="filled"
                      class="bid-btn"
                      [disabled]="
                        a.rilanciatoDaTeamId === miaSquadra()!.id ||
                        inCooldown() ||
                        squadraPiena(a.id) ||
                        inc < minIncremento(a.prezzoAttuale)
                      "
                      (click)="rilancia(a, inc)"
                    >
                      +{{ inc | number: '1.1-1' }} €
                    </button>
                  }
                </div>

                <mat-form-field appearance="fill" subscriptSizing="dynamic" class="full-width">
                  <mat-label>Rilancio custom (€)</mat-label>
                  <input
                    matInput
                    type="number"
                    step="0.1"
                    min="0.1"
                    [value]="customBid()"
                    (input)="customBid.set($any($event.target).valueAsNumber || 0)"
                  />
                </mat-form-field>
                <button
                  matButton="filled"
                  class="bid-btn custom-bid-btn"
                  [disabled]="
                    !customValida() ||
                    a.rilanciatoDaTeamId === miaSquadra()!.id ||
                    inCooldown() ||
                    squadraPiena(a.id)
                  "
                  (click)="rilanciaCustom(a)"
                >
                  Rilancia {{ customBid() | number: '1.2-2' }} €
                </button>

                @if (a.rilanciatoDaTeamId === miaSquadra()!.id) {
                  <p class="hint warn">
                    La tua squadra è già l'ultima rilanciante: attendi una controparte.
                  </p>
                } @else if (squadraPiena(a.id)) {
                  <p class="hint warn">
                    Hai raggiunto il limite di {{ maxGiocatori }} giocatori (contando anche le altre
                    aste in cui sei in testa): non puoi rilanciare.
                  </p>
                }
              } @else if (fase() === 'buste') {
                @if (eleggibileBusta(a)) {
                  <div class="busta-form">
                    <mat-form-field appearance="fill" subscriptSizing="dynamic">
                      <mat-label>La tua busta (€)</mat-label>
                      <input
                        matInput
                        type="number"
                        step="0.1"
                        [value]="importoBusta()"
                        (input)="importoBusta.set($any($event.target).valueAsNumber || 0)"
                      />
                    </mat-form-field>
                    <button
                      matButton="filled"
                      [disabled]="importoBusta() < a.prezzoAttuale"
                      (click)="inviaBusta(a)"
                    >
                      {{ mieBustaCorrente() ? 'Aggiorna busta' : 'Invia busta' }}
                    </button>
                    @if (mieBustaCorrente(); as busta) {
                      <p class="hint">
                        Busta attuale: {{ busta.importo | number: '1.2-2' }} €
                        <button matButton (click)="ritiraBusta(a)">Ritira</button>
                      </p>
                    }
                    <p class="hint">La busta deve essere almeno pari all'ultimo rilancio.</p>
                  </div>
                } @else {
                  <p class="hint warn">
                    Solo chi ha rilanciato in fase "solo rilanci" può presentare una busta per
                    questo giocatore.
                  </p>
                }
              } @else {
                <p class="hint">In attesa che l'admin assegni il giocatore.</p>
              }
            </div>
          }
        }
      </main>
    </div>
  `,
  styles: `
    .fase-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      font-weight: 600;
      margin-bottom: 16px;
    }

    .fase-banner.disabilitata {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
    }

    .panel {
      padding: 16px;
      border-radius: 16px;
    }

    .admin-assegnazione {
      margin-bottom: 20px;
    }

    .admin-assegnazione h2 {
      margin: 0 0 10px;
      font-size: 1rem;
    }

    .intro {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .squadra-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 0.9rem;
    }

    .squadra-logo {
      width: 28px;
      height: 28px;
    }

    .notifiche-btn {
      margin-bottom: 16px;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }

    .g-card {
      background: var(--mat-sys-surface-container-high);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 14px;
      padding: 10px 12px;
      cursor: pointer;
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font: inherit;
      color: inherit;
    }

    .g-card.mine {
      border-color: var(--mat-sys-primary);
      border-width: 2px;
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

    .g-name {
      font-weight: 700;
      font-size: 0.85rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .g-price {
      font-weight: 800;
      color: var(--mat-sys-primary);
    }

    .leader-pill {
      font-size: 0.72rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .leader-pill.mine {
      color: var(--mat-sys-primary);
      font-weight: 700;
    }

    .sheet-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 20;
    }

    .sheet {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 21;
      background: var(--mat-sys-surface-container-highest, #fff);
      border-radius: 20px 20px 0 0;
      padding: 16px 20px 24px;
      max-width: 480px;
      margin: 0 auto;
      box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.3);
    }

    .grabber {
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: var(--mat-sys-outline-variant);
      margin: 0 auto 14px;
    }

    .sh-name {
      font-size: 1.4rem;
      font-weight: 800;
      margin: 6px 0 2px;
    }

    .sh-club {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 10px;
    }

    .sh-club-logo {
      width: 18px;
      height: 18px;
    }

    .sh-price {
      font-size: 2.2rem;
      font-weight: 800;
      color: var(--mat-sys-primary);
      margin-bottom: 6px;
    }

    .bid-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-top: 14px;
    }

    .full-width {
      width: 100%;
      margin-top: 10px;
    }

    .custom-bid-btn {
      width: 100%;
    }

    .busta-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 14px;
    }

    .hint {
      font-size: 0.78rem;
      color: var(--mat-sys-on-surface-variant);
      margin: 8px 0 0;
    }

    .hint.warn {
      color: var(--mat-sys-error);
    }
  `,
})
export class AstaInfrasettimanalePage {
  private readonly astaInfraService = inject(AstaInfrasettimanaleService);
  private readonly authService = inject(AuthService);
  private readonly pushService = inject(PushNotificationService);
  private readonly teamService = inject(TeamService);
  private readonly snackBar = inject(MatSnackBar);

  readonly incrementi = INCREMENTI;
  readonly minIncremento = minIncremento;
  readonly maxGiocatori = MAX_GIOCATORI;

  readonly fase = toSignal(this.astaInfraService.fase$, {
    initialValue: 'disabilitata' as FaseInfrasettimanale,
  });
  readonly faseLabel = computed(() => FASE_LABEL[this.fase()]);
  readonly faseIcona = computed(() => FASE_ICONA[this.fase()]);

  readonly asteAperte = toSignal(this.astaInfraService.aperte$, {
    initialValue: [] as AstaInfrasettimanale[],
  });

  /** true se l'utente ha effettuato il login come admin — mostra il pannello di assegnazione */
  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  /** La squadra del login REALE (AuthService.myTeam$), null se non loggati come una squadra */
  readonly miaSquadra = toSignal(this.authService.myTeam$, { initialValue: null as Team | null });

  /** Giocatori in rosa della propria squadra — serve al tetto dei 28 per il rilancio (vedi AstaInfrasettimanaleService.rilancia) */
  readonly mieiGiocatori = toSignal(
    toObservable(this.miaSquadra).pipe(
      switchMap((team) => (team ? this.teamService.players$(team.id) : of([] as Player[]))),
      map((players) => players.length),
    ),
    { initialValue: 0 },
  );

  readonly astaSelezionataId = signal<string | null>(null);
  readonly astaSelezionata = computed(() =>
    this.asteAperte().find((a) => a.id === this.astaSelezionataId()),
  );

  /** true se la squadra ha già raggiunto il tetto contando anche le altre aste in cui è in testa (esclusa questa) */
  squadraPiena(astaId: string): boolean {
    const squadra = this.miaSquadra();
    if (!squadra) {
      return true;
    }
    const inTestaAltrove = this.asteAperte().filter(
      (a) => a.id !== astaId && a.rilanciatoDaTeamId === squadra.id,
    ).length;
    return this.mieiGiocatori() + inTestaAltrove >= MAX_GIOCATORI;
  }

  readonly inCooldown = signal(false);
  readonly importoBusta = signal(0);
  /** Rilancio custom (importo libero) — stesso pattern di asta-page.ts */
  readonly customBid = signal(0);

  /** true se questo browser supporta le notifiche push E la chiave VAPID è configurata */
  readonly notificheDisponibili = signal(false);
  /** true se l'attivazione è già andata a buon fine su QUESTO dispositivo per questa squadra */
  readonly notificheAttive = signal(false);

  constructor() {
    void this.pushService.disponibile().then((v) => this.notificheDisponibili.set(v));
    effect(() => {
      const squadra = this.miaSquadra();
      this.notificheAttive.set(!!squadra && this.pushService.attivoSuQuestoDispositivo(squadra.id));
    });
  }

  /** La MIA busta per l'asta aperta nel foglio, undefined se non ne ho ancora inserita una */
  readonly mieBustaCorrente = toSignal(
    toObservable(computed(() => ({ astaId: this.astaSelezionataId(), teamId: this.miaSquadra()?.id }))).pipe(
      switchMap(({ astaId, teamId }) =>
        astaId && teamId ? this.astaInfraService.mieBusta$(astaId, teamId) : of(undefined),
      ),
    ),
    { initialValue: undefined as BustaInfrasettimanale | undefined },
  );

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }

  eleggibileBusta(a: AstaInfrasettimanale): boolean {
    const squadra = this.miaSquadra();
    return !!squadra && a.squadreEleggibiliBusta.includes(squadra.id);
  }

  apriFoglio(a: AstaInfrasettimanale): void {
    this.astaSelezionataId.set(a.id);
    this.importoBusta.set(0);
    this.customBid.set(0);
  }

  /** true se il rilancio custom è valido (> prezzo attuale + minimo) */
  readonly customValida = computed(() => {
    const a = this.astaSelezionata();
    if (!a) {
      return false;
    }
    return this.customBid() + 1e-9 >= a.prezzoAttuale + minIncremento(a.prezzoAttuale);
  });

  async rilanciaCustom(a: AstaInfrasettimanale): Promise<void> {
    if (!this.customValida()) {
      return;
    }
    await this.rilancia(a, this.customBid() - a.prezzoAttuale);
  }

  chiudiFoglio(): void {
    this.astaSelezionataId.set(null);
  }

  async attivaNotifiche(): Promise<void> {
    const squadra = this.miaSquadra();
    if (!squadra) {
      return;
    }
    const ok = await this.pushService.attiva(squadra.id);
    if (ok) {
      this.notificheAttive.set(true);
    }
  }

  async rilancia(a: AstaInfrasettimanale, incremento: number): Promise<void> {
    const squadra = this.miaSquadra();
    if (!squadra || this.inCooldown()) {
      return;
    }
    try {
      await this.astaInfraService.rilancia(
        a.id,
        squadra.id,
        squadra.name,
        incremento,
        a.prezzoAttuale,
        this.mieiGiocatori(),
      );
      this.inCooldown.set(true);
      setTimeout(() => this.inCooldown.set(false), 1000);
    } catch (e) {
      this.snackBar.open(
        e instanceof Error ? e.message : 'Errore durante il rilancio',
        undefined,
        { duration: 3000 },
      );
    }
  }

  async inviaBusta(a: AstaInfrasettimanale): Promise<void> {
    const squadra = this.miaSquadra();
    if (!squadra) {
      return;
    }
    try {
      await this.astaInfraService.inserisciBusta(a.id, squadra.id, squadra.name, this.importoBusta());
      this.snackBar.open('Busta inviata', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante l’invio della busta', undefined, { duration: 3000 });
    }
  }

  async ritiraBusta(a: AstaInfrasettimanale): Promise<void> {
    const squadra = this.miaSquadra();
    if (!squadra) {
      return;
    }
    try {
      await this.astaInfraService.ritiraBusta(a.id, squadra.id);
      this.snackBar.open('Busta ritirata', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Errore durante il ritiro della busta', undefined, { duration: 3000 });
    }
  }
}
