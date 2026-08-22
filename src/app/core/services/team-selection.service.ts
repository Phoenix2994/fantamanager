import { Injectable, signal } from '@angular/core';

/**
 * Stato UI condiviso tra le sezioni della dashboard:
 * la squadra selezionata nel dropdown è usata da giocatori, spese e storico.
 */
@Injectable({ providedIn: 'root' })
export class TeamSelectionService {
  private readonly selectedTeamIdSignal = signal<string | null>(null);

  readonly selectedTeamId = this.selectedTeamIdSignal.asReadonly();

  select(teamId: string | null): void {
    this.selectedTeamIdSignal.set(teamId);
  }
}