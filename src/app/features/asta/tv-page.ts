import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AstaStato, Svincolato } from '../../core/models';
import { prossimoScaglioneMulte, round2 } from '../../core/finance-calculator';
import { roleColor, splitRoles } from '../../core/roles';
import { nomeSquadraSerieA } from '../../core/serie-a-logos';
import { AstaService } from '../../core/services/asta.service';
import { AuthService } from '../../core/services/auth.service';
import { FinanceService } from '../../core/services/finance.service';
import { TeamService } from '../../core/services/team.service';
import {
  AstaStatsPanel,
  estraiAcquistiAsta,
  TeamStatAsta,
} from './asta-stats-panel';
import { TeamLogo } from '../../shared/team-logo';
import { SerieALogo } from '../../shared/serie-a-logo';

/**
 * Nomi (giocatori, squadre) SOLO per gli annunci vocali: molte sintesi
 * vocali (es. "Google italiano") leggono una parola tutta MAIUSCOLA come se
 * fosse una sigla, lettera per lettera ("NGONGE" → "enne gi o enne gi e")
 * invece di pronunciarla come un nome. Qui si converte in maiuscolo/
 * minuscolo normale ("Ngonge") solo per il testo letto — a schermo il nome
 * resta tutto maiuscolo com'è sempre stato, più leggibile da lontano su una
 * TV. \p{L} (Unicode) copre anche le lettere accentate.
 */
function nomeLeggibile(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separatore, lettera) => separatore + lettera.toUpperCase());
}

/**
 * Vista TV dell'asta live (/tv): display in grande aggiornato realtime.
 * Sola lettura per tutti, incluso l'admin — le azioni di controllo
 * (assegna/chiudi) si fanno dal proprio dispositivo sulla pagina /asta,
 * non da qui.
 */
@Component({
  selector: 'app-tv-page',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
    AstaStatsPanel,
    TeamLogo,
    SerieALogo,
  ],
  template: `
    <div class="tv">
      <!-- Accesso admin: visibile solo se non si è già admin -->
      @if (!isAdmin()) {
        <a matButton class="admin-login" routerLink="/login">
          <mat-icon>admin_panel_settings</mat-icon>
          Accedi come admin
        </a>
      }

      <!-- Annuncio vocale di squadra + cifra ad ogni rilancio: utile perché
           durante l'asta dal vivo non tutti guardano lo schermo di continuo -->
      <div class="audio-controls">
        <button
          type="button"
          matButton="tonal"
          class="audio-toggle"
          [attr.aria-pressed]="audioAttivo()"
          (click)="toggleAudio()"
        >
          <mat-icon>{{ audioAttivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
          {{ audioAttivo() ? 'Audio rilanci ON' : 'Audio rilanci OFF' }}
        </button>

        <!-- Scelta della voce: alcune "di sistema" sono molto robotiche,
             quelle di rete (es. "Google italiano") suonano molto meglio —
             mostrato solo se il browser ne offre più di una tra cui scegliere -->
        @if (vociItaliane().length > 1) {
          <mat-form-field appearance="fill" subscriptSizing="dynamic" class="voice-select">
            <mat-label>Voce annunci</mat-label>
            <mat-select [value]="nomeVoceScelta()" (selectionChange)="scegliVoce($event.value)">
              @for (v of vociItaliane(); track v.name) {
                <mat-option [value]="v.name">{{ v.name }}{{ v.localService ? '' : ' (rete)' }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <button type="button" matIconButton aria-label="Prova voce" (click)="provaVoce()">
            <mat-icon>play_circle</mat-icon>
          </button>
        }
      </div>

      <!-- Chrome (e altri) bloccano speak() finché la pagina non ha
           ricevuto un click reale: se un annuncio viene rifiutato per
           questo, lo segnaliamo qui — un click su questo stesso bottone
           sblocca tutti gli annunci successivi per il resto della sessione -->
      @if (audioBloccato() && audioAttivo()) {
        <button type="button" matButton="filled" color="warn" class="audio-bloccato" (click)="riattivaAudio()">
          <mat-icon>volume_off</mat-icon>
          Il browser ha bloccato gli annunci — clicca per attivarli
        </button>
      }

      <div class="stage">
        <div class="main">
        @if (stato(); as s) {
          @if (s.aperta) {
            <div class="content">
              <div class="chips">
                @for (r of rolesOf(s.ruolo); track r) {
                  <span
                    class="chip"
                    [style.border-color]="colorFor(r)"
                    [style.color]="colorFor(r)"
                  >{{ r }}</span>
                }
              </div>
              <div class="nome">{{ s.giocatoreNome }}</div>
              @if (s.squadra) {
                <div class="squadra-giocatore">
                  <app-serie-a-logo [sigla]="s.squadra" class="squadra-giocatore-logo" />
                  {{ s.squadra }}
                  <span class="quotazione">Q. {{ s.quotazione }}</span>
                </div>
              }
              <div class="prezzo">{{ s.prezzoAttuale | number: '1.2-2' }} €</div>
              @if (s.rilanciatoDaTeamName) {
                <div class="rilancio">
                  <span class="label">Rilancia</span>
                  <div class="rilancio-riga">
                    <app-team-logo [name]="s.rilanciatoDaTeamName" class="rilancio-logo" />
                    <span class="team">{{ s.rilanciatoDaTeamName }}</span>
                  </div>
                </div>
              } @else {
                <div class="rilancio">
                  <span class="label">Prezzo di partenza</span>
                </div>
              }
            </div>
          } @else {
            <div class="content waiting">
              <div class="waiting-text">Asta chiusa</div>
            </div>
          }
        } @else {
          <div class="content waiting">
            <div class="waiting-text">In attesa dell'asta…</div>
          </div>
        }
        </div>
      </div>

      <!-- Statistiche asta: fuori da .stage apposta, per usare tutta la
           larghezza disponibile invece di fermarsi al max-width del
           riquadro giocatore (altrimenti a zoom ridotto restava piccola
           con spazio vuoto ai lati) -->
      <aside class="tv-stats">
        <h2>
          <mat-icon>bar_chart</mat-icon>
          Statistiche asta
          <span class="rimanenti">{{ rimanenti() }} da chiamare</span>
        </h2>
        <app-asta-stats-panel [stats]="stats()" [sempreAperto]="true" [colonne]="true" />
      </aside>
    </div>
  `,
  styles: `
    .tv {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      background: var(--mat-sys-surface-container-lowest, #fafafa);
      padding: 24px;
    }

    .admin-login {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 10;
    }

    .audio-controls {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      max-width: min(90vw, 520px);
    }

    .voice-select {
      width: 220px;
    }

    .audio-bloccato {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      font-size: 1rem;
    }

    .main {
      width: 100%;
    }

    /* Riquadro giocatore in asta: larghezza limitata per restare leggibile
       anche su schermi molto larghi (le statistiche sotto, fuori da qui,
       usano invece tutta la larghezza disponibile) */
    .stage {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      max-width: 1700px;
    }

    /* Statistiche sotto il giocatore: una colonna per squadra,
       con scorrimento orizzontale se non entrano nello schermo */
    .tv-stats {
      width: 100%;
      text-align: left;
      padding: 20px 24px;
      border-radius: 16px;
      background: var(--mat-sys-surface-container, #fff);
      box-sizing: border-box;
      overflow-x: auto;
    }

    .tv-stats h2 {
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.25rem;
    }

    .rimanenti {
      margin-left: auto;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }

    .content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      text-align: center;
    }

    .chips {
      display: inline-flex;
      gap: 8px;
    }

    .chip {
      display: inline-block;
      padding: 6px 20px;
      border-radius: 999px;
      border: 3px solid currentColor;
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--mat-sys-primary);
    }

    .nome {
      font-size: clamp(3rem, 10vw, 7rem);
      font-weight: 900;
      line-height: 1.05;
    }

    .squadra-giocatore {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: clamp(1.5rem, 4vw, 2.5rem);
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }

    .squadra-giocatore-logo {
      width: clamp(1.6rem, 4vw, 2.4rem);
      height: clamp(1.6rem, 4vw, 2.4rem);
    }

    .quotazione {
      font-size: 0.55em;
      opacity: 0.75;
      font-weight: 600;
    }

    .prezzo {
      font-size: clamp(5rem, 18vw, 13rem);
      font-weight: 900;
      color: var(--mat-sys-primary);
      line-height: 1;
    }

    .rilancio {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rilancio .label {
      font-size: 1.6rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .rilancio-riga {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .rilancio-logo {
      width: clamp(3rem, 8vw, 5.5rem);
      height: clamp(3rem, 8vw, 5.5rem);
      flex-shrink: 0;
    }

    .rilancio .team {
      font-size: clamp(2rem, 6vw, 4rem);
      font-weight: 800;
    }

    .waiting-text {
      font-size: clamp(2rem, 6vw, 4rem);
      font-weight: 700;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class TvPage {
  private readonly astaService = inject(AstaService);
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly financeService = inject(FinanceService);

  readonly stato = toSignal(this.astaService.stato$, {
    initialValue: undefined as AstaStato | undefined,
  });

  /** true solo per l'admin autenticato con email/password */
  readonly isAdmin = toSignal(this.authService.isAdmin$, { initialValue: false });

  /**
   * Statistiche di tutte le squadre: giocatori su 28, bilancio e acquisti
   * fatti durante l'asta (stessa pipeline della pagina /asta).
   *
   * Usa combineLatest (NON forkJoin): gli osservabili Firestore non
   * completano mai, quindi forkJoin non emetterebbe mai nulla.
   */
  readonly stats = toSignal(
    this.teamService.teams$.pipe(
      switchMap((teams) =>
        teams.length
          ? combineLatest(
              teams.map((team) =>
                combineLatest([
                  this.teamService.players$(team.id),
                  this.financeService.seasonFinance$(team.id),
                  this.financeService.taxBrackets$,
                ]).pipe(
                  map(([players, finance, brackets]) => {
                    const spesaAnnuale = finance?.spesaAnnuale ?? 0;
                    const scaglione = prossimoScaglioneMulte(spesaAnnuale, brackets);
                    return {
                      id: team.id,
                      name: team.name,
                      giocatori: players.length,
                      bilancio: finance?.bilancioSocietarioStagionale ?? 0,
                      residuoAlleMulte: scaglione ? round2(scaglione.limiteSogliaEuro - spesaAnnuale) : 0,
                      prossimoScaglioneIndex: scaglione?.bracketIndex ?? null,
                      acquisti: estraiAcquistiAsta(players),
                    };
                  }),
                ),
              ),
            )
          : of([] as TeamStatAsta[]),
      ),
    ),
    { initialValue: [] as TeamStatAsta[] },
  );

  private readonly svincolati = toSignal(this.teamService.svincolati$, {
    initialValue: [] as Svincolato[],
  });
  /** Quanti svincolati non sono ancora stati chiamati all'asta (esclusi random e manuali) */
  readonly rimanenti = computed(() => this.svincolati().filter((s) => !s.chiamato).length);

  /** Annuncio vocale ON/OFF (controllo locale, non persistito: si riparte da ON ad ogni apertura) */
  readonly audioAttivo = signal(true);
  /**
   * Ultima "chiave" di rilancio già vista (squadra+prezzo, null se nessun
   * rilancio in corso) — undefined SOLO prima della primissima valutazione
   * dell'effetto: serve a distinguerla da un vero null (asta aperta ma
   * senza ancora nessun rilancio), altrimenti il primissimo rilancio reale
   * verrebbe scambiato per "stato già in corso al caricamento" e non
   * annunciato.
   */
  private ultimaChiaveAnnunciata: string | null | undefined = undefined;
  /**
   * Giocatore dell'ultima asta APERTA di cui è già stato annunciato
   * l'inizio (null se nessuna asta aperta) — stessa convenzione di
   * ultimaChiaveAnnunciata: undefined solo prima della primissima
   * valutazione, per non annunciare l'asta già in corso al caricamento.
   */
  private ultimoGiocatoreAnnunciato: string | null | undefined = undefined;
  /**
   * "Chiave" dell'ultima assegnazione già annunciata (giocatore+vincitore+
   * prezzo, null se l'asta è aperta o è stata chiusa senza assegnare) —
   * stessa convenzione delle altre due: undefined solo prima della
   * primissima valutazione.
   */
  private ultimaAssegnazioneAnnunciata: string | null | undefined = undefined;

  /**
   * true quando l'ultimo tentativo di annuncio è stato rifiutato dal
   * browser con "not-allowed" (nessun gesto utente ancora ricevuto su
   * questa pagina) — mostra un avviso con un bottone che, cliccato, sblocca
   * tutti gli annunci successivi per il resto della sessione.
   */
  readonly audioBloccato = signal(false);

  private static readonly VOCE_STORAGE_KEY = 'tv.voceAnnunci';
  /** Voci italiane disponibili nel browser per la sintesi vocale */
  readonly vociItaliane = signal<SpeechSynthesisVoice[]>([]);
  /** Voce attualmente scelta per gli annunci (null finché le voci non sono ancora caricate) */
  readonly voceScelta = signal<SpeechSynthesisVoice | null>(null);
  readonly nomeVoceScelta = computed(() => this.voceScelta()?.name ?? '');

  constructor() {
    this.caricaVoci();

    // Annuncio vocale "squadra, cifra" ad ogni NUOVO rilancio — utile perché
    // durante l'asta dal vivo in modalità TV non tutti guardano lo schermo
    // di continuo. Non annuncia lo stato già in corso al primo caricamento
    // della pagina, solo i rilanci successivi.
    effect(() => {
      const s = this.stato();
      if (!s) {
        return;
      }
      const chiaveAttuale =
        s.aperta && s.rilanciatoDaTeamName ? `${s.rilanciatoDaTeamId}-${s.prezzoAttuale}` : null;
      if (chiaveAttuale === this.ultimaChiaveAnnunciata) {
        return;
      }
      const primaValutazione = this.ultimaChiaveAnnunciata === undefined;
      this.ultimaChiaveAnnunciata = chiaveAttuale;
      if (!primaValutazione && chiaveAttuale && this.audioAttivo()) {
        this.annuncia(`${nomeLeggibile(s.rilanciatoDaTeamName)}, ${s.prezzoAttuale} euro`);
      }
    });

    // Annuncio vocale "ha inizio l'asta per..." quando si apre l'asta su un
    // NUOVO giocatore — stessa logica di skip del primo caricamento pagina
    // usata sopra per i rilanci.
    effect(() => {
      const s = this.stato();
      if (!s) {
        return;
      }
      const giocatoreAttuale = s.aperta ? s.giocatoreNome : null;
      if (giocatoreAttuale === this.ultimoGiocatoreAnnunciato) {
        return;
      }
      const primaValutazione = this.ultimoGiocatoreAnnunciato === undefined;
      this.ultimoGiocatoreAnnunciato = giocatoreAttuale;
      if (!primaValutazione && giocatoreAttuale && this.audioAttivo()) {
        const nomeSquadra = nomeSquadraSerieA(s.squadra) ?? s.squadra;
        this.annuncia(
          `Ha inizio l'asta per ${nomeLeggibile(giocatoreAttuale)} della squadra ${nomeSquadra}`,
        );
      }
    });

    // Annuncio vocale "... ha acquistato ... per ..." quando l'asta viene
    // chiusa con un'assegnazione — rilanciatoDaTeamName non basta a capire
    // chi ha vinto: l'admin può assegnare a una squadra diversa dall'ultima
    // rilanciante, quindi il servizio scrive squadra e prezzo effettivi in
    // ultimoVincitoreNome/ultimoPrezzo apposta per questo annuncio.
    effect(() => {
      const s = this.stato();
      if (!s) {
        return;
      }
      const chiaveAssegnazione =
        !s.aperta && s.ultimoEsito === 'assegnato' && s.ultimoVincitoreNome
          ? `${s.giocatoreNome}-${s.ultimoVincitoreNome}-${s.ultimoPrezzo}`
          : null;
      if (chiaveAssegnazione === this.ultimaAssegnazioneAnnunciata) {
        return;
      }
      const primaValutazione = this.ultimaAssegnazioneAnnunciata === undefined;
      this.ultimaAssegnazioneAnnunciata = chiaveAssegnazione;
      if (!primaValutazione && chiaveAssegnazione && this.audioAttivo()) {
        this.annuncia(
          `${nomeLeggibile(s.ultimoVincitoreNome!)} ha acquistato ${nomeLeggibile(s.giocatoreNome)} per ${s.ultimoPrezzo} euro`,
        );
      }
    });
  }

  toggleAudio(): void {
    this.audioAttivo.set(!this.audioAttivo());
    if (!this.audioAttivo()) {
      window.speechSynthesis?.cancel();
      return;
    }
    // Il click è un vero gesto dell'utente: Chrome richiede almeno UNA
    // chiamata a speak() dentro un gesto genuino prima di permettere quelle
    // successive innescate da eventi asincroni (un nuovo rilancio, un'asta
    // che si apre) — altrimenti le blocca in silenzio con errore
    // "not-allowed". Questo annuncio "sblocca" tutti quelli seguenti.
    this.annuncia('Audio attivato');
  }

  /** Click sul banner "annunci bloccati": stesso principio di toggleAudio, riprova a parlare dentro il gesto */
  riattivaAudio(): void {
    this.annuncia('Audio attivato');
  }

  /**
   * Carica le voci italiane disponibili nel browser e sceglie quella
   * migliore di default — le voci "di rete" (es. "Google italiano" su
   * Chrome) suonano molto più naturali di quelle "di sistema" (SAPI /
   * accessibilità Windows, sempre locali) che il browser userebbe altrimenti
   * come scelta implicita. L'elenco arriva spesso in modo asincrono, da qui
   * il listener oltre alla lettura immediata.
   */
  private caricaVoci(): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const aggiorna = () => {
      const italiane = window.speechSynthesis
        .getVoices()
        .filter((v) => v.lang.toLowerCase().startsWith('it'));
      if (italiane.length === 0) {
        return;
      }
      this.vociItaliane.set(italiane);
      if (!this.voceScelta()) {
        this.voceScelta.set(this.sceglieMigliore(italiane));
      }
    };
    aggiorna();
    window.speechSynthesis.onvoiceschanged = aggiorna;
  }

  private sceglieMigliore(voci: SpeechSynthesisVoice[]): SpeechSynthesisVoice {
    try {
      const salvata = localStorage.getItem(TvPage.VOCE_STORAGE_KEY);
      const trovata = salvata ? voci.find((v) => v.name === salvata) : undefined;
      if (trovata) {
        return trovata;
      }
    } catch {
      // localStorage non disponibile: si ripiega sulla scelta automatica
    }
    return voci.find((v) => !v.localService) ?? voci[0];
  }

  scegliVoce(nome: string): void {
    const voce = this.vociItaliane().find((v) => v.name === nome);
    if (!voce) {
      return;
    }
    this.voceScelta.set(voce);
    try {
      localStorage.setItem(TvPage.VOCE_STORAGE_KEY, voce.name);
    } catch {
      // localStorage non disponibile: la scelta resta valida solo per questa sessione
    }
  }

  /** Piccolo assaggio della voce scelta, per confrontarle senza aspettare un rilancio vero */
  provaVoce(): void {
    this.annuncia("Questa è la voce degli annunci durante l'asta");
  }

  /**
   * Sintesi vocale in italiano — interrompe un annuncio precedente non
   * ancora finito. Il resume() prima di speak() è un workaround noto per un
   * bug di Chrome: dopo diversi annunci consecutivi (tipico durante un'asta
   * con più rilanci) la coda di speechSynthesis può bloccarsi silenziosamente
   * senza errori — resume() la sblocca, ed è innocuo quando non serve.
   *
   * L'errore "not-allowed" invece è una vera policy del browser: Chrome
   * blocca speak() finché la pagina non ha ricevuto ALMENO un gesto reale
   * dell'utente (un click) — un annuncio innescato da un rilancio/apertura/
   * assegnazione arrivati via Firestore, senza che nessuno abbia mai
   * cliccato nulla sullo schermo TV, viene quindi rifiutato in silenzio
   * (nessuna eccezione, solo l'evento "error" dell'utterance). Se succede,
   * lo intercettiamo per mostrare un avviso a schermo — un click su
   * "Attiva audio" lì lo sblocca subito, perché quel click SÌ è un gesto
   * genuino.
   */
  private annuncia(testo: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const utterance = new SpeechSynthesisUtterance(testo);
    utterance.lang = 'it-IT';
    const voce = this.voceScelta();
    if (voce) {
      utterance.voice = voce;
    }
    utterance.addEventListener('start', () => this.audioBloccato.set(false));
    utterance.addEventListener('error', (e) => {
      if (e.error === 'not-allowed') {
        this.audioBloccato.set(true);
      }
    });
    window.speechSynthesis.speak(utterance);
  }

  rolesOf(ruolo: string): string[] {
    return splitRoles(ruolo);
  }

  colorFor(role: string): string {
    return roleColor(role);
  }
}