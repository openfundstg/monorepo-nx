import { Routes } from '@angular/router';

/**
 * No slice and no effects: the overview is one request with one reader, held by
 * a resource in `OverviewService`. See the note there.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
  },
];
