import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { filter, map, take } from 'rxjs';
import { selectAuthRestored, selectIsAuthenticated } from '../../auth/store/auth.selectors';

/**
 * Lets a route through only once the session has actually been checked.
 *
 * The session is an `HttpOnly` cookie, so the page cannot read it — "am I
 * signed in?" is a request, and until it answers, "no session" and "not asked
 * yet" are the same value. Waiting on `restored` is what stops a reload on a
 * deep link bouncing to the login form and back.
 *
 * `take(1)` after the filter, so the guard resolves once rather than staying
 * subscribed for the life of the route.
 */
export const adminGuard: CanActivateFn = () => {
  const store = inject(Store);
  const router = inject(Router);

  return store.select(selectAuthRestored).pipe(
    filter(Boolean),
    take(1),
    map(() => store.selectSignal(selectIsAuthenticated)()),
    map((authenticated) => authenticated || router.createUrlTree(['/login'])),
  );
};

/**
 * The mirror, for the login route itself.
 *
 * Without it, an operator who is already signed in and navigates to `/login`
 * gets a form that will refuse them for having a valid session.
 */
export const guestGuard: CanActivateFn = () => {
  const store = inject(Store);
  const router = inject(Router);

  return store.select(selectAuthRestored).pipe(
    filter(Boolean),
    take(1),
    map(() => store.selectSignal(selectIsAuthenticated)()),
    map((authenticated) => !authenticated || router.createUrlTree(['/'])),
  );
};
