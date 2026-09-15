import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type {
  AdminAdjustBalanceReq,
  AdminSetUserActiveReq,
  AdminTmaUserListItem,
  ApiError,
} from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { UsersApiService } from '../services/users.api.service';

export const USERS_FEATURE = 'users';

export const usersCollection = createCollection<AdminTmaUserListItem>(USERS_FEATURE, {
  defaultSort: 'createdAt',
  idOf: (user) => String(user.telegramId),
});

/** The two things an operator can do to a user, kept apart from the list's own actions. */
export const userActions = createActionGroup({
  source: 'Users',
  events: {
    'Set Active': props<{ telegramId: number; body: AdminSetUserActiveReq }>(),
    'Adjust Balance': props<{ telegramId: number; body: AdminAdjustBalanceReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(usersCollection, () => {
  const api = inject(UsersApiService);

  return (query) => api.list(query);
});

/**
 * The live half.
 *
 * A user's row is pushed whenever their balance moves, which happens on every
 * deposit, every stake freeze and every referral payout — so this is the
 * busiest stream in the panel and the reason the list does not poll.
 */
const liveUsers = createEffect(
  () =>
    inject(AdminSocketService)
      .userUpdated()
      .pipe(map(({ user }) => usersCollection.actions.upserted({ item: user }))),
  { functional: true },
);

/**
 * Blocking or unblocking someone.
 *
 * `exhaustMap`, so a double-clicked menu item writes one audit row rather than
 * two. The response is the user's new row, fed straight back into the list —
 * the socket will push the same row moments later and the reducer replaces
 * rather than appends, so the duplicate is harmless and the screen does not
 * wait for it.
 */
const setActive = createEffect(
  () => {
    const api = inject(UsersApiService);

    return inject(Actions).pipe(
      ofType(userActions.setActive),
      exhaustMap(({ telegramId, body }) =>
        api.setActive(telegramId, body).pipe(
          map((user) => usersCollection.actions.upserted({ item: user })),
          catchError((error: unknown) => of(userActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

/**
 * A manual correction.
 *
 * Deliberately does not patch the row from the response: `AdminAdjustBalanceRes`
 * carries the three balances and not a whole row, and reassembling one from a
 * partial would put a half-built user in the list. The backend pushes the
 * complete row over the socket as part of the same operation, so the list
 * updates from the one source that has everything.
 */
const adjustBalance = createEffect(
  () => {
    const api = inject(UsersApiService);

    return inject(Actions).pipe(
      ofType(userActions.adjustBalance),
      exhaustMap(({ telegramId, body }) =>
        api.adjustBalance(telegramId, body).pipe(
          map(() => usersCollection.actions.refreshed()),
          catchError((error: unknown) => of(userActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const usersEffects = { ...collectionEffects, liveUsers, setActive, adjustBalance };
