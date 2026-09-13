import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificheInAppBanner } from './core/notifiche-in-app-banner';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NotificheInAppBanner],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}