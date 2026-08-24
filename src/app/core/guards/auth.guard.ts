import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * Dalla pagina di login: se già autenticati come ADMIN → redirect a /dashboard.
 * Gli utenti anonimi (partecipanti all'asta) NON vengono reindirizzati:
 * devono poter vedere il form per effettuare il login admin.
 */
export const loginGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAdmin$.pipe(
    map((isAdmin) => (isAdmin ? router.createUrlTree(['/dashboard']) : true)),
  );
};
