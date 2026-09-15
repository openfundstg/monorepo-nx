import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/income/income.component').then((m) => m.IncomeComponent),
  },
];
