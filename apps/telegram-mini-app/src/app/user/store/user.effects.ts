import { inject } from '@angular/core'
import { toObservable } from '@angular/core/rxjs-interop'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, filter, map, mergeMap, of, switchMap } from 'rxjs'
import type { BalanceUpdateEvent } from '@transacto/contracts'
import { UserApiService } from '../services/user.api.service'
import { WsService } from '../../realtime/services/ws.service'
import { userActions } from './user.actions'

/**
 * Every profile read is a background one.
 *
 * Nothing here is a screen the user is waiting on — the card already holds a
 * figure, and this is the refresh of it — so raising the global overlay would
 * grey out whatever they are reading every time a balance moved.
 */
const BACKGROUND = true

export const loadProfile = createEffect(
  () => {
    const api = inject(UserApiService)

    return inject(Actions).pipe(
      ofType(userActions.loadProfile),
      switchMap(() =>
        api.getProfile(BACKGROUND).pipe(
          map(({ user, trustLevel, maxParallelOrders, slotsAwaitingJarClosure }) =>
            // `/user/profile` reports the level as a bare enum plus its
            // allowances; `/auth` returns the composed object. Rebuilt here so
            // the slice holds one shape whichever endpoint filled it.
            userActions.loadProfileSuccess({
              user,
              trustLevel: {
                level: trustLevel,
                maxParallelOrders
              },
              // `?? []` for a server older than the field: not knowing which
              // sales hold a slot has to read as none, not as a crash.
              slotsAwaitingJarClosure: slotsAwaitingJarClosure ?? []
            })
          ),
          catchError(() => of(userActions.loadProfileFailure()))
        )
      )
    )
  },
  { functional: true }
)

export const loadHistory = createEffect(
  () => {
    const api = inject(UserApiService)

    return inject(Actions).pipe(
      ofType(userActions.loadHistory),
      switchMap(() =>
        api.getBalanceHistory().pipe(
          map(({ history }) => userActions.loadHistorySuccess({ history })),
          catchError(() => of(userActions.loadHistoryFailure()))
        )
      )
    )
  },
  { functional: true }
)

/**
 * The socket's balance event, turned into an action.
 *
 * `WsService` latches each event into a signal rather than pushing it through a
 * subject, so a screen that mounts after one still reads it. `toObservable`
 * bridges that into the store without either side learning about the other —
 * and because it replays the held value on subscribe, an event from earlier in
 * the session is applied rather than lost.
 */
export const balancePush = createEffect(
  () => {
    const ws = inject(WsService)

    return toObservable(ws.balanceUpdated).pipe(
      filter((event): event is BalanceUpdateEvent => event !== null),
      map(({ balance }) => userActions.balancePushed({ balance }))
    )
  },
  { functional: true }
)

/**
 * A pushed balance is a reason to re-read both halves of the ledger.
 *
 * The event carries the available balance and nothing else, but whatever moved
 * it moved the frozen side and the timeline too. Refreshing only the card left
 * the row that explains the new figure missing until the next visit.
 */
export const refreshAfterBalancePush = createEffect(
  () => {
    return inject(Actions).pipe(
      ofType(userActions.balancePushed),
      mergeMap(() => of(userActions.loadProfile(), userActions.loadHistory()))
    )
  },
  { functional: true }
)

export const userEffects = { loadProfile, loadHistory, balancePush, refreshAfterBalancePush }
