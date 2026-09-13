import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import { AstaInfrasettimanaleConfig, MomentoSettimanale } from '../../core/models';
import { LeagueService } from '../../core/services/league.service';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';

/** Uno scaglione di tassazione fairplay finanziario: sopra `soglia` € si paga `aliquota` sull'eccedenza */
interface Scaglione {
  soglia: number;
  aliquota: number;
}

/** Una funzionalità raccontata: icona + titolo + descrizione, con un'eventuale tabella a scaglioni ed esempio */
interface Funzionalita {
  icona: string;
  titolo: string;
  descrizione: string;
  scaglioni?: readonly Scaglione[];
  esempio?: string;
}

/** Scaglioni di tassazione fairplay finanziario correnti della lega */
const SCAGLIONI_FAIRPLAY: readonly Scaglione[] = [
  { soglia: 375.8, aliquota: 0.35 },
  { soglia: 414.7, aliquota: 0.75 },
  { soglia: 453.6, aliquota: 1.2 },
  { soglia: 492.4, aliquota: 1.7 },
  { soglia: 531.3, aliquota: 2.25 },
  { soglia: 570.2, aliquota: 2.85 },
];

/** Giorni nell'ordine di Date.getDay() (0 = domenica), per scrivere gli orari dell'asta infrasettimanale */
const GIORNI_LABEL = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

function formatMomento(m: MomentoSettimanale): string {
  return `${GIORNI_LABEL[m.giorno]} ${m.ora}`;
}

function formatIntervallo(inizio: MomentoSettimanale, fine: MomentoSettimanale): string {
  return `da ${formatMomento(inizio)} a ${formatMomento(fine)}`;
}

/**
 * Le 3 voci dell'asta infrasettimanale che NON dipendono dall'orario
 * (restano identiche a prescindere dalla configurazione) — le 4 fasi vere e
 * proprie sono generate dal vivo, vedi SupportoPage.sezioneAstaInfrasettimanale.
 */
const ASTA_INFRA_FUNZIONALITA_STATICHE: readonly Funzionalita[] = [
  {
    icona: 'lock',
    titolo: 'Serve il login della TUA squadra',
    descrizione:
      'A differenza dell’asta di settembre, qui non basta scegliere una squadra da un elenco: per chiamare, rilanciare o presentare una busta devi aver fatto login proprio con l’account della tua squadra (vedi "Accesso come squadra" in cima a questa pagina) — è una verifica vera, non solo un’impostazione della webapp, quindi non è possibile agire per conto di un’altra squadra nemmeno cambiando la selezione.',
  },
  {
    icona: 'notifications',
    titolo: 'Notifiche push (opzionali)',
    descrizione:
      'Dopo aver scelto la tua squadra, se il browser le supporta compare il bottone "Attiva notifiche". Una volta attive, ricevi un avviso quando qualcuno rilancia su un giocatore a cui hai messo almeno una stellina negli Svincolati, e quando arriva una busta su un giocatore per cui avevi rilanciato — l’avviso dice solo che è arrivata una busta, MAI l’importo, per non intaccarne la segretezza. Se il sito è aperto in primo piano l’avviso compare dentro la pagina; se è chiuso o in background arriva come una vera notifica di sistema (serve solo che il browser sia ancora acceso, anche in background).',
  },
  {
    icona: 'phone_iphone',
    titolo: 'Notifiche su iPhone: aggiungi l’app alla schermata Home',
    descrizione:
      'Su iPhone le notifiche funzionano solo se il sito è stato aggiunto alla schermata Home (richiede iOS 16.4 o successivo): tocca "Condividi" in Safari e poi "Aggiungi a Home", quindi apri sempre l’app da quell’icona (non da una scheda Safari normale) quando premi "Attiva notifiche" — da una scheda Safari qualsiasi il permesso non viene chiesto correttamente.',
  },
];

/** Sezione di supporto: una voce di menu con le sue funzionalità da loggati */
interface SezioneSupporto {
  icona: string;
  titolo: string;
  /** testo introduttivo breve, prima dell'elenco funzionalità */
  intro?: string;
  funzionalita: readonly Funzionalita[];
}

const SEZIONI: readonly SezioneSupporto[] = [
  {
    icona: 'dashboard',
    titolo: 'Dashboard (tab Giocatori e Spese)',
    intro:
      'Sul telefono la Dashboard è divisa in due tab in alto, "Giocatori" e "Spese".',
    funzionalita: [
      {
        icona: 'login',
        titolo: 'Si apre già sulla tua squadra',
        descrizione:
          'Appena accedi, la rosa mostrata nella tab Giocatori è automaticamente la tua — non serve selezionarla ogni volta dal menù a tendina in alto.',
      },
      {
        icona: 'calculate',
        titolo: 'Anteprima rinnovi',
        descrizione:
          'In cima alla tab Giocatori, il pulsante "Anteprima rinnovi" apre un elenco dei giocatori non ancora rinnovati: selezionandone alcuni vedi subito il costo totale che avrebbe rinnovarli tutti. È solo un calcolo — il rinnovo vero resta un’operazione dell’admin.',
      },
      {
        icona: 'autorenew',
        titolo: 'Riga evidenziata: giocatore già rinnovato/acquistato',
        descrizione:
          'Nella tab Giocatori, un giocatore con la riga leggermente colorata ha già speso soldi quest’anno (acquisto o rinnovo): il campo "Speso €" è diverso da zero. Visibile a chiunque consulti la rosa, non solo da loggati.',
      },
      {
        icona: 'block',
        titolo: 'Riga rosa: giocatore fuori Serie A',
        descrizione:
          'Sempre nella tab Giocatori, la riga rosa segnala un giocatore non più presente in nessun listone ufficiale della Serie A corrente. Anche questa visibile a tutti.',
      },
      {
        icona: 'rule',
        titolo: 'Multe condotta antisportiva (tab Spese)',
        descrizione:
          'Sono le multe per il mancato inserimento della formazione entro i termini.',
      },
      {
        icona: 'account_balance',
        titolo: 'Multe fairplay finanziario (tab Spese)',
        descrizione:
          'Sono le multe per chi supera determinati scaglioni di spesa stagionale (l’imponibile, vedi sotto). È una tassazione PROGRESSIVA a scaglioni, come l’IRPEF: superata una soglia, l’aliquota di quello scaglione si applica solo alla parte di imponibile che ricade in quello scaglione, non a tutto l’imponibile.',
        scaglioni: SCAGLIONI_FAIRPLAY,
        esempio:
          'Esempio con imponibile di 500 €: nessuna multa sui primi 375,80 €; poi 35% sui 38,90 € fino a 414,70 €; 75% sui 38,90 € fino a 453,60 €; 120% sui 38,90 € fino a 492,40 €; 170% sui restanti 7,60 € fino a 500 € — totale multa 102,39 €. La multa non scende mai sotto il massimo già raggiunto in stagione, anche se le spese diminuiscono in seguito.',
      },
      {
        icona: 'receipt_long',
        titolo: 'Imponibile fairplay finanziario (tab Spese)',
        descrizione:
          'È la cifra di riferimento su cui si calcolano le multe del fairplay finanziario. A differenza del bilancio stagionale, qui gli indennizzi sono inclusi per intero e non vengono scontati.',
      },
    ],
  },
  {
    icona: 'person_search',
    titolo: 'Svincolati',
    intro:
      'Oltre a cercare e filtrare come chiunque altro, da loggato puoi tenere valutazioni private che solo tu vedi — utili per prepararti prima di un’asta.',
    funzionalita: [
      {
        icona: 'star',
        titolo: 'Valutazione a stelle (1-3)',
        descrizione:
          'Apri il pannello di uno svincolato dal simbolo a fine riga e assegna da 1 a 3 stelle. Compare subito un riepilogo nella riga compatta (solo le stelle assegnate, non tutte e tre).',
      },
      {
        icona: 'sticky_note_2',
        titolo: 'Nota privata',
        descrizione:
          'Nello stesso pannello puoi scrivere una nota libera per ricordarti qualcosa su quel giocatore. Se c’è una nota salvata, la sua icona sostituisce la freccina di apertura sulla riga.',
      },
      {
        icona: 'filter_alt',
        titolo: 'Filtro "Solo valutati"',
        descrizione:
          'Il pulsante accanto ai filtri mostra solo gli svincolati a cui hai dato almeno una stella — utile per rivedere in fretta la tua lista prima di un’asta.',
      },
      {
        icona: 'history',
        titolo: 'Riga rosa: giocatore già chiamato in asta',
        descrizione:
          'Segnala uno svincolato per cui l’asta è già stata aperta almeno una volta (a prescindere dall’esito), così l’estrazione "Apri asta random" dell’admin non ripesca sempre gli stessi nomi. Visibile a tutti, non solo da loggati.',
      },
    ],
  },
  {
    icona: 'gavel',
    titolo: 'Asta',
    intro:
      'Sul telefono trovi anche qui due tab in alto, "Asta" e "Statistiche": il rilancio è nella tab Asta (quella già aperta di default).',
    funzionalita: [
      {
        icona: 'visibility',
        titolo: 'Le tue valutazioni durante il rilancio',
        descrizione:
          'Quando rilanci su un giocatore, vedi lì le stelle e la nota che gli hai dato negli svincolati (solo tu, nessun altro le vede). Chi non ha fatto login può comunque rilanciare scegliendo la squadra manualmente, ma senza questo aiuto.',
      },
    ],
  },
  {
    icona: 'event_repeat',
    titolo: 'Asta infrasettimanale',
    // intro e le 4 fasi sono generate dal vivo da sezioneAstaInfrasettimanale()
    // (leggono la configurazione reale da Firestore): questa voce serve solo
    // come segnaposto/ordine nell'elenco, vedi SupportoPage.sezioni.
    intro: '',
    funzionalita: [],
  },
  {
    icona: 'swap_horiz',
    titolo: 'Scambi',
    funzionalita: [
      {
        icona: 'edit_note',
        titolo: 'Proponi una trattativa',
        descrizione:
          'Nel modulo "Nuova trattativa" la Squadra A parte già precompilata sulla tua — puoi comunque cambiarla, basta che almeno una delle due resti la tua squadra. Sul telefono le due rose (la tua e quella della controparte) appaiono impilate, una sotto l’altra sotto la rispettiva tendina: scorri per vederle entrambe e scegli i giocatori coinvolti da ciascuna.',
      },
      {
        icona: 'visibility_off',
        titolo: 'La bozza è privata',
        descrizione:
          'Finché resta una bozza, la trattativa è visibile SOLO a te e alla controparte — nessun altro, admin compreso, la vede in questa fase.',
      },
      {
        icona: 'send',
        titolo: 'Ufficializza',
        descrizione:
          'Quando tu o la controparte siete pronti, il pulsante "Ufficializza" la rende visibile all’admin per la conferma finale. Da lì in poi la trattativa diventa visibile a tutti.',
      },
      {
        icona: 'delete',
        titolo: 'Elimina',
        descrizione:
          'Puoi eliminare una tua bozza in qualunque momento prima di ufficializzarla. Una volta ufficializzata, non è più cancellabile da una squadra.',
      },
    ],
  },
  {
    icona: 'emoji_events',
    titolo: 'Montepremi',
    intro:
      'Pagina di sola consultazione, identica per tutti: nessuna funzione aggiuntiva per chi ha fatto login.',
    funzionalita: [],
  },
  {
    icona: 'history',
    titolo: 'Storico',
    intro:
      'Riservato all’amministrazione: un account squadra non vede questa voce di menu.',
    funzionalita: [],
  },
];

/**
 * Pagina pubblica (nessun login richiesto) di supporto: spiega, voce di
 * menu per voce di menu, cosa può fare in più una squadra che ha fatto
 * login rispetto a chi consulta l'app senza account — così chi non ha
 * ancora effettuato l'accesso può farsi un'idea di cosa otterrebbe.
 * Contenuto testuale + icone Material (nessuno screenshot: meno
 * manutenzione, coerente con lo stile del resto dell'app).
 */
@Component({
  selector: 'app-supporto-page',
  imports: [DecimalPipe, MatIconModule, NavMenu, HeaderAuthStatus],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <img src="icons/logo-emblema.png" class="header-logo" alt="" />
        <h1 class="app-title">Supporto</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">
        <section class="group intro-group">
          <h2><mat-icon>shield</mat-icon> Accesso come squadra</h2>
          <p class="intro">
            Oltre all’account admin condiviso, ogni squadra ha un proprio
            accesso personale: sblocca le funzioni descritte qui sotto, in
            più a quelle già disponibili a chiunque consulti l’app.
          </p>
          <ol class="steps">
            <li>
              <mat-icon>login</mat-icon>
              <span>Tocca "Accedi" in alto a destra</span>
            </li>
            <li>
              <mat-icon>groups</mat-icon>
              <span>Scegli "La mia squadra", seleziona il tuo nome dall’elenco</span>
            </li>
            <li>
              <mat-icon>lock</mat-icon>
              <span>Inserisci la password della tua squadra e conferma</span>
            </li>
          </ol>
          <p class="intro">
            Una volta dentro, l’header mostra il nome della tua squadra al
            posto di "Accedi": toccandolo trovi "Esci" per il logout.
          </p>
          <p class="intro nota-desktop">
            Le istruzioni qui sotto si riferiscono alla vista da telefono
            (quella usata più spesso). Da computer trovi le stesse funzioni,
            solo disposte diversamente — niente tab da aprire, è tutto già
            visibile insieme.
          </p>
        </section>

        @for (sezione of sezioni(); track sezione.titolo) {
          <section class="group">
            <button
              type="button"
              class="cap-head"
              [attr.aria-expanded]="apertaChe(sezione.titolo)"
              (click)="toggleSezione(sezione.titolo)"
            >
              <h2><mat-icon>{{ sezione.icona }}</mat-icon> {{ sezione.titolo }}</h2>
              <mat-icon class="chevron">{{ apertaChe(sezione.titolo) ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            @if (apertaChe(sezione.titolo)) {
              <div class="cap-body">
                @if (sezione.intro) {
                  <p class="intro">{{ sezione.intro }}</p>
                }
                @if (sezione.funzionalita.length > 0) {
                  <ul class="capabilities">
                    @for (f of sezione.funzionalita; track f.titolo) {
                      <li>
                        <mat-icon class="cap-icon">{{ f.icona }}</mat-icon>
                        <div>
                          <strong>{{ f.titolo }}</strong>
                          <p>{{ f.descrizione }}</p>
                          @if (f.scaglioni; as scaglioni) {
                            <div class="scaglioni-scroll">
                              <table class="scaglioni">
                                <thead>
                                  <tr>
                                    <th>Scaglione</th>
                                    <th>Sopra €</th>
                                    <th>Aliquota</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  @for (s of scaglioni; track s.soglia; let i = $index) {
                                    <tr>
                                      <td>{{ i + 1 }}°</td>
                                      <td>{{ s.soglia | number: '1.2-2' }}</td>
                                      <td>{{ s.aliquota * 100 | number: '1.0-0' }}%</td>
                                    </tr>
                                  }
                                </tbody>
                              </table>
                            </div>
                          }
                          @if (f.esempio) {
                            <p class="esempio">{{ f.esempio }}</p>
                          }
                        </div>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </section>
        }
      </main>
    </div>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .group {
      background: var(--mat-sys-surface-container-low, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
      border-radius: 16px;
      box-shadow: var(--mat-sys-level1, 0 1px 3px rgba(0, 0, 0, 0.3));
      overflow: hidden;
    }

    .intro-group {
      padding: 16px;
    }

    .cap-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 14px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
    }

    .cap-head[aria-expanded='true'] {
      background: var(--mat-sys-surface-container-high);
    }

    .chevron {
      flex-shrink: 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .cap-body {
      padding: 4px 16px 16px;
      border-top: 1px dashed var(--mat-sys-outline-variant);
    }

    .cap-body .intro:first-child {
      margin-top: 10px;
    }

    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      font-size: 1.05rem;
    }

    .cap-head h2 {
      margin: 0;
    }

    h2 mat-icon {
      color: var(--mat-sys-primary);
    }

    .intro {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .intro:last-child {
      margin-bottom: 0;
    }

    .intro-group .intro + .intro {
      margin-top: 12px;
    }

    .nota-desktop {
      font-style: italic;
    }

    .steps {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      counter-reset: step;
    }

    .steps li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--mat-sys-surface-container-high);
      font-size: 0.875rem;
    }

    .steps li mat-icon {
      flex-shrink: 0;
      color: var(--mat-sys-primary);
    }

    .capabilities {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .capabilities li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .cap-icon {
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--mat-sys-tertiary);
    }

    .capabilities strong {
      display: block;
      font-size: 0.9rem;
    }

    .capabilities p {
      margin: 2px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.85rem;
      line-height: 1.5;
    }

    /* Tabella scaglioni fairplay finanziario: overflow-x proprio, mai la pagina intera */
    .scaglioni-scroll {
      overflow-x: auto;
      margin-top: 10px;
    }

    .scaglioni {
      width: 100%;
      min-width: 280px;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    .scaglioni th,
    .scaglioni td {
      padding: 5px 8px;
      text-align: right;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      font-variant-numeric: tabular-nums;
    }

    .scaglioni th:first-child,
    .scaglioni td:first-child {
      text-align: left;
      font-variant-numeric: normal;
    }

    .scaglioni th {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 500;
    }

    .esempio {
      margin: 10px 0 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.82rem;
      line-height: 1.5;
    }
  `,
})
export class SupportoPage {
  private readonly leagueService = inject(LeagueService);

  readonly leagueName = environment.leagueName;

  /** Configurazione reale dell'asta infrasettimanale, per scrivere gli orari veri invece di un "di default" statico */
  private readonly config = toSignal(this.leagueService.astaInfrasettimanaleConfig$, {
    initialValue: undefined as AstaInfrasettimanaleConfig | undefined,
  });

  /**
   * La voce "Asta infrasettimanale" con intro e 4 fasi generate dal vivo
   * dalla configurazione reale — si aggiorna da sola se l'admin la cambia,
   * senza bisogno di toccare il codice (vedi domanda dell'utente: "se lo
   * cambiassi si allineerebbe la pagina supporto?" — ora sì).
   */
  private readonly sezioneAstaInfrasettimanale = computed<SezioneSupporto>(() => {
    const base = SEZIONI.find((s) => s.titolo === 'Asta infrasettimanale')!;
    const c = this.config();
    if (!c) {
      // Prima che Firestore risponda: intro generica, senza orari specifici
      // (evita di mostrare per un istante degli orari sbagliati/vuoti).
      return {
        ...base,
        intro:
          'È un ciclo settimanale ricorrente per comprare svincolati a metà settimana (parallelo all’asta di settembre): più giocatori possono essere in asta insieme, tutti visibili in una griglia — tocca una card per aprirne il dettaglio e rilanciare. Il ciclo passa per 4 fasi in sequenza.',
        funzionalita: ASTA_INFRA_FUNZIONALITA_STATICHE,
      };
    }
    const fasi: Funzionalita[] = [
      {
        icona: 'campaign',
        titolo: `Fase 1 — Chiamata (${formatIntervallo(c.inizioChiamata, c.inizioSoloRilanci)})`,
        descrizione:
          'Qualunque presidente loggato con la propria squadra può "chiamare" uno svincolato a 0,10 € di partenza, dal pannello che si apre toccando la sua riga in Svincolati ("Chiama (infrasettimanale)"). Il giocatore compare subito a tutti nella griglia di questa pagina, con te già segnato come rilanciante di partenza. Non puoi chiamare se hai già raggiunto i 28 giocatori, contando anche quelli per cui sei già in testa in altre aste infrasettimanali aperte in questo momento.',
      },
      {
        icona: 'gavel',
        titolo: `Fase 2 — Solo rilanci (${formatIntervallo(c.inizioSoloRilanci, c.inizioBuste)})`,
        descrizione:
          'Non si possono più chiamare nuovi giocatori, ma le aste già aperte restano rilanciabili: tocca la card del giocatore per aprire il dettaglio e usa uno dei pulsanti rapidi (o inserisci un rilancio custom). Attenzione: SOLO le squadre che rilanciano in questa fascia diventano eleggibili a presentare una busta su quel giocatore nella fase successiva — chi non rilancia qui (anche se lo aveva chiamato) resta escluso dalle buste.',
      },
      {
        icona: 'mail_lock',
        titolo: `Fase 3 — Buste (${formatIntervallo(c.inizioBuste, c.inizioAssegnazione)})`,
        descrizione:
          'I rilanci pubblici sono chiusi: solo le squadre eleggibili (vedi fase 2) possono presentare una busta segreta, di importo almeno pari all’ultimo rilancio. È modificabile e ritirabile finché la fase resta aperta. La tua busta la vedi solo tu — nessun’altra squadra la vede mai, nemmeno a esito noto; solo l’admin la vede, e solo dopo la scadenza, per l’assegnazione.',
      },
      {
        icona: 'how_to_vote',
        titolo: `Fase 4 — Assegnazione admin (da ${formatMomento(c.inizioAssegnazione)})`,
        descrizione:
          'L’admin vede tutte le buste presentate con una proposta automatica di assegnazione (la busta più alta, oppure l’ultimo rilancio se non è arrivata nessuna busta), ma può sempre correggere squadra e prezzo a mano prima di confermare: non c’è mai un’assegnazione automatica silenziosa. Una volta assegnato, il giocatore entra subito nella rosa della squadra vincitrice; come ogni acquisto, resta annullabile dall’admin da Storico.',
      },
    ];
    return {
      ...base,
      intro:
        (c.abilitata
          ? ''
          : '⚠️ Il prossimo ciclo è attualmente DISABILITATO dall’admin — gli orari sotto sono quelli configurati ma non in vigore finché non viene riattivato. ') +
        'È un ciclo settimanale ricorrente per comprare svincolati a metà settimana (parallelo all’asta di settembre): più giocatori possono essere in asta insieme, tutti visibili in una griglia — tocca una card per aprirne il dettaglio e rilanciare. Il ciclo passa per 4 fasi in sequenza; gli orari qui sotto sono quelli ATTUALMENTE impostati dall’admin, letti in tempo reale — se li cambia dal pannello nella sezione Svincolati, questa pagina si aggiorna da sola.',
      funzionalita: [...fasi, ...ASTA_INFRA_FUNZIONALITA_STATICHE],
    };
  });

  /** Le sezioni da mostrare: identiche a SEZIONI, tranne "Asta infrasettimanale" che è generata dal vivo */
  readonly sezioni = computed(() =>
    SEZIONI.map((s) => (s.titolo === 'Asta infrasettimanale' ? this.sezioneAstaInfrasettimanale() : s)),
  );

  /** Sezioni aperte (stato solo UI, tutte chiuse all'apertura della pagina) */
  private readonly aperte = signal<ReadonlySet<string>>(new Set());

  apertaChe(titolo: string): boolean {
    return this.aperte().has(titolo);
  }

  toggleSezione(titolo: string): void {
    const next = new Set(this.aperte());
    if (!next.delete(titolo)) {
      next.add(titolo);
    }
    this.aperte.set(next);
  }
}
