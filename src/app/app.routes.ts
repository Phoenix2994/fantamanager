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
    // Calciatori svincolati a schermo intero (voce del menù di navigazione)
    path: 'svincolati',
    loadComponent: () =>
      import('./features/svincolati/svincolati-page').then((m) => m.SvincolatiPage),
  },
  {
    // Scambi tra squadre: placeholder in attesa della definizione della sezione
    path: 'scambi',
    loadComponent: () =>
      import('./features/scambi/scambi-page').then((m) => m.ScambiPage),
  },
  {
    // Vista TV dell'asta: sola lettura pubblica
    path: 'tv',
    loadComponent: () => import('./features/asta/tv-page').then((m) => m.TvPage),
  },
  {
    // Storico operazioni a schermo intero (voce del menù, solo admin)
    path: 'storico',
    loadComponent: () =>
      import('./features/storico/storico-page').then((m) => m.StoricoPage),
  },
  {
    // Ripartizione del montepremi (voce del menù, pubblica)
    path: 'montepremi',
    loadComponent: () =>
      import('./features/montepremi/montepremi-page').then((m) => m.MontepremiPage),
  },
  {
    // Guida alle funzionalità per squadra autenticata (voce del menù, pubblica)
    path: 'supporto',
    loadComponent: () =>
      import('./features/supporto/supporto-page').then((m) => m.SupportoPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];