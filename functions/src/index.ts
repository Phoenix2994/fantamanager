import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

/**
 * Slug: minuscolo, accent-folding, spazi/simboli -> trattini. Duplicato da
 * src/app/core/text-utils.ts (le Cloud Functions sono un pacchetto npm
 * separato, senza un modo comodo di condividere codice col client) — se
 * cambia lì, va cambiato anche qui.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Notifica un elenco di squadre in DUE modi indipendenti:
 * 1. un evento in notifiche/{teamId}/eventi, sempre — cosicché anche chi
 *    non ha attivato le notifiche push (o è su un browser che non le
 *    supporta) veda comunque la comunicazione, come banner all'apertura
 *    dell'app (vedi NotificheInAppService lato client);
 * 2. una vera notifica push, SOLO per chi ha almeno un token salvato in
 *    pushTokens/{teamId}.tokens (vedi PushNotificationService).
 * Best-effort: un fallimento di invio non deve mai far fallire il trigger
 * (l'operazione principale su Firestore è già andata a buon fine).
 */
async function inviaATeam(teamIds: string[], title: string, body: string): Promise<void> {
  if (teamIds.length === 0) {
    return;
  }

  await Promise.all(
    teamIds.map((teamId) =>
      db.collection(`notifiche/${teamId}/eventi`).add({
        titolo: title,
        corpo: body,
        timestamp: FieldValue.serverTimestamp(),
        letta: false,
      }),
    ),
  );

  const tokenDocs = await Promise.all(teamIds.map((id) => db.doc(`pushTokens/${id}`).get()));
  const tokens = tokenDocs.flatMap((d) => (d.data()?.['tokens'] as string[] | undefined) ?? []);
  if (tokens.length === 0) {
    logger.info(`Nessun token per le squadre interessate (${teamIds.join(', ')}), solo evento in-app`);
    return;
  }
  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: '/fantamanager/asta-infrasettimanale' } },
    });
    logger.info(
      `Notifica "${title}" inviata a ${tokens.length} token: ${res.successCount} ok, ${res.failureCount} falliti`,
    );
    // Pulizia dei token non più validi (disinstallazioni, permessi revocati),
    // per squadra: un unico giro su tutti i tokenDocs coinvolti.
    const daRimuovere = new Set<string>();
    res.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
        daRimuovere.add(tokens[i]);
      }
    });
    if (daRimuovere.size > 0) {
      await Promise.all(
        tokenDocs
          .filter((d) => d.exists)
          .map(async (d) => {
            const attuali = (d.data()?.['tokens'] as string[] | undefined) ?? [];
            const rimasti = attuali.filter((t) => !daRimuovere.has(t));
            if (rimasti.length !== attuali.length) {
              await d.ref.update({ tokens: rimasti });
            }
          }),
      );
    }
  } catch (err) {
    logger.error('Errore invio notifica push', err);
  }
}

/**
 * Notifica le squadre quando un giocatore viene chiamato o rilanciato
 * nell'asta infrasettimanale — sia la chiamata iniziale (create, il
 * chiamante diventa subito "rilanciante") sia ogni rilancio successivo
 * (update del leader), MAI su chiusura/assegnazione (stesso doc, ma non è
 * un nuovo rilancio).
 *
 * Chiamata: notifica TUTTE le squadre (tranne chi ha chiamato), a
 * prescindere dalla stellina — è un nuovo giocatore appena liberato,
 * interessa saperlo a prescindere da chi lo aveva notato prima. Rilancio
 * successivo: solo le squadre che hanno messo almeno una stellina su quel
 * giocatore (altrimenti ogni rilancio spammerebbe l'intera lega).
 */
export const onRilancioInfrasettimanale = onDocumentWritten(
  'asteInfrasettimanali/{astaId}',
  async (event) => {
    const after = event.data?.after.data();
    if (!after || after['chiusa']) {
      return;
    }
    const before = event.data?.before.data();
    const eChiamata = !before;
    const nuovoLeader = eChiamata || before['rilanciatoDaTeamId'] !== after['rilanciatoDaTeamId'];
    if (!nuovoLeader) {
      return;
    }

    const teamsSnap = await db.collection('teams').get();
    let interessate: string[];

    if (eChiamata) {
      interessate = teamsSnap.docs
        .map((d) => d.id)
        .filter((id) => id !== after['rilanciatoDaTeamId']);
    } else {
      const slug = slugify(after['giocatoreNome'] as string);
      interessate = [];
      for (const teamDoc of teamsSnap.docs) {
        if (teamDoc.id === after['rilanciatoDaTeamId']) {
          continue; // chi ha appena rilanciato non ha bisogno di essere avvisato
        }
        const nota = await db.doc(`teamNotes/${teamDoc.id}/svincolati/${slug}`).get();
        if ((nota.data()?.['stelle'] as number | undefined ?? 0) > 0) {
          interessate.push(teamDoc.id);
        }
      }
    }
    logger.info(
      `${eChiamata ? 'Chiamata' : 'Rilancio'} su ${after['giocatoreNome']} da ${after['rilanciatoDaTeamId']}: squadre interessate ${JSON.stringify(interessate)}`,
    );

    const prezzo = (after['prezzoAttuale'] as number).toFixed(2);
    await inviaATeam(
      interessate,
      'Asta infrasettimanale',
      eChiamata
        ? `${after['giocatoreNome']} chiamato da ${after['rilanciatoDaTeamName']} a ${prezzo} €`
        : `${after['giocatoreNome']}: ${after['rilanciatoDaTeamName']} a ${prezzo} €`,
    );
  },
);

// NOTA: niente notifiche per le buste (né push né in-app) — scelta esplicita
// dell'utente: le buste restano un fatto privato tra la squadra e l'admin, e
// non devono generare alcun avviso quando arrivano. C'era una
// onBustaInserita che lo faceva, rimossa apposta (vedi memoria di progetto
// "asta-infrasettimanale-piano").
