import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  REFERRALS_FEATURE,
  referralsCollection,
  referralsEffects,
} from './store/referrals.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(REFERRALS_FEATURE, referralsCollection.reducer),
      provideEffects(referralsEffects),
    ],
    loadComponent: () =>
      import('./pages/referrals-list/referrals-list.component').then(
        (m) => m.ReferralsListComponent,
      ),
  },
];
