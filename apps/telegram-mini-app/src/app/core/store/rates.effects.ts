import { inject } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, map, of, switchMap, timer } from 'rxjs'
import { RatesApiService } from '../services/rates.api.service'
import { ratesActions } from './rates.actions'

/**
 * How often every price in the app is re-read.
 *
 * One timer for all of them, which is the point: the rates arrive in a single
 * response, so no two screens can be looking at figures fetched at different
 * moments. Thirty seconds is affordable because the server answers from a
 * one-minute Redis cache — all but the first caller in each window costs one
 * Redis read, not a call to Transacto.
 */
const POLL_INTERVAL_MS = 30_000

/**
 * The poll itself, started when effects are registered — app start.
 *
 * `timer(0, …)` rather than `interval`, so the first read happens immediately
 * instead of thirty seconds into a blank screen.
 */
export const pollRates = createEffect(
  () => timer(0, POLL_INTERVAL_MS).pipe(map(() => ratesActions.load())),
  { functional: true }
)

/**
 * `switchMap`: a request still in flight when the next tick arrives is stale by
 * definition, and the answer that matters is the newer one.
 */
export const loadRates = createEffect(
  () => {
    const api = inject(RatesApiService)

    return inject(Actions).pipe(
      ofType(ratesActions.load),
      switchMap(() =>
        api.getRates().pipe(
          map((rates) => ratesActions.loadSuccess({ rates })),
          catchError(() => of(ratesActions.loadFailure()))
        )
      )
    )
  },
  { functional: true }
)

export const ratesEffects = { pollRates, loadRates }
