import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { USERS_FEATURE, usersCollection, usersEffects } from './store/users.collection';

/**
 * The slice and its effects are provided by the route, not the root.
 *
 * A screen nobody opens costs no reducer and no socket subscription — which
 * matters here because the users stream is the busiest in the panel, and an
 * operator sitting on the terminals page has no use for it.
 */
export const routes: Routes = [
  {
    path: '',
    providers: [provideState(USERS_FEATURE, usersCollection.reducer), provideEffects(usersEffects)],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/user-list/user-list.component').then((m) => m.UserListComponent),
      },
      {
        path: ':telegramId',
        loadComponent: () =>
          import('./pages/user-detail/user-detail.component').then((m) => m.UserDetailComponent),
      },
    ],
  },
];
