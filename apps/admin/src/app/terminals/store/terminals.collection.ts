import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { createActionGroup, props } from '@ngrx/store';
import type {
  AdminSetTerminalStateReq,
  AdminTerminalListItem,
  ApiError,
} from '@transacto/contracts';
import { catchError, exhaustMap, map, of } from 'rxjs';
import { AdminSocketService } from '../../core/services/admin-socket.service';
import { createCollection, createCollectionEffects } from '../../shared/store';
import { toApiError } from '../../shared/utils';
import { TerminalsApiService } from '../services/terminals.api.service';

export const TERMINALS_FEATURE = 'terminals';

export const terminalsCollection = createCollection<AdminTerminalListItem>(TERMINALS_FEATURE, {
  defaultSort: 'updatedAt',
  idOf: (terminal) => terminal.id,
});

export const terminalActions = createActionGroup({
  source: 'Terminals',
  events: {
    'Set State': props<{ cardId: number; body: AdminSetTerminalStateReq }>(),
    Failed: props<{ error: ApiError }>(),
  },
});

const collectionEffects = createCollectionEffects(terminalsCollection, () => {
  const api = inject(TerminalsApiService);

  return (query) => api.list(query);
});

/**
 * Balances move on every scrape, so this is the stream that makes the terminals
 * screen worth leaving open — and it is a fan-out of the trader `ws.emit` bus
 * the extension already listens to, not a second source of truth.
 */
const liveTerminals = createEffect(
  () =>
    inject(AdminSocketService)
      .terminalUpdated()
      .pipe(map(({ terminal }) => terminalsCollection.actions.upserted({ item: terminal }))),
  { functional: true },
);

const setState = createEffect(
  () => {
    const api = inject(TerminalsApiService);

    return inject(Actions).pipe(
      ofType(terminalActions.setState),
      exhaustMap(({ cardId, body }) =>
        api.setState(cardId, body).pipe(
          map((terminal) => terminalsCollection.actions.upserted({ item: terminal })),
          catchError((error: unknown) => of(terminalActions.failed({ error: toApiError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const terminalsEffects = { ...collectionEffects, liveTerminals, setState };
