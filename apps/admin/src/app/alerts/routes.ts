import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { ALERTS_FEATURE, alertsCollection, alertsEffects } from './store/alerts.collection';

/** Slice and effects are route-scoped, so an unopened screen costs nothing. */
export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(ALERTS_FEATURE, alertsCollection.reducer),
      provideEffects(alertsEffects),
    ],
    loadComponent: () =>
      import('./pages/alerts-list/alerts-list.component').then((m) => m.AlertsListComponent),
  },
];
