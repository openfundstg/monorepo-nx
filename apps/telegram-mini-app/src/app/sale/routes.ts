import { Routes } from '@angular/router';
import { saleConfigResolver } from './resolvers/sale-config.resolver';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/sale-method/sale-method.component').then(
        (m) => m.SaleMethodComponent,
      ),
  },
  // Both forms price themselves from the same call, and both are drawn only
  // once it has answered. A form painted from its own defaults states a balance
  // of 0.00 and refuses itself for half a second before the truth arrives.
  {
    path: 'jar',
    resolve: { config: saleConfigResolver },
    loadComponent: () =>
      import('./pages/sale-create/sale-create.component').then(
        (m) => m.SaleCreateComponent,
      ),
  },
  {
    path: 'card',
    resolve: { config: saleConfigResolver },
    loadComponent: () =>
      import('./pages/sale-card-create/sale-card-create.component').then(
        (m) => m.SaleCardCreateComponent,
      ),
  },
  {
    path: ':id/status',
    loadComponent: () =>
      import('./pages/sale-status/sale-status.component').then(
        (m) => m.SaleStatusComponent,
      ),
  },
];
