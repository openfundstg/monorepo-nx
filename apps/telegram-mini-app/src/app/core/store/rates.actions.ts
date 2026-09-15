import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { TmaRatesResponse } from '@transacto/contracts'

export const ratesActions = createActionGroup({
  source: 'Rates',
  events: {
    /** Fired by the poll, and by nothing else. */
    Load: emptyProps(),
    'Load Success': props<{ rates: TmaRatesResponse }>(),
    /**
     * Deliberately changes nothing.
     *
     * A momentary outage should leave a thirty-second-old figure on screen, not
     * blank it. The next tick asks again, so a real outage costs one stale
     * reading rather than an empty one.
     */
    'Load Failure': emptyProps()
  }
})
