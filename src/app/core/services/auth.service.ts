import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Auth,
  User,
  authState,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Team } from '../models';
import { slugify } from '../text-utils';
import { TeamService } from './team.service';

/**
 * Email dell'account Firebase di una squadra, derivata dal nome con la
 * STESSA regola usata dallo script di provisioning
 * (scripts/provision_team_accounts.py) — così il client non deve
 * memorizzare né leggere da Firestore nessuna mappa squadra→email.
 */
export function teamLoginEmail(teamName: string): string {
  return `squadra-${slugify(teamName)}@fantamanager.app`;
}

/**
 * Autenticazione della lega, tre livelli:
 *
 * 1. Admin: un singolo account Firebase (email fissa in
 *    environment.adminEmail) condiviso tra gli admin. La UI chiede solo la
 *    password.
 * 2. Squadra: un account Firebase per squadra (email/password), collegato a
 *    teams/{id} tramite il campo ownerUid — scritto SOLO dallo script di
 *    provisioning (Admin SDK), mai dal client. Le security rules verificano
 *    "questo utente è davvero questa squadra" leggendo quel campo
 *    (isTeamOwner in firestore.rules): a differenza della scelta squadra
 *    dell'asta (punto 3), qui è enforcement vero, non solo client-side.
 * 3. Anonimo (asta live): login anonimo + scelta squadra lato client, invariato
 *    — resta così apposta, i non autenticati continuano a rilanciare come oggi.
 *
 * In tutti i casi le regole lato server sono realmente enforce (a differenza
 * di un check client-side) e non servono Cloud Functions per il login.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly teamService = inject(TeamService);
  /** Necessario per chiamare le API Firebase fuori dal contesto di injection */
  private readonly injector = inject(Injector);

  /** Stato di autenticazione realtime (null = non autenticato) */
  readonly user$: Observable<User | null> = authState(this.auth);

  /** true se c'è una sessione attiva (admin, squadra O anonimo) */
  readonly isAuthenticated$: Observable<boolean> = this.user$.pipe(
    map((user) => user !== null),
  );

  /**
   * true per l'admin autenticato con l'account condiviso della lega, O per
   * un account squadra il cui uid è in environment.legaAdminUids (permessi
   * admin estesi, oltre a quelli sulla propria squadra — stesso identico
   * controllo lato server in isAdmin() di firestore.rules, i due vanno
   * tenuti in sync a mano). Gli utenti anonimi (partecipanti all'asta) non
   * sono mai admin, anche se "autenticati" nel senso di isAuthenticated$.
   */
  readonly isAdmin$: Observable<boolean> = this.user$.pipe(
    map(
      (user) =>
        !!user &&
        !user.isAnonymous &&
        (user.email === environment.adminEmail || environment.legaAdminUids.includes(user.uid)),
    ),
  );

  /**
   * La squadra di cui l'utente corrente è proprietario (account punto 2),
   * o null se non è loggato come nessuna squadra (admin, anonimo o
   * nessuna sessione). Incrocia lo uid con il campo ownerUid delle squadre.
   */
  readonly myTeam$: Observable<Team | null> = this.user$.pipe(
    switchMap((user) => {
      if (!user || user.isAnonymous || user.email === environment.adminEmail) {
        return of(null);
      }
      return this.teamService.teams$.pipe(
        map((teams) => teams.find((t) => t.ownerUid === user.uid) ?? null),
      );
    }),
  );

  /**
   * Login con la password condivisa della lega (account admin).
   * Lancia un errore (auth/invalid-credential ecc.) se la password è errata.
   */
  async login(password: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      signInWithEmailAndPassword(this.auth, environment.adminEmail, password),
    );
  }

  /**
   * Login come squadra (account punto 2 sopra): l'email è quella generata
   * dallo script di provisioning per quella squadra, la password le è stata
   * comunicata a parte.
   */
  async loginTeam(email: string, password: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      signInWithEmailAndPassword(this.auth, email, password),
    );
  }

  /**
   * Login anonimo per i partecipanti all'asta live.
   * L'identità della squadra è scelta nella UI e salvata in localStorage:
   * sufficiente per un gruppo di amici fidati (l'asta non è a prova di furto).
   * Resta invariato: chi non fa il login squadra continua a rilanciare così.
   */
  async loginAnonymous(): Promise<void> {
    await runInInjectionContext(this.injector, () => signInAnonymously(this.auth));
  }

  /** Logout: termina la sessione */
  async logout(): Promise<void> {
    await signOut(this.auth);
  }
}
