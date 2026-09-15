/**
 * The four tones any status can be shown in.
 *
 * Every status in the product — sales, deposits, alerts, an `isActive`
 * flag — is mapped onto one of these by `shared/utils/tone.util.ts`, and the
 * four classes that render them live in `styles/_primitives.scss`. Keeping the
 * vocabulary this small is the point: a palette with a colour per status is one
 * where two screens quietly disagree about whether `BLOCKED` is amber or red.
 */
export enum ChipTone {
  /** Working, settled, money arrived. */
  POSITIVE = 'positive',
  /** Waiting for a person to do something. */
  WARNING = 'warning',
  /** Money at risk, or a rule broken. */
  DANGER = 'danger',
  /** Nothing to say — created, expired, ended without incident. */
  NEUTRAL = 'neutral',
}
