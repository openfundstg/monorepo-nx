import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/safe-box/safe-box.component').then((m) => m.SafeBoxComponent),
  },
];
