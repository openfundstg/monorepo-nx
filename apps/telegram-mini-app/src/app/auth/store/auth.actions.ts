import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { AuthResponse } from '@transacto/contracts'

export const authActions = createActionGroup({
  source: 'Auth',
  events: {
    /**
     * Asks the server whether Telegram signed this launch.
     *
     * Dispatched by the route guard rather than at bootstrap, because effects
     * are subscribed when the injector builds them and an app initializer that
     * dispatched first would fire into nothing. Several guards resolve at once
     * on a deep link; the effect's `exhaustMap` is what makes that one request.
     */
    Authenticate: emptyProps(),
    'Authenticate Success': props<{ session: AuthResponse }>(),
    /**
     * No signed launch, or the server would not vouch for it.
     *
     * One action for both, deliberately. A `401` and a network outage are
     * different causes with the same consequence — nothing may be shown — and
     * telling them apart on this screen would mean rendering the app to
     * somebody the server has not vouched for.
     */
    'Authenticate Anonymous': emptyProps()
  }
})
