import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/sale-method/sale-method.component').then(
        (m) => m.SaleMethodComponent,
      ),
  },
  {
    path: 'jar',
    loadComponent: () =>
      import('./pages/sale-create/sale-create.component').then(
        (m) => m.SaleCreateComponent,
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
