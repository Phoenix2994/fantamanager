import { Component, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../environments/environment';
import { NavMenu } from '../../core/nav/nav-menu';
import { HeaderAuthStatus } from '../../shared/header-auth-status';

/** Un paragrafo di testo semplice, un elenco puntato, una nota/esempio o una tabella */
type Paragrafo =
  | { tipo: 'testo'; testo: string }
  | { tipo: 'lista'; voci: string[] }
  | { tipo: 'esempio'; testo: string }
  | { tipo: 'tabella'; intestazioni: string[]; righe: string[][] };

interface Sottosezione {
  titolo?: string;
  paragrafi: Paragrafo[];
}

interface Capitolo {
  numero: string;
  titolo: string;
  icona: string;
  sottosezioni: Sottosezione[];
}

const testo = (t: string): Paragrafo => ({ tipo: 'testo', testo: t });
const lista = (voci: string[]): Paragrafo => ({ tipo: 'lista', voci });
const esempio = (t: string): Paragrafo => ({ tipo: 'esempio', testo: t });

const CAPITOLI: readonly Capitolo[] = [
  {
    numero: '1',
    titolo: 'Introduzione e Squadra',
    icona: 'groups',
    sottosezioni: [
      {
        paragrafi: [
          lista([
            'Ogni rosa deve avere tra 22 e 28 giocatori. Almeno 22 a titolo definitivo — vi rientrano anche quelli ceduti in prestito, che restano di proprietà.',
            'A fine campionato i giocatori restano in rosa. Senza limiti al numero di prestiti concessi, una squadra può ritrovarsi a inizio stagione con più dei 28 giocatori consentiti durante l’anno: scatta allora l’obbligo di svincolare l’eccedenza entro la domenica dopo la fine del campionato.',
            'Se il tetto di 28 viene superato durante la stagione per altri motivi (fine di un prestito per clausola, o fine di una sessione di mercato inter-stagionale), lo svincolo dell’eccedenza è immediato — non si aspetta la partita di Serie A successiva.',
            'Se un giocatore lascia la Serie A e la squadra proprietaria scende sotto 22, il presidente deve comprarne uno al primo mercato libero disponibile — anche se il calo è arrivato da uno scambio con un altro allenatore.',
          ]),
        ],
      },
    ],
  },
  {
    numero: '2',
    titolo: 'Asta e Concetto di Proprietà',
    icona: 'gavel',
    sottosezioni: [
      {
        titolo: 'Aste',
        paragrafi: [
          testo(
            'Ogni presidente spende in asta a propria discrezione, senza tetto massimo. Superata una soglia, però, si pagano tasse sull’eccedenza a scaglioni progressivi (fairplay finanziario):',
          ),
          {
            tipo: 'tabella',
            intestazioni: ['Scaglione', 'Sopra €', 'Aliquota'],
            righe: [
              ['1°', '375,80', '35%'],
              ['2°', '414,70', '75%'],
              ['3°', '453,60', '120%'],
              ['4°', '492,40', '170%'],
              ['5°', '531,30', '225%'],
              ['6°', '570,20', '285%'],
            ],
          },
          testo(
            'Prezzo di partenza: 0,10 € per ogni giocatore. Rilancio minimo: 0,10 € fino a 20 €, 0,20 € fino a 50 €, 0,50 € fino a 100 €, 1 € oltre i 100 €.',
          ),
        ],
      },
      {
        titolo: 'Giocatori di proprietà',
        paragrafi: [
          lista([
            'A fine asta ogni squadra deve avere almeno 22 giocatori.',
            'Dalla fine del campionato all’asta estiva è temporaneamente ammesso scendere sotto i 22 a titolo definitivo (resta valido il tetto di 28 in rosa).',
          ]),
        ],
      },
      {
        titolo: 'Rinnovo giocatori',
        paragrafi: [
          testo(
            'Finestra di rinnovo: dal giorno di uscita delle quotazioni Fantacalcio.it a una data comunicata di volta in volta. Il rinnovo resta valido anche se il giocatore viene poi ceduto a un’altra squadra, e se torna nella squadra che lo possedeva già il conteggio riparte dal primo rinnovo.',
          ),
          testo('La percentuale cresce a ogni rinnovo successivo, fino a stabilizzarsi dal nono in poi:'),
          {
            tipo: 'tabella',
            intestazioni: ['1°', '2°', '3°', '4°', '5°', '6°', '7°', '8°', '9°+'],
            righe: [['60%', '85%', '115%', '155%', '215%', '290%', '400%', '550%', '760%']],
          },
          testo(
            'Superato il 100%, la cifra spesa per il rinnovo diventa il nuovo valore del giocatore, agganciato alla quotazione Fantacalcio.it del momento.',
          ),
          esempio(
            'Terzo rinnovo di un giocatore che vale 10 € su quotazione 10 fanta-milioni: spendo 10 € × 115% = 11,50 €, nuovo valore 11,50 € (quotazione sempre 10). L’anno dopo, a quotazione invariata, il quarto rinnovo costa 11,50 € × 155% = 17,83 €.',
          ),
          lista([
            'Un giocatore scambiato durante la sessione estiva va rinnovato obbligatoriamente — a scelta delle parti, dall’ex o dal nuovo proprietario.',
            'Il costo del rinnovo si arrotonda sempre a un multiplo di 0,10 € (minimo 0,10 €).',
            'Rescissione volontaria durante la stagione: 1,50 € fisso, indipendentemente dal prezzo di acquisto.',
          ]),
        ],
      },
      {
        titolo: 'Valori giocatori',
        paragrafi: [
          testo(
            'Il valore parte dal prezzo di acquisto e segue la variazione percentuale della quotazione Fantacalcio.it. La rivalutazione scatta il giorno dopo l’ultima partita di giornata (valori aggiornati visibili con un paio di giorni di ritardo, o dopo la relativa comunicazione).',
          ),
        ],
      },
      {
        titolo: 'Rimborsi e indennizzi',
        paragrafi: [
          testo(
            'Se un giocatore rinnovato a inizio anno, acquistato in asta, o preso da svincolato entro il 15 novembre lascia la Serie A, il presidente recupera parte dei soldi spesi:',
          ),
          {
            tipo: 'tabella',
            intestazioni: ['Periodo', 'Rimborso', 'Indennizzo'],
            righe: [
              ['2 agosto – 30 settembre', '100%', '20%'],
              ['1 ottobre – 15 novembre', '75%', '20%'],
              ['16 novembre – 31 gennaio', '50%', '20%'],
              ['1 – 28 febbraio', '25%', '20%'],
              ['1 marzo – fine stagione', '0%', '20%'],
            ],
          },
          lista([
            'Indennizzo (20% del valore, sempre): a differenza del rimborso non è liquidità immediata, ma un credito spendibile solo alla prima asta successiva. Chi rinnova un giocatore ormai fuori Serie A perde il diritto all’indennizzo per quell’anno.',
            'Giocatore preso da svincolato DOPO il 15 novembre e poi uscito dalla Serie A a gennaio: rimborso 75% (deroga alla tabella sopra). Oltre il 28 febbraio: nessun rimborso.',
          ]),
          esempio(
            'Rinnovo un giocatore a inizio agosto spendendo X, poi lo cedo a un altro presidente per Y. Se in seguito il giocatore reale lascia la Serie A, la cifra restituita è X (non Y) — e va al nuovo proprietario, che nel frattempo l’ha acquisito.',
          ),
        ],
      },
      {
        titolo: 'Asta intermedia',
        paragrafi: [
          testo(
            'Un giocatore tesserato in Serie A durante una sessione di mercato non è acquistabile come svincolato prima della successiva asta collettiva.',
          ),
        ],
      },
      {
        titolo: 'Mercato Libero (in fase di conferma)',
        paragrafi: [
          lista([
            'Martedì 12:00–22:00: chiunque può aprire l’asta su uno svincolato scrivendo "Asta per -nome giocatore-".',
            'Fino a mercoledì 12:00: ci si prenota rispondendo "Partecipo".',
            'Dopo le 12:00 di mercoledì: i partecipanti si accordano su un orario tra le 12:00 e le 24:00 per l’asta rapida.',
            'Se passa più di un minuto dall’ultimo rilancio (orari WhatsApp come riferimento oggettivo), il giocatore è aggiudicato a chi ha rilanciato per ultimo.',
          ]),
          testo(
            'Vale il buon senso: ostruzionismo nel trovare un orario comune comporta l’esclusione dall’asta per quel giocatore. Turni infrasettimanali o soste più lunghe: tempi e modalità comunicati di volta in volta.',
          ),
        ],
      },
    ],
  },
  {
    numero: '3',
    titolo: 'Gruppo ufficiale WhatsApp',
    icona: 'forum',
    sottosezioni: [
      {
        paragrafi: [
          testo(
            'Il gruppo gestisce le aste degli svincolati, l’ufficializzazione delle trattative, le comunicazioni ufficiali e le votazioni.',
          ),
        ],
      },
      {
        titolo: 'Espulsioni settimanali',
        paragrafi: [
          testo('Comportano un’espulsione di una settimana:'),
          lista([
            'Rilancio senza uno spazio libero in rosa.',
            'Avere, nello stesso momento, il rilancio più alto su più giocatori di quanti siano gli spazi liberi.',
            'Rilancio su un giocatore non svincolato.',
          ]),
          testo(
            'In tutti e tre i casi l’espulsione non scatta se chi sbaglia elimina il messaggio prima che qualcuno rilanci sulla stessa offerta. Ogni altro errore non comporta espulsione.',
          ),
        ],
      },
    ],
  },
  {
    numero: '4',
    titolo: 'Scambi e Trattative',
    icona: 'swap_horiz',
    sottosezioni: [
      {
        titolo: 'Finestre di mercato',
        paragrafi: [
          testo('Scambi e trattative sono possibili solo nelle finestre indicate di volta in volta dagli admin.'),
        ],
      },
      {
        titolo: 'Regole generali',
        paragrafi: [
          testo(
            'Ammesse cessioni a titolo definitivo, prestiti e scambi anche con numero diverso di giocatori tra le due squadre, rispettando questi vincoli:',
          ),
          lista([
            'Vietato vendere/scambiare un giocatore e ricomprarlo/riscambiarlo con la stessa squadra nella stessa finestra.',
            'Vietato ufficializzare più di una trattativa con la stessa squadra nella stessa finestra.',
            'Vietato scambiare giocatori non in Serie A al momento dell’ufficializzazione.',
            'Le cessioni a titolo definitivo non ammettono condizioni — solo bonus e sconti.',
          ]),
          testo(
            'Ogni trattativa (prestiti e cessioni comprese) è pubblica e verbalizzata dagli admin. I conguagli si depositano agli admin — niente pagamenti diretti tra presidenti — entro una settimana dalla fine della finestra in cui la trattativa è stata ufficializzata. Ogni scenario va messo per iscritto prima dello scambio: in caso di dubbio decide il contabile, attenendosi solo al contratto scritto.',
          ),
          testo('Una trattativa porta valore in quattro forme, combinabili tra loro:'),
          lista(['Giocatori a titolo definitivo', 'Giocatori in prestito', 'Conguagli economici', 'Bonus']),
        ],
      },
      {
        titolo: 'Tipologie di trattativa',
        paragrafi: [
          testo(
            'Scambi, cessioni e prestiti modificano il valore dei giocatori coinvolti; i prestiti lo cambiano in modo inversamente proporzionale alla loro durata rispetto alla stagione (formule esatte nell’appendice tecnica del regolamento):',
          ),
          lista([
            'Cessione a titolo definitivo — il valore diventa il prezzo di acquisto, solo se superiore a quello già in essere.',
            'Scambio secco (2 giocatori) — entrambi si allineano al valore più alto tra i due.',
            'Scambio secco (3+ giocatori) — stessa logica, aumento ridistribuito in proporzione al valore di ciascuno.',
            'Scambio con conguaglio — il conguaglio si somma al valore per stabilire chi "costa meno" prima di applicare i cambiamenti.',
            'Prestito oneroso — come la cessione definitiva, se la cifra pagata supera il valore del giocatore.',
            'Scambio di prestiti (con o senza conguaglio) — stessa logica degli scambi normali.',
          ]),
          testo('Un prestito si interrompe automaticamente se il giocatore lascia la Serie A: torna alla squadra proprietaria.'),
        ],
      },
      {
        titolo: 'Bonus',
        paragrafi: [
          lista([
            'Bonus di squadra — legati a vittoria in campionato o coppa.',
            'Bonus sui giocatori — legati a gol, assist, presenze, presenze da titolare, voto o fantavoto sopra soglia.',
          ]),
          testo(
            'Vietati i bonus estranei alle squadre/giocatori coinvolti. Un giocatore può al massimo raddoppiare il proprio valore tramite bonus (calcolato sul valore post-trattativa, senza bonus); i bonus oltre quel limite si convertono in conguaglio.',
          ),
        ],
      },
      {
        titolo: 'Clausole',
        paragrafi: [
          testo('Tre tipi: AGGIUNTA, ANNULLAMENTO, MODIFICA (combinazione delle prime due). Si attivano per:'),
          lista([
            'Eventi VOLONTARI — decisione di una delle parti, solo nelle finestre di mercato.',
            'Eventi CASUALI — compravendita nel mercato reale, soglie di gol/assist/presenze/voto/fantavoto, infortuni, vittoria di coppa/campionato; attivabili in qualunque finestra del martedì.',
          ]),
          testo('Gli eventi si combinano con "e" oppure "o". Una clausola di AGGIUNTA può inserire bonus, altre clausole o conguagli, "rigenerando" la trattativa (valori attuali se volontaria, iniziali se casuale). Una clausola di ANNULLAMENTO può annullare:'),
          lista([
            'Prestiti.',
            'Titoli definitivi — solo entro la fine della sessione di mercato, e solo se attivata da compravendita reale o infortunio oltre soglia.',
            'Bonus — solo da evento casuale.',
            'Altre clausole — solo quelle non ancora attivate.',
          ]),
        ],
      },
      {
        titolo: 'Penali',
        paragrafi: [
          testo(
            'Le penali sono gli scambi di denaro generati da una clausola. Se annullano la trattativa, i valori dei giocatori non cambiano; altrimenti si sommano al conguaglio e modificano i valori di conseguenza.',
          ),
        ],
      },
      {
        titolo: 'Annullamento prestito volontario',
        paragrafi: [
          testo(
            'Un annullamento volontario (solo nelle finestre di mercato) rigenera la trattativa: la durata del prestito originale si modifica e si aggiunge un prestito di ritorno dello stesso giocatore per la durata residua — il giocatore risulta quindi su entrambi i lati. Eventuali penali si sommano al conguaglio.',
          ),
          testo(
            'Il giocatore così aggiunto mantiene valore e quotazione INIZIALI — la scelta più conservativa: anche se l’annullamento è volontario, la penale resta quella fissata alla creazione della trattativa.',
          ),
        ],
      },
      {
        titolo: 'Annullamento trattative',
        paragrafi: [
          lista([
            'Annullabile (in tutto o in parte) durante le finestre di mercato, con l’accordo di entrambe le squadre, e solo se non sono state giocate giornate di Serie A tra ufficializzazione e annullamento.',
            'Si possono aggiungere giocatori, clausole e bonus a una trattativa già ufficializzata, ma solo nella stessa sessione di mercato.',
            'Non annullabile né modificabile se uno dei giocatori coinvolti è stato nel frattempo scambiato o venduto a una terza squadra.',
          ]),
        ],
      },
    ],
  },
  {
    numero: '5',
    titolo: 'Coppa',
    icona: 'military_tech',
    sottosezioni: [
      {
        titolo: 'Fase a gironi',
        paragrafi: [
          testo(
            'Due gironi da cinque squadre, calendario indicato dagli admin (può variare stagione per stagione). Dai gironi passano le prime quattro: 1ª e 2ª nell’upper bracket, 3ª e 4ª nel lower bracket.',
          ),
        ],
      },
      {
        titolo: 'Fase finale (Main event)',
        paragrafi: [
          testo(
            'Scontri diretti in entrambi i bracket: i vincenti avanzano, i perdenti dell’upper bracket scendono nel lower bracket a incontrare i vincenti del turno precedente, i perdenti del lower bracket sono eliminati.',
          ),
        ],
      },
      {
        titolo: 'Seconda Coppa',
        paragrafi: [
          testo(
            'Gli ultimi 8 classificati della Coppa principale disputano una Seconda Coppa a eliminazione diretta. Accoppiamenti secondo il piazzamento precedente (3° vs 10°, 4° vs 9°, ecc.); a parità si guardano i punti nel girone (9°/10° posto) o i fantapunti (chi ha giocato il Main Event).',
          ),
        ],
      },
    ],
  },
  {
    numero: '6',
    titolo: 'Montepremi',
    icona: 'payments',
    sottosezioni: [
      {
        paragrafi: [
          testo(
            'Ripartizione con lega da dieci squadre (per il valore in € aggiornato durante la stagione, vedi la voce di menu "Montepremi"):',
          ),
          {
            tipo: 'tabella',
            intestazioni: ['Campionato', '%'],
            righe: [
              ['1°', '27,4%'],
              ['2°', '18,1%'],
              ['3°', '12,2%'],
              ['4°', '8,3%'],
              ['5°', '5,7%'],
              ['6°', '3,9%'],
              ['7°', '2,6%'],
              ['8°', '1,7%'],
            ],
          },
          {
            tipo: 'tabella',
            intestazioni: ['Coppa e Seconda Coppa', '%'],
            righe: [
              ['1° coppa', '10,3%'],
              ['2° coppa', '4,6%'],
              ['3° coppa', '1,9%'],
              ['4° coppa', '0,7%'],
              ['1° seconda coppa', '2,6%'],
            ],
          },
        ],
      },
      {
        titolo: 'Aiuti di stato',
        paragrafi: [
          testo(
            'Dalla seconda stagione, le ultime squadre in classifica si giocano 6 bonus (spendibili solo all’asta di settembre) tramite estrazione tra le ultime 7 — le prime tre sono escluse: i loro montepremi permettono già di andare in positivo spendendo la media delle spese di lega.',
          ),
          {
            tipo: 'tabella',
            intestazioni: ['Posizione', 'Probabilità', 'Bonus (% montepremi precedente)'],
            righe: [
              ['10°', '45,50%', '1,85%'],
              ['9°', '44,20%', '1,15%'],
              ['8°', '5,50%', '0,72%'],
              ['7°', '3,00%', '0,45%'],
              ['6°', '1,30%', '0,27%'],
              ['5°', '0,50%', '0,15%'],
              ['4°', '0,10%', '0%'],
            ],
          },
          testo(
            'Ogni squadra vince al massimo un bonus: dopo ogni estrazione le probabilità delle squadre rimaste vengono riproporzionate (calcoli nell’appendice tecnica del regolamento).',
          ),
        ],
      },
    ],
  },
  {
    numero: '7',
    titolo: 'Correttezza della Competizione',
    icona: 'verified',
    sottosezioni: [
      {
        paragrafi: [
          lista([
            'Formazione non inserita in tempo: tollerata una volta a testa fino alla 28ª giornata. Dalla seconda volta (o comunque dalla 28ª in poi): ammenda fissa di 5 €. Termine ultimo: 5 minuti prima del calcio d’inizio della prima partita di giornata.',
            'Vietati scambi di denaro tra fantallenatori al di fuori dei contratti depositati in lega.',
            'Una giornata si ufficializza solo con almeno 9 partite su 10 giocate. Alla decima si assegna il 6 politico solo se, tra questa e la nona, è stato giocato un intero turno di Serie A.',
            'Riserva d’ufficio: se un titolare non gioca e in rosa non c’è un sostituto valido da schierare al suo posto, gli viene assegnato un voto convenzionale di 3.',
            'Conferma di partecipazione alla stagione successiva: entro due settimane dalla fine del campionato in corso. Chi lascia la lega dopo aver confermato perde la possibilità di fare trattative, ed eventuali trattative già fatte vengono annullate.',
            'Obbligo di versare almeno il 50% dei soldi spesi entro l’asta di riparazione: chi non rispetta l’obbligo non guadagna punti in classifica finché non salda.',
            'Conguagli: da versare alla lega entro una settimana dalla fine della finestra di mercato in cui la trattativa è stata ufficializzata, salvo diversa indicazione esplicita nel testo della trattativa.',
          ]),
        ],
      },
    ],
  },
];

/**
 * Pagina pubblica (nessun login richiesto) col regolamento ufficiale della
 * lega, riorganizzato per capitolo come il documento originale — esclusa
 * l'appendice con le formule di calcolo dei valori (troppo tecnica per una
 * pagina di consultazione rapida). Contenuto riscritto e schematizzato per
 * chiarezza, non copiato paragrafo per paragrafo: il significato delle
 * regole non cambia. Scaglioni fairplay finanziario e percentuali di
 * rinnovo allineati ai valori realmente in uso nell'app (non a quelli,
 * più vecchi, del documento originale).
 */
@Component({
  selector: 'app-regolamento-page',
  imports: [MatIconModule, NavMenu, HeaderAuthStatus],
  styleUrls: ['../../core/nav/page-shell.scss'],
  template: `
    <div class="page">
      <header class="page-header">
        <app-nav-menu />
        <mat-icon class="header-logo" aria-hidden="true">sports_soccer</mat-icon>
        <h1 class="app-title">Regolamento</h1>
        <span class="spacer"></span>
        <app-header-auth-status />
      </header>

      <main class="content">
        @for (cap of capitoli; track cap.numero) {
          <section class="group">
            <button
              type="button"
              class="cap-head"
              [attr.aria-expanded]="apertoChe(cap.numero)"
              (click)="toggleCapitolo(cap.numero)"
            >
              <h2><mat-icon>{{ cap.icona }}</mat-icon> {{ cap.numero }}. {{ cap.titolo }}</h2>
              <mat-icon class="chevron">{{ apertoChe(cap.numero) ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            @if (apertoChe(cap.numero)) {
              <div class="cap-body">
                @for (sotto of cap.sottosezioni; track $index) {
                  @if (sotto.titolo) {
                    <h3>{{ sotto.titolo }}</h3>
                  }
                  @for (p of sotto.paragrafi; track $index) {
                    @switch (p.tipo) {
                      @case ('testo') {
                        <p>{{ p.testo }}</p>
                      }
                      @case ('lista') {
                        <ul>
                          @for (voce of p.voci; track voce) {
                            <li>{{ voce }}</li>
                          }
                        </ul>
                      }
                      @case ('esempio') {
                        <p class="esempio"><strong>Esempio.</strong> {{ p.testo }}</p>
                      }
                      @case ('tabella') {
                        <div class="tabella-scroll">
                          <table>
                            <thead>
                              <tr>
                                @for (h of p.intestazioni; track h) {
                                  <th>{{ h }}</th>
                                }
                              </tr>
                            </thead>
                            <tbody>
                              @for (riga of p.righe; track $index) {
                                <tr>
                                  @for (cella of riga; track $index) {
                                    <td>{{ cella }}</td>
                                  }
                                </tr>
                              }
                            </tbody>
                          </table>
                        </div>
                      }
                    }
                  }
                }
              </div>
            }
          </section>
        }
        <div class="disclaimer">
          <mat-icon>info</mat-icon>
          <p>
            Questo regolamento può contenere imprecisioni o non coprire ogni
            caso possibile: non è un pretesto per comportamenti contrari al
            rispetto reciproco e alle tradizioni di questa lega. In caso di
            dubbio, chiedi sempre al tuo admin di fiducia.
          </p>
        </div>
      </main>
    </div>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .disclaimer {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }

    .disclaimer mat-icon {
      flex-shrink: 0;
      margin-top: 1px;
    }

    .disclaimer p {
      margin: 0;
      color: inherit;
      font-size: 0.85rem;
      line-height: 1.5;
    }

    .group {
      background: var(--mat-sys-surface-container-low, #fff);
      border: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
      border-radius: 16px;
      box-shadow: var(--mat-sys-level1, 0 1px 3px rgba(0, 0, 0, 0.3));
      overflow: hidden;
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
      padding: 14px 16px 16px;
      border-top: 1px dashed var(--mat-sys-outline-variant);
    }

    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 1.05rem;
    }

    h2 mat-icon {
      color: var(--mat-sys-primary);
    }

    h3 {
      margin: 18px 0 6px;
      font-size: 0.92rem;
      color: var(--mat-sys-primary);
    }

    h3:first-of-type {
      margin-top: 0;
    }

    p {
      margin: 0 0 10px;
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--mat-sys-on-surface-variant);
    }

    ul {
      margin: 0 0 10px;
      padding-left: 20px;
    }

    ul li {
      font-size: 0.875rem;
      line-height: 1.6;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }

    .esempio {
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-high);
      font-style: italic;
    }

    .esempio strong {
      font-style: normal;
      color: var(--mat-sys-on-surface);
    }

    .tabella-scroll {
      overflow-x: auto;
      margin: 4px 0 12px;
    }

    table {
      width: 100%;
      min-width: 320px;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    th,
    td {
      padding: 6px 10px;
      text-align: right;
      border-bottom: 1px dashed var(--mat-sys-outline-variant);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    th:first-child,
    td:first-child {
      text-align: left;
      font-variant-numeric: normal;
    }

    th {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 500;
    }
  `,
})
export class RegolamentoPage {
  readonly leagueName = environment.leagueName;
  readonly capitoli = CAPITOLI;

  /** Capitoli aperti (stato solo UI, tutti chiusi all'apertura della pagina) */
  private readonly aperti = signal<ReadonlySet<string>>(new Set());

  apertoChe(numero: string): boolean {
    return this.aperti().has(numero);
  }

  toggleCapitolo(numero: string): void {
    const next = new Set(this.aperti());
    if (!next.delete(numero)) {
      next.add(numero);
    }
    this.aperti.set(next);
  }
}
