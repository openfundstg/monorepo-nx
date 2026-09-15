import { TourStep } from '../../shared/enums/tour-step.enum'
import type { TourStepDefinition } from '../interfaces/tour-step-definition.interface'

/**
 * Where "has this account had its tour" is kept.
 *
 * Underscores only: CloudStorage keys are `A-Z a-z 0-9 _ -`, and a `.` makes
 * every write fail silently — the trap `GUIDE_EXPANDED_STORAGE_KEY` documents.
 */
export const TOUR_STORAGE_KEY = 'onboarding_tour'

/**
 * The anchor whose presence means "the dashboard is on screen and loaded".
 *
 * The balance card is rendered only inside the dashboard's loading `@else`, so
 * its registration is both facts at once, and the tour is gated on it rather
 * than on a call the dashboard would have to remember to make.
 */
export const TOUR_READY_ANCHOR = TourStep.BALANCE

/** `aria-labelledby` target on the dialog. One dialog, so one fixed id. */
export const TOUR_TITLE_ID = 'tour-title'

/**
 * A local factory rather than a util: it builds the keys by the concatenation
 * the enum was shaped for, and the result is still a literal list a grep can
 * read — `tour.steps.BALANCE.title` appears verbatim in the dictionaries.
 */
const step = (id: TourStep, anchored = true): TourStepDefinition => ({
  id,
  anchored,
  titleKey: `tour.steps.${id}.title`,
  textKey: `tour.steps.${id}.text`
})

/**
 * The tour, in display order — which is also DOM order on the dashboard, so
 * the highlight travels down the page once and never back up.
 *
 * `i18n.spec.ts` derives its required keys from this list: adding a step here
 * fails the build until all three dictionaries carry its copy.
 */
export const TOUR_STEPS: readonly TourStepDefinition[] = [
  step(TourStep.WELCOME, false),
  step(TourStep.BALANCE),
  step(TourStep.TRUST),
  step(TourStep.DEPOSIT),
  step(TourStep.SELL),
  step(TourStep.ACTIVITY),
  step(TourStep.NAV)
]
