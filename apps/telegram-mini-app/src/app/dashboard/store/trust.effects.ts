import { inject } from '@angular/core'
import { Store } from '@ngrx/store'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { concatLatestFrom } from '@ngrx/operators'
import { catchError, exhaustMap, filter, map, of } from 'rxjs'
import { TrustLevelApiService } from '../services/trust-level.api.service'
import { trustActions } from './trust.actions'
import { selectTrustLoaded } from './trust.selectors'

/**
 * Loads the ladder at most once a session.
 *
 * The "at most once" lives here rather than in the screens that need it: two
 * pages read this ladder, and asking each of them to check whether the other
 * has already fetched it is how one of them ends up not checking.
 *
 * `exhaustMap` on top of that covers the concurrent case — the dashboard and a
 * deep-linked levels page mounting in the same tick, before either has set
 * `loaded`.
 */
export const loadLadder = createEffect(
  () => {
    const api = inject(TrustLevelApiService)
    const store = inject(Store)

    return inject(Actions).pipe(
      ofType(trustActions.loadLadder),
      concatLatestFrom(() => store.select(selectTrustLoaded)),
      filter(([, loaded]) => !loaded),
      exhaustMap(() =>
        api.getLadder().pipe(
          map(({ levels }) => trustActions.loadLadderSuccess({ levels })),
          catchError(() => of(trustActions.loadLadderFailure()))
        )
      )
    )
  },
  { functional: true }
)

export const trustEffects = { loadLadder }
