import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
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
 * Invia una notifica push a un elenco di squadre, leggendo i token salvati
 * in pushTokens/{teamId}.tokens (vedi PushNotificationService lato client).
 * Best-effort: un fallimento di invio non deve mai far fallire il trigger
 * (l'operazione principale su Firestore è già andata a buon fine).
 */
async function inviaATeam(teamIds: string[], title: string, body: string): Promise<void> {
  if (teamIds.length === 0) {
    return;
  }
  const tokenDocs = await Promise.all(teamIds.map((id) => db.doc(`pushTokens/${id}`).get()));
  const tokens = tokenDocs.flatMap((d) => (d.data()?.['tokens'] as string[] | undefined) ?? []);
  if (tokens.length === 0) {
    logger.info(`Nessun token per le squadre interessate (${teamIds.join(', ')}), niente da inviare`);
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
 * Notifica le squadre che hanno messo almeno una stellina su un giocatore
 * quando quel giocatore viene chiamato o rilanciato nell'asta
 * infrasettimanale — sia la chiamata iniziale (create, il chiamante diventa
 * subito "rilanciante") sia ogni rilancio successivo (update del leader),
 * MAI su chiusura/assegnazione (stesso doc, ma non è un nuovo rilancio).
 */
export const onRilancioInfrasettimanale = onDocumentWritten(
  'asteInfrasettimanali/{astaId}',
  async (event) => {
    const after = event.data?.after.data();
    if (!after || after['chiusa']) {
      return;
    }
    const before = event.data?.before.data();
    const nuovoLeader = !before || before['rilanciatoDaTeamId'] !== after['rilanciatoDaTeamId'];
    if (!nuovoLeader) {
      return;
    }

    const slug = slugify(after['giocatoreNome'] as string);
    const teamsSnap = await db.collection('teams').get();
    const interessate: string[] = [];
    for (const teamDoc of teamsSnap.docs) {
      if (teamDoc.id === after['rilanciatoDaTeamId']) {
        continue; // chi ha appena rilanciato non ha bisogno di essere avvisato
      }
      const nota = await db.doc(`teamNotes/${teamDoc.id}/svincolati/${slug}`).get();
      if ((nota.data()?.['stelle'] as number | undefined ?? 0) > 0) {
        interessate.push(teamDoc.id);
      }
    }
    logger.info(
      `Rilancio su ${after['giocatoreNome']} (slug ${slug}) da ${after['rilanciatoDaTeamId']}: squadre interessate ${JSON.stringify(interessate)}`,
    );

    await inviaATeam(
      interessate,
      'Asta infrasettimanale',
      `${after['giocatoreNome']}: ${after['rilanciatoDaTeamName']} a ${(after['prezzoAttuale'] as number).toFixed(2)} €`,
    );
  },
);

/**
 * Notifica le altre squadre eleggibili (quelle che avevano rilanciato nella
 * fascia "solo rilanci") quando una di loro presenta una busta — MAI
 * l'importo, le buste restano private: il testo dice solo che è arrivata.
 * Solo al PRIMO inserimento (onDocumentCreated), non ad ogni modifica
 * successiva della stessa busta.
 */
export const onBustaInserita = onDocumentCreated(
  'asteInfrasettimanali/{astaId}/buste/{teamId}',
  async (event) => {
    const { astaId, teamId } = event.params;
    const astaSnap = await db.doc(`asteInfrasettimanali/${astaId}`).get();
    const asta = astaSnap.data();
    if (!asta) {
      return;
    }
    const eleggibili = (asta['squadreEleggibiliBusta'] as string[] | undefined) ?? [];
    const daAvvisare = eleggibili.filter((id) => id !== teamId);

    await inviaATeam(
      daAvvisare,
      'Asta infrasettimanale',
      `È stata presentata una busta per ${asta['giocatoreNome']}`,
    );
  },
);
