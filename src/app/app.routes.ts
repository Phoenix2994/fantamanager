import { Routes } from '@angular/router';
import { loginGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    // Dashboard pubblicamente accessibile in sola lettura;
    // le azioni di scrittura richiedono il login admin
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    // Asta live per i partecipanti (login anonimo + scelta squadra)
    path: 'asta',
    loadComponent: () =>
      import('./features/asta/asta-page').then((m) => m.AstaPage),
  },
  {
    // Vista TV dell'asta: sola lettura pubblica
    path: 'tv',
    loadComponent: () => import('./features/asta/tv-page').then((m) => m.TvPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];