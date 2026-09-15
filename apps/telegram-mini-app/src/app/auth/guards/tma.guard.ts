import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { Store } from '@ngrx/store'
import { filter, firstValueFrom, take } from 'rxjs'
import { SessionState } from '../enums/session-state.enum'
import { authActions } from '../store/auth.actions'
import { selectSessionSettled, selectSessionStatus } from '../store/auth.selectors'

/** Where an unverified visitor is sent. Outside the guard, or it would loop. */
export const UNAVAILABLE_PATH = 'unavailable'

/**
 * Waits for the server's verdict, asking for one if nobody has yet.
 *
 * It waits rather than reading a flag: the check is a request, and until it
 * answers "not authenticated" and "not asked yet" are the same value. Reading
 * eagerly would bounce every legitimate launch to the unavailable screen and
 * then back.
 *
 * Dispatching from here rather than from an app initializer is deliberate:
 * effects are subscribed when the injector builds them, and an initializer that
 * dispatched first would fire into nothing. Several guards resolve at once on a
 * deep link and each will dispatch; the effect's `exhaustMap` is what turns
 * that into one request.
 */
const settledStatus = async (): Promise<SessionState> => {
  const store = inject(Store)

  if (!(await firstValueFrom(store.select(selectSessionSettled)))) {
    store.dispatch(authActions.authenticate())
  }

  return firstValueFrom(
    store.select(selectSessionStatus).pipe(
      filter((status) => status !== SessionState.PENDING),
      take(1)
    )
  )
}

/**
 * Nothing renders until Telegram's launch has been verified by the server.
 *
 * On the parent route rather than repeated per screen, so a route added later
 * cannot be published by somebody forgetting it — the same reason the backend
 * denies access by default.
 */
export const tmaGuard: CanActivateFn = async () => {
  const router = inject(Router)
  const status = await settledStatus()

  return status === SessionState.AUTHENTICATED || router.createUrlTree([UNAVAILABLE_PATH])
}

/**
 * The mirror, for the unavailable screen itself.
 *
 * Without it, a verified user who lands on that path — a stale link, a back
 * gesture — is shown "open this in Telegram" while sitting inside Telegram.
 */
export const anonymousGuard: CanActivateFn = async () => {
  const router = inject(Router)
  const status = await settledStatus()

  return status !== SessionState.AUTHENTICATED || router.createUrlTree(['/'])
}
