import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  CARD_ORDERS_FEATURE,
  cardOrdersCollection,
  cardOrdersEffects,
} from './store/card-orders.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(CARD_ORDERS_FEATURE, cardOrdersCollection.reducer),
      provideEffects(cardOrdersEffects),
    ],
    loadComponent: () =>
      import('./pages/card-order-list/card-order-list.component').then(
        (m) => m.CardOrderListComponent,
      ),
  },
];
