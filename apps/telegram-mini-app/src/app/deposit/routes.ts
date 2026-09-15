import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/deposit-method/deposit-method.component').then(
        (m) => m.DepositMethodComponent,
      ),
  },
  {
    path: 'crypto',
    loadComponent: () =>
      import('./pages/deposit-create/deposit-create.component').then(
        (m) => m.DepositCreateComponent,
      ),
  },
  {
    path: 'fiat',
    loadComponent: () =>
      import('./pages/fiat-deposit-amounts/fiat-deposit-amounts.component').then(
        (m) => m.FiatDepositAmountsComponent,
      ),
  },
  {
    path: 'fiat/:id',
    loadComponent: () =>
      import('./pages/fiat-deposit-order/fiat-deposit-order.component').then(
        (m) => m.FiatDepositOrderComponent,
      ),
  },
  {
    path: ':id/verify',
    loadComponent: () =>
      import('./pages/deposit-verify/deposit-verify.component').then(
        (m) => m.DepositVerifyComponent,
      ),
  },
];
