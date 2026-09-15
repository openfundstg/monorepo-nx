import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, exhaustMap, map, of, switchMap, tap } from 'rxjs';
import { AuthApiService } from '../services/auth.api.service';
import { toApiError } from '../../shared/utils';
import { authActions } from './auth.actions';

export const restoreSession = createEffect(
  () => {
    const api = inject(AuthApiService);

    return inject(Actions).pipe(
      ofType(authActions.restore),
      switchMap(() =>
        api.me().pipe(
          map((session) => authActions.restoreSuccess({ session })),
          // Any failure means "not signed in". The distinction between an
          // expired cookie and no cookie at all is not one the login form can
          // act on, and reporting it as an error would put a red banner in
          // front of every first-time visitor.
          catchError(() => of(authActions.restoreFailure())),
        ),
      ),
    );
  },
  { functional: true },
);

/**
 * `exhaustMap`, not `switchMap`.
 *
 * A double-clicked sign-in button must not fire a second login: the backend
 * counts failed attempts per address, and a duplicate in flight would burn an
 * attempt against a lockout the operator never earned.
 */
export const login = createEffect(
  () => {
    const api = inject(AuthApiService);

    return inject(Actions).pipe(
      ofType(authActions.login),
      exhaustMap(({ credentials }) =>
        api.login(credentials).pipe(
          map((session) => authActions.loginSuccess({ session })),
          catchError((error: unknown) =>
            of(authActions.loginFailure({ error: toApiError(error) })),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const logout = createEffect(
  () => {
    const api = inject(AuthApiService);

    return inject(Actions).pipe(
      ofType(authActions.logout),
      exhaustMap(() =>
        api.logout().pipe(
          map(() => authActions.logoutSuccess()),
          // The cookie is gone locally either way, and a sign-out that refuses
          // to sign out because the server was unreachable is the worst
          // possible failure mode for this particular button.
          catchError(() => of(authActions.logoutSuccess())),
        ),
      ),
    );
  },
  { functional: true },
);

export const redirectAfterLogin = createEffect(
  () => {
    const router = inject(Router);

    return inject(Actions).pipe(
      ofType(authActions.loginSuccess),
      tap(() => void router.navigate(['/'])),
    );
  },
  { functional: true, dispatch: false },
);

export const redirectAfterLogout = createEffect(
  () => {
    const router = inject(Router);

    return inject(Actions).pipe(
      ofType(authActions.logoutSuccess, authActions.sessionExpired),
      tap(() => void router.navigate(['/login'])),
    );
  },
  { functional: true, dispatch: false },
);

export const authEffects = {
  restoreSession,
  login,
  logout,
  redirectAfterLogin,
  redirectAfterLogout,
};
