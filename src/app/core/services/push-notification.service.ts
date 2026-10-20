import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Messaging,
  deleteToken,
  getToken,
  isSupported,
  onMessage,
} from '@angular/fire/messaging';
import { Firestore, arrayRemove, arrayUnion, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';

/** Prefisso della chiave localStorage che segna, per squadra, l'attivazione riuscita su QUESTO dispositivo */
const STORAGE_PREFIX = 'astaInfrasettimanale.notifiche.';

/**
 * Notifiche push per l'asta infrasettimanale (SOLO questa: l'asta di
 * settembre si segue live, non ne ha bisogno — vedi memoria di progetto
 * "asta-infrasettimanale-piano"). Due eventi, inviati da Cloud Functions
 * (functions/src/index.ts) su scrittura Firestore:
 * - rilancio (o chiamata) su un giocatore con almeno una stellina;
 * - busta presentata da un'altra squadra eleggibile (mai l'importo).
 *
 * Il token FCM del dispositivo viene salvato in pushTokens/{teamId}.tokens
 * (array, una squadra può avere più dispositivi/browser). Finché
 * environment.fcmVapidKey resta vuota (richiede un passaggio manuale in
 * Console Firebase — non è automatizzabile via API), il servizio si
 * disabilita silenziosamente: nessun errore per l'utente, solo `disponibile`
 * a false, così la UI può nascondere il bottone invece di mostrarlo rotto.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly firestore = inject(Firestore);
  private readonly messaging = inject(Messaging);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);

  private registrazioneSw: ServiceWorkerRegistration | undefined;

  /** true se questo browser può ricevere notifiche push E la chiave VAPID è configurata */
  async disponibile(): Promise<boolean> {
    if (!environment.fcmVapidKey || !('serviceWorker' in navigator)) {
      return false;
    }
    try {
      return await isSupported();
    } catch {
      return false;
    }
  }

  /**
   * true se l'attivazione è già andata a buon fine su QUESTO dispositivo per
   * questa squadra (un flag esplicito, salvato dopo un `attiva()` riuscito —
   * NON basarsi solo su `Notification.permission`: può essere "granted" per
   * mille motivi indipendenti dall'aver mai davvero salvato un token, es.
   * dati del sito cancellati ma permesso del browser rimasto).
   */
  attivoSuQuestoDispositivo(teamId: string): boolean {
    try {
      return localStorage.getItem(STORAGE_PREFIX + teamId) === '1';
    } catch {
      return false;
    }
  }

  private segnaAttivo(teamId: string, attivo: boolean): void {
    try {
      if (attivo) {
        localStorage.setItem(STORAGE_PREFIX + teamId, '1');
      } else {
        localStorage.removeItem(STORAGE_PREFIX + teamId);
      }
    } catch {
      // storage non disponibile: non blocca l'operazione, solo il bottone
      // "Attiva notifiche" potrebbe ripresentarsi al prossimo giro
    }
  }

  /**
   * Chiede il permesso (se non già dato) e salva il token del dispositivo
   * per la squadra indicata. Ritorna true se l'attivazione è andata a buon
   * fine.
   */
  async attiva(teamId: string): Promise<boolean> {
    if (!(await this.disponibile())) {
      this.snackBar.open('Le notifiche push non sono supportate su questo browser', undefined, {
        duration: 4000,
      });
      return false;
    }
    try {
      const permesso = await Notification.requestPermission();
      if (permesso !== 'granted') {
        this.snackBar.open('Permesso per le notifiche negato', undefined, { duration: 3500 });
        return false;
      }

      // Registrato con path relativo (senza "/" iniziale) e scope esplicito:
      // su GitHub Pages l'app vive sotto /fantamanager/, lo scope di default
      // di un service worker è la cartella da cui viene servito, quindi va
      // fissato qui invece di lasciare il default (che con un path assoluto
      // "/firebase-messaging-sw.js" coprirebbe l'intero dominio, non solo
      // l'app — e in locale, sotto "/", funzionerebbe comunque).
      this.registrazioneSw ??= await navigator.serviceWorker.register('firebase-messaging-sw.js', {
        scope: './',
      });
      // Alla primissima registrazione il service worker è ancora "installing"
      // per un istante: PushManager.subscribe() (dentro getToken) fallisce
      // con "no active Service Worker" se chiamato troppo presto — .ready
      // risolve solo quando è davvero attivo.
      await navigator.serviceWorker.ready;

      const token = await runInInjectionContext(this.injector, () =>
        getToken(this.messaging, {
          vapidKey: environment.fcmVapidKey,
          serviceWorkerRegistration: this.registrazioneSw,
        }),
      );
      if (!token) {
        return false;
      }

      await setDoc(
        doc(this.firestore, `pushTokens/${teamId}`),
        { tokens: arrayUnion(token), updatedAt: serverTimestamp() },
        { merge: true },
      );

      // Notifiche ricevute mentre l'app è già aperta in primo piano: qui
      // niente notifica di sistema (ci pensa il service worker in
      // background), solo uno snackbar.
      runInInjectionContext(this.injector, () =>
        onMessage(this.messaging, (payload) => {
          const titolo = payload.notification?.title ?? 'Fantamanager';
          const corpo = payload.notification?.body ?? '';
          this.snackBar.open(`${titolo}: ${corpo}`, undefined, { duration: 5000 });
        }),
      );

      this.segnaAttivo(teamId, true);
      this.snackBar.open('Notifiche attivate', undefined, { duration: 2500 });
      return true;
    } catch (err) {
      this.snackBar.open(
        err instanceof Error ? err.message : 'Errore durante l’attivazione delle notifiche',
        undefined,
        { duration: 4000 },
      );
      return false;
    }
  }

  /** Rimuove il token di questo dispositivo dalla squadra (non tocca il permesso del browser) */
  async disattiva(teamId: string): Promise<void> {
    if (!this.registrazioneSw) {
      return;
    }
    try {
      const token = await runInInjectionContext(this.injector, () =>
        getToken(this.messaging, {
          vapidKey: environment.fcmVapidKey,
          serviceWorkerRegistration: this.registrazioneSw,
        }),
      );
      if (token) {
        await setDoc(
          doc(this.firestore, `pushTokens/${teamId}`),
          { tokens: arrayRemove(token) },
          { merge: true },
        );
        await runInInjectionContext(this.injector, () => deleteToken(this.messaging));
      }
    } catch {
      // best-effort: se fallisce, il token scadrà comunque lato FCM
    } finally {
      this.segnaAttivo(teamId, false);
    }
  }
}
