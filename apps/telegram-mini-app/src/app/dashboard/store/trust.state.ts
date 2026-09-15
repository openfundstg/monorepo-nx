import type { TrustLevelRung } from '@transacto/contracts'

/**
 * The trust ladder — what each level requires and what it allows.
 *
 * Loaded once per app session, correctly and unlike a price. The ladder is
 * business configuration that changes on a deploy, not a market figure that
 * moves by the minute, so there is nothing for a poll to catch. `RatesState`
 * holds the opposite policy for the opposite reason; do not make them match.
 *
 * Fetched rather than restated here. The milestones are backend-owned business
 * rules, and the copy that used to live in this app came with a note asking
 * whoever moved a threshold to remember to move it here too. A user shown as
 * half-way to a level they already hold is what that note was trying to
 * prevent; serving the numbers prevents it outright.
 */
export interface TrustState {
  /** Cheapest rung first, as the server orders it. */
  readonly levels: readonly TrustLevelRung[]
  /**
   * Whether the ladder has been asked for and answered.
   *
   * Separate from `levels.length`, so a failed load is not retried on every
   * navigation — and so an empty ladder reads as "unavailable" rather than as a
   * product with no levels.
   */
  readonly loaded: boolean
}

export const TRUST_FEATURE = 'trust'

export const initialTrustState: TrustState = {
  levels: [],
  loaded: false
}
