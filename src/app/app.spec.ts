import { TestBed } from '@angular/core/testing';
import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { environment } from '../environments/environment';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    // Il banner globale (app.html) dipende da AuthService/Firestore, quindi
    // servono i provider Firebase reali anche qui — stesso schema minimo di
    // app.config.ts, senza cache offline (non serve in questo smoke test).
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideFirebaseApp(() => initializeApp(environment.firebase)),
        provideAuth(() => getAuth()),
        provideFirestore(() => getFirestore(getApp())),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });
});
