import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { ORDERS_FEATURE, ordersCollection, ordersEffects } from './store/orders.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(ORDERS_FEATURE, ordersCollection.reducer),
      provideEffects(ordersEffects),
    ],
    loadComponent: () =>
      import('./pages/orders-list/orders-list.component').then((m) => m.OrdersListComponent),
  },
];
