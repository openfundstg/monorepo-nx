import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  FIAT_DEPOSITS_FEATURE,
  fiatDepositsCollection,
  fiatDepositsEffects,
} from './store/fiat-deposits.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(FIAT_DEPOSITS_FEATURE, fiatDepositsCollection.reducer),
      provideEffects(fiatDepositsEffects),
    ],
    loadComponent: () =>
      import('./pages/fiat-deposit-list/fiat-deposit-list.component').then(
        (m) => m.FiatDepositListComponent,
      ),
  },
];
