import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectCsrfToken } from '../../auth/store/auth.selectors';
import { take } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/** The methods the backend's `CsrfGuard` actually checks. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Echoes the CSRF token on every state-changing request.
 *
 * The backend sets a `csrf-token` cookie scoped to `/api/admin` and requires
 * the same value back in `x-csrf-token`. The page cannot read that cookie —
 * it is scoped to a path this app is not served from — so the token comes from
 * the login response, held in the auth state.
 *
 * `take(1)` and not a plain `withLatestFrom`: the store selector never
 * completes, and an interceptor whose returned observable stays open leaves the
 * request hanging after its response has already arrived.
 */
export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (SAFE_METHODS.has(request.method)) return next(request);

  return inject(Store)
    .select(selectCsrfToken)
    .pipe(
      take(1),
      switchMap((token) =>
        next(token ? request.clone({ setHeaders: { 'x-csrf-token': token } }) : request),
      ),
    );
};
