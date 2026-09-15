import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  FIAT_DEPOSIT_WATCHES_FEATURE,
  fiatDepositWatchesCollection,
  fiatDepositWatchesEffects,
} from './store/fiat-deposit-watches.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(FIAT_DEPOSIT_WATCHES_FEATURE, fiatDepositWatchesCollection.reducer),
      provideEffects(fiatDepositWatchesEffects),
    ],
    loadComponent: () =>
      import('./pages/fiat-deposit-watch-list/fiat-deposit-watch-list.component').then(
        (m) => m.FiatDepositWatchListComponent,
      ),
  },
];
