import { Routes } from '@angular/router';
import { adminGuard, guestGuard } from './core/guards/admin.guard';

/**
 * Every screen is lazy and behind `adminGuard`.
 *
 * The guard is on the parent rather than repeated per child, so a route added
 * later cannot be published by forgetting it — the same reason the backend
 * denies by default.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', loadChildren: () => import('./overview/routes').then((m) => m.routes) },
      { path: 'users', loadChildren: () => import('./users/routes').then((m) => m.routes) },
      {
        path: 'sales',
        loadChildren: () => import('./sales/routes').then((m) => m.routes),
      },
      { path: 'deposits', loadChildren: () => import('./deposits/routes').then((m) => m.routes) },
      {
        path: 'documents',
        loadChildren: () => import('./documents/routes').then((m) => m.routes),
      },
      {
        path: 'fiat-deposit-watches',
        loadChildren: () => import('./fiat-deposit-watches/routes').then((m) => m.routes),
      },
      // The two screens these replaced. Kept as redirects rather than deleted:
      // an operator's bookmark and a link pasted into a support thread both
      // outlive a refactor, and a dead one lands on the Mini App by way of the
      // catch-all — which reads as the panel being broken.
      { path: 'fiat-deposits', redirectTo: 'deposits', pathMatch: 'full' },
      { path: 'card-orders', redirectTo: 'sales', pathMatch: 'full' },
      { path: 'referrals', loadChildren: () => import('./referrals/routes').then((m) => m.routes) },
      { path: 'terminals', loadChildren: () => import('./terminals/routes').then((m) => m.routes) },
      { path: 'orders', loadChildren: () => import('./orders/routes').then((m) => m.routes) },
      { path: 'traders', loadChildren: () => import('./traders/routes').then((m) => m.routes) },
      { path: 'alerts', loadChildren: () => import('./alerts/routes').then((m) => m.routes) },
      { path: 'safe-box', loadChildren: () => import('./safe-box/routes').then((m) => m.routes) },
      { path: 'support', loadChildren: () => import('./support/routes').then((m) => m.routes) },
      { path: 'audit', loadChildren: () => import('./audit/routes').then((m) => m.routes) },
    ],
  },
  { path: '**', redirectTo: '' },
];
