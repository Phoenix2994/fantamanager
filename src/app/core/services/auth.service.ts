import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Auth,
  User,
  authState,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Autenticazione con password condivisa della lega.
 *
 * Implementazione: un singolo account Firebase Authentication (email fissa in
 * environment.adminEmail) è condiviso tra gli admin. La UI chiede solo la
 * password; le security rules di Firestore autorizzano qualsiasi utente
 * autenticato (l'unico account esistente è quello admin).
 *
 * Vantaggi: le regole lato server sono realmente enforce (a differenza di un
 * check client-side) e non servono Cloud Functions per il login.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  /** Necessario per chiamare le API Firebase fuori dal contesto di injection */
  private readonly injector = inject(Injector);

  /** Stato di autenticazione realtime (null = non autenticato) */
  readonly user$: Observable<User | null> = authState(this.auth);

  /** true se c'è una sessione attiva (admin O anonimo) */
  readonly isAuthenticated$: Observable<boolean> = this.user$.pipe(
    map((user) => user !== null),
  );

  /**
   * true solo per l'admin autenticato con email/password.
   * Gli utenti anonimi (partecipanti all'asta) NON sono admin.
   */
  readonly isAdmin$: Observable<boolean> = this.user$.pipe(
    map((user) => !!user && !user.isAnonymous),
  );

  /**
   * Login con la password condivisa della lega.
   * Lancia un errore (auth/invalid-credential ecc.) se la password è errata.
   */
  async login(password: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      signInWithEmailAndPassword(this.auth, environment.adminEmail, password),
    );
  }

  /**
   * Login anonimo per i partecipanti all'asta live.
   * L'identità della squadra è scelta nella UI e salvata in localStorage:
   * sufficiente per un gruppo di amici fidati (l'asta non è a prova di furto).
   */
  async loginAnonymous(): Promise<void> {
    await runInInjectionContext(this.injector, () => signInAnonymously(this.auth));
  }

  /** Logout: termina la sessione */
  async logout(): Promise<void> {
    await signOut(this.auth);
  }
}
