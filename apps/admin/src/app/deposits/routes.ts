import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { DEPOSITS_FEATURE, depositsCollection, depositsEffects } from './store/deposits.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(DEPOSITS_FEATURE, depositsCollection.reducer),
      provideEffects(depositsEffects),
    ],
    loadComponent: () =>
      import('./pages/deposits-list/deposits-list.component').then((m) => m.DepositsListComponent),
  },
];
