import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * Dalla pagina di login: se già autenticati come admin → redirect a /dashboard.
 * La dashboard è invece pubblicamente accessibile in sola lettura:
 * il login serve solo a chi vuole operare come admin.
 */
export const loginGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAuthenticated$.pipe(
    map((isAuthenticated) =>
      isAuthenticated ? router.createUrlTree(['/dashboard']) : true,
    ),
  );
};