import { inject } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, exhaustMap, filter, map, of, tap } from 'rxjs'
import { AuthApiService } from '../services/auth.api.service'
import { TmaService } from '../services/tma.service'
import { MetaPixelService } from '../../shared/services/meta-pixel.service'
import { PixelStandardEvent } from '../../shared/enums/pixel-event.enum'
import { OnboardingTourService } from '../../onboarding/services/onboarding-tour.service'
import { authActions } from './auth.actions'

/**
 * `exhaustMap`, not `switchMap`.
 *
 * Every route runs the guard and a deep link resolves several at once on the
 * first navigation, so without this each would start its own `/auth` and verify
 * one signature three times. It replaces the in-flight promise the old session
 * service kept for exactly this.
 */
export const authenticate = createEffect(
  () => {
    const api = inject(AuthApiService)
    const tma = inject(TmaService)

    return inject(Actions).pipe(
      ofType(authActions.authenticate),
      exhaustMap(() => {
        // No signed launch at all: a plain browser, or Telegram's in-app
        // browser rather than a Mini App. Answered without a request — there is
        // nothing for the server to verify, and asking would only tell an
        // unauthenticated visitor that the endpoint exists.
        if (!tma.initData()) return of(authActions.authenticateAnonymous())

        return api.authenticate().pipe(
          map((session) => authActions.authenticateSuccess({ session })),
          catchError(() => of(authActions.authenticateAnonymous()))
        )
      })
    )
  },
  { functional: true }
)

/**
 * Counts a registration, once.
 *
 * `/auth` reports `isNewUser` on the launch that created the row and never
 * again, so this fires at most once per user — and here rather than in the
 * dashboard's `ngOnInit`, which ran on every *navigation* back to the home
 * screen and counted the same registration each time.
 */
export const trackRegistration = createEffect(
  () => {
    const pixel = inject(MetaPixelService)

    return inject(Actions).pipe(
      ofType(authActions.authenticateSuccess),
      filter(({ session }) => session.isNewUser),
      tap(() => pixel.trackConversion(PixelStandardEvent.COMPLETE_REGISTRATION))
    )
  },
  { functional: true, dispatch: false }
)

/**
 * Owes a brand-new account its tour.
 *
 * Marked here, at `/auth`, and not when the dashboard first shows: a new user
 * opened from a `startapp=topup` link goes straight to the top-up list, and if
 * they close the app there `isNewUser` is `false` on every later launch — the
 * one signal that says "first time" fires exactly once, so what it means has
 * to be written down the moment it fires. The tour itself waits for the
 * dashboard; see `OnboardingTourService.active`.
 */
export const armOnboardingTour = createEffect(
  () => {
    const tour = inject(OnboardingTourService)

    return inject(Actions).pipe(
      ofType(authActions.authenticateSuccess),
      filter(({ session }) => session.isNewUser),
      tap(() => tour.markPending())
    )
  },
  { functional: true, dispatch: false }
)

export const authEffects = { authenticate, trackRegistration, armOnboardingTour }
