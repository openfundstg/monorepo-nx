import type { TourStep } from '../../shared/enums/tour-step.enum'

/** One stop on the tour, as `TOUR_STEPS` lists them and the overlay renders them. */
export interface TourStepDefinition {
  readonly id: TourStep
  /** `false` only for the welcome card, which highlights nothing. */
  readonly anchored: boolean
  /** Written out in full, e.g. `'tour.steps.BALANCE.title'`, so a grep finds it. */
  readonly titleKey: string
  readonly textKey: string
}
