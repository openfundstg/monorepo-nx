import { Routes } from '@angular/router'
import { UNAVAILABLE_PATH, anonymousGuard, tmaGuard } from './auth/guards/tma.guard'

/**
 * `nav: true` marks the three top-level destinations the bottom nav links to.
 *
 * The nav itself is rendered once by `AppComponent`, not by each page: it used
 * to sit inside every page template, which meant navigating destroyed it and
 * built a new one — the flicker on every tap. Hosting it in the shell keeps a
 * single instance alive across routes, and this flag is how the shell knows
 * whether the current screen is one of its destinations or a sub-flow like
 * deposit or sale, which have their own back button.
 */
export const routes: Routes = [
  /**
   * The only route reachable without a verified Telegram launch.
   *
   * It carries `anonymousGuard`, so a real user who lands here — a stale link,
   * a back gesture — is sent back into the app rather than being told to open
   * something they already have open.
   */
  {
    path: UNAVAILABLE_PATH,
    canActivate: [anonymousGuard],
    loadComponent: () =>
      import('./auth/pages/unavailable/unavailable.component').then((m) => m.UnavailableComponent)
  },
  {
    path: '',
    /**
     * Everything below is behind `tmaGuard`, on this parent rather than on each
     * child — a screen added later cannot be published by somebody forgetting
     * the guard, which is the same reason the backend denies by default.
     */
    canActivate: [tmaGuard],
    children: [
      {
        path: '',
        data: { nav: true },
        loadChildren: () => import('./dashboard/routes').then((m) => m.routes)
      },
      {
        path: 'trust-level',
        loadChildren: () => import('./dashboard/routes').then((m) => m.trustLevelRoutes)
      },
      { path: 'deposit', loadChildren: () => import('./deposit/routes').then((m) => m.routes) },
      /**
       * A sub-flow rather than a fourth nav destination: it is something a user
       * goes and looks at, not somewhere they work from, and the nav has room
       * for three.
       */
      {
        path: 'income',
        loadChildren: () => import('./analytics/routes').then((m) => m.routes)
      },
      {
        path: 'sale',
        loadChildren: () => import('./sale/routes').then((m) => m.routes)
      },
      {
        path: 'referral',
        data: { nav: true },
        loadChildren: () => import('./referral/routes').then((m) => m.routes)
      },
      {
        path: 'settings',
        data: { nav: true },
        loadChildren: () => import('./settings/routes').then((m) => m.routes)
      }
    ]
  },
  { path: '**', redirectTo: '' }
]
