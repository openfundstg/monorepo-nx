import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { App } from './app';
import { AuthService } from './auth/services/auth.service';

/**
 * Smoke test only. `App` renders a loading screen while the session is
 * resolving and a router-outlet afterwards, so AuthService is stubbed — the
 * real one reaches for chrome.storage, which does not exist under jsdom.
 * TranslateService is provided without a loader; keys pass through untranslated,
 * which is fine because these assertions look at structure, not copy.
 */
describe('App', () => {
  const isInitializing = signal(true);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthService, useValue: { isInitializing } }
      ]
    }).compileComponents();
  });

  it('creates the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the loading screen while the session is resolving', async () => {
    isInitializing.set(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loading-screen')).toBeTruthy();
    expect(el.querySelector('router-outlet')).toBeNull();
  });

  it('swaps to the router outlet once the session resolves', async () => {
    isInitializing.set(false);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('.loading-screen')).toBeNull();
  });
});
