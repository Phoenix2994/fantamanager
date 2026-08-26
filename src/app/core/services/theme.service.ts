import { Injectable, effect, signal } from '@angular/core';

export type Tema = 'scuro' | 'chiaro';

const STORAGE_KEY = 'fantamanager.tema';
const LIGHT_CLASS = 'light-theme';

/**
 * Tema chiaro/scuro dell'app. Di default è scuro (vedi styles.scss, che
 * definisce il tema Material sia su `html` — scuro — sia su
 * `html.light-theme` — chiaro): qui si tiene solo la preferenza
 * dell'utente, persistita in localStorage, e si applica la classe che fa
 * scattare la seconda definizione di tema.
 *
 * Uno script inline in index.html applica già la classe corretta PRIMA che
 * Angular si avvii, per evitare un lampo del tema scuro di default a chi ha
 * scelto quello chiaro.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly tema = signal<Tema>(this.leggiSalvato());

  constructor() {
    effect(() => this.applica(this.tema()));
  }

  toggle(): void {
    this.tema.set(this.tema() === 'scuro' ? 'chiaro' : 'scuro');
  }

  private leggiSalvato(): Tema {
    try {
      return document.documentElement.classList.contains(LIGHT_CLASS) ? 'chiaro' : 'scuro';
    } catch {
      return 'scuro';
    }
  }

  private applica(tema: Tema): void {
    try {
      document.documentElement.classList.toggle(LIGHT_CLASS, tema === 'chiaro');
      localStorage.setItem(STORAGE_KEY, tema);
    } catch {
      // localStorage/DOM non disponibili (es. SSR): il tema resta quello di default
    }
  }
}
