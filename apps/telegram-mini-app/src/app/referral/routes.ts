import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/referral/referral.component').then((m) => m.ReferralComponent),
  },
];
