import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { DEPOSITS_FEATURE, depositsCollection, depositsEffects } from './store/deposits.collection';

/**
 * The book and one deposit's page, under one slice.
 *
 * `:kind/:id` rather than `:id`, because the two rails are different
 * collections minting their own ids — see the controller's own note.
 */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(DEPOSITS_FEATURE, depositsCollection.reducer),
      provideEffects(depositsEffects),
    ],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/deposits-list/deposits-list.component').then(
            (m) => m.DepositsListComponent,
          ),
      },
      {
        path: ':kind/:id',
        loadComponent: () =>
          import('./pages/deposit-detail/deposit-detail.component').then(
            (m) => m.DepositDetailComponent,
          ),
      },
    ],
  },
];
