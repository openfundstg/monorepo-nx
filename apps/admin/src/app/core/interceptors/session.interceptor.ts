import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { authActions } from '../../auth/store/auth.actions';
import { toApiError, isUnauthenticated } from '../../shared/utils';

/**
 * The one request whose 401 is an answer rather than a failure.
 *
 * `GET /auth/me` is the probe the app makes on every start to ask whether the
 * cookie names a live session. A 401 there means "not signed in", which on a
 * first visit is the ordinary case — treating it as an expiry puts "your
 * session has ended" in front of somebody who has never been here.
 */
const SESSION_PROBE = 'auth/me';

/**
 * Turns a rejected session into a logout, once, wherever it happens.
 *
 * Any request can be the one that discovers the session has expired — the
 * cookie has a twelve-hour life and the tab may have been open longer. Without
 * this, every screen would have to recognise a 401 for itself, and
 * the ones that forgot would sit on a spinner.
 *
 * The error is re-thrown rather than swallowed: the feature's own failure
 * action still needs to fire, so the list stops loading rather than waiting for
 * a response that will not come. `restoreFailure` handles the probe's own 401.
 */
export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const store = inject(Store);

  return next(request).pipe(
    catchError((error: unknown) => {
      const isProbe = request.url.endsWith(SESSION_PROBE);

      if (!isProbe && error instanceof HttpErrorResponse && isUnauthenticated(toApiError(error)))
        store.dispatch(authActions.sessionExpired());

      return throwError(() => error);
    }),
  );
};
