import { Component, inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Player } from '../../core/models';
import type { ScambiAvanzatoPage } from './scambi-avanzato-page';

export interface DettagliContrattoSheetData {
  player: Player;
  page: ScambiAvanzatoPage;
}

/**
 * Drawer (bottom sheet) con contratto, riscatto e bonus di UN giocatore già
 * selezionato in una trattativa avanzata. Puro guscio di presentazione: ogni
 * campo chiama gli stessi metodi/segnali già su ScambiAvanzatoPage (passata
 * come `data.page`) — nessuna logica di calcolo duplicata qui, solo il
 * layout spostato fuori dalla lista per non affollarla (vedi
 * ScambiAvanzatoPage.apriDettagliSheet).
 */
@Component({
  selector: 'app-dettagli-contratto-sheet',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  templateUrl: './dettagli-contratto-sheet.html',
  styleUrls: ['./scambi-page.scss', './scambi-avanzato-page.scss'],
})
export class DettagliContrattoSheet {
  private readonly sheetRef = inject(MatBottomSheetRef<DettagliContrattoSheet>);
  private readonly data = inject<DettagliContrattoSheetData>(MAT_BOTTOM_SHEET_DATA);

  readonly player = this.data.player;
  readonly page = this.data.page;
  readonly playerId = this.data.player.id;

  chiudi(): void {
    this.sheetRef.dismiss();
  }
}
