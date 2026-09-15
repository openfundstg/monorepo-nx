import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { TRUST_FEATURE } from './store/trust.state';
import { trustReducer } from './store/trust.reducer';
import { trustEffects } from './store/trust.effects';

/**
 * The trust ladder's slice, registered by the two routes that read it rather
 * than at the root.
 *
 * Both arrays below carry it because they are mounted separately — the
 * dashboard under `''` and the levels page under its own path — and a deep link
 * straight to the levels page must not depend on the dashboard having been
 * opened first. Registering one feature twice is harmless: it is the same
 * reducer instance, and NgRx keeps the state that is already there.
 */
const trustProviders = [provideState(TRUST_FEATURE, trustReducer), provideEffects(trustEffects)];

export const routes: Routes = [
  {
    path: '',
    providers: trustProviders,
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
];

/**
 * The trust-level detail page, mounted at the app root rather than under the
 * dashboard's own empty path.
 *
 * It carries no `nav: true`, so the shell hides the bottom nav and the page
 * shows Telegram's back button instead — the same treatment as deposit and
 * sale, which it resembles far more than it does a destination.
 */
export const trustLevelRoutes: Routes = [
  {
    path: '',
    providers: trustProviders,
    loadComponent: () =>
      import('./pages/trust-level/trust-level.component').then((m) => m.TrustLevelComponent),
  },
];
