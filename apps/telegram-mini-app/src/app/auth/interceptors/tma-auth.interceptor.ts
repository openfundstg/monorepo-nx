import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { inject } from '@angular/core'
import { ERROR } from '@transacto/contracts'
import { catchError, throwError } from 'rxjs'
import { TmaService } from '../services/tma.service'
import { SessionExpiryService } from '../services/session-expiry.service'

/**
 * Attaches the launch credential, and notices when the server declares it dead.
 *
 * Both halves belong here: this is the one place that owns `initData` as a
 * credential, so it is also the place that should hear the answer. Spread
 * across screens it was heard nowhere — every page treated
 * `ERROR.TMA_AUTH.EXPIRED` as an ordinary failure and showed its own empty
 * state, which is why an app open past the window looked merely broken.
 *
 * Once the session is known expired nothing more is sent. The credential cannot
 * be renewed without a new launch, so every further request is a round trip
 * whose answer is already known — and, on a screen that polls, one every twenty
 * seconds for as long as the app stays open. The refusal is synchronous and
 * carries the server's own error, so callers see exactly what they would have
 * seen from the network.
 */
export const tmaAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const tmaService = inject(TmaService)
  const session = inject(SessionExpiryService)
  const initData = tmaService.initData()

  if (!initData) return next(req)

  if (session.expired()) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 401,
          url: req.url,
          error: ERROR.TMA_AUTH.EXPIRED
        })
    )
  }

  const cloned = req.clone({
    setHeaders: { 'x-tma-init-data': initData }
  })

  return next(cloned).pipe(
    catchError((error: unknown) => {
      if (isExpiredLaunch(error)) session.markExpired()

      return throwError(() => error)
    })
  )
}

/**
 * A `401` saying specifically that the launch has aged out.
 *
 * The code, not the status: the other `401`s here — a missing header, a hash
 * that does not verify — mean something is wrong with this client, and telling
 * a user to reopen the app would be advice that cannot help them.
 */
const isExpiredLaunch = (error: unknown): boolean =>
  error instanceof HttpErrorResponse &&
  error.status === 401 &&
  (error.error as { code?: number } | null)?.code === ERROR.TMA_AUTH.EXPIRED.code
