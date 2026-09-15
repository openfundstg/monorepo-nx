import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  SALES_FEATURE,
  salesCollection,
  salesEffects,
} from './store/sales.collection';

export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(SALES_FEATURE, salesCollection.reducer),
      provideEffects(salesEffects),
    ],
    loadComponent: () =>
      import('./pages/sale-list/sale-list.component').then(
        (m) => m.SaleListComponent,
      ),
  },
];
