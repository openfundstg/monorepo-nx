import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { TRADERS_FEATURE, tradersCollection, tradersEffects } from './store/traders.collection';

export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(TRADERS_FEATURE, tradersCollection.reducer),
      provideEffects(tradersEffects),
    ],
    loadComponent: () =>
      import('./pages/trader-list/trader-list.component').then((m) => m.TraderListComponent),
  },
];
