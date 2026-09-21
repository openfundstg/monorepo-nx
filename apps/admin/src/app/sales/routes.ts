import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { SALES_FEATURE, salesCollection, salesEffects } from './store/sales.collection';

/**
 * The list and one sale's page, under one slice.
 *
 * The slice is provided by the parent route so it survives a trip into a sale
 * and back — which is the navigation an operator makes most, and re-fetching
 * the whole list on every return would be the panel's slowest habit.
 */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(SALES_FEATURE, salesCollection.reducer),
      provideEffects(salesEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/sale-list/sale-list.component').then((m) => m.SaleListComponent),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./pages/sale-detail/sale-detail.component').then((m) => m.SaleDetailComponent),
      },
    ],
  },
];
