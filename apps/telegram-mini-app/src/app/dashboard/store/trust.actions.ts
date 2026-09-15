import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { TrustLevelRung } from '@transacto/contracts'

export const trustActions = createActionGroup({
  source: 'Trust',
  events: {
    /** Safe to dispatch on every entry — the effect drops it once loaded. */
    'Load Ladder': emptyProps(),
    'Load Ladder Success': props<{ levels: readonly TrustLevelRung[] }>(),
    /**
     * The ladder is decoration: a screen that cannot draw its progress bar must
     * still render everything else, so this settles the slice rather than
     * raising anything.
     */
    'Load Ladder Failure': emptyProps()
  }
})
