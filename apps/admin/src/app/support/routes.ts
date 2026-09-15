import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import {
  SUPPORT_TOPICS_FEATURE,
  SUPPORT_USERS_FEATURE,
  supportTopicsCollection,
  supportTopicsEffects,
  supportUsersCollection,
  supportUsersEffects,
} from './store/support.collections';

export const routes: Routes = [
  {
    path: '',
    providers: [
      provideState(SUPPORT_TOPICS_FEATURE, supportTopicsCollection.reducer),
      provideState(SUPPORT_USERS_FEATURE, supportUsersCollection.reducer),
      provideEffects(supportTopicsEffects, supportUsersEffects),
    ],
    loadComponent: () =>
      import('./pages/support-list/support-list.component').then((m) => m.SupportListComponent),
  },
];
