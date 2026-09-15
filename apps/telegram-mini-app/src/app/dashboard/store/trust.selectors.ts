import { createFeatureSelector, createSelector } from '@ngrx/store'
import { selectTrustLevel, selectTurnover } from '../../user/store/user.selectors'
import { TRUST_FEATURE, type TrustState } from './trust.state'

const selectTrust = createFeatureSelector<TrustState>(TRUST_FEATURE)

export const selectTrustLevels = createSelector(selectTrust, (state) => state.levels)
export const selectTrustLoaded = createSelector(selectTrust, (state) => state.loaded)

/** The rung the user stands on, or `null` before the ladder has loaded. */
export const selectCurrentRung = createSelector(
  selectTrustLevels,
  selectTrustLevel,
  (levels, level) => levels.find((rung) => rung.level === level) ?? null
)

/** The rung above, or `null` at the top of the ladder. */
export const selectNextRung = createSelector(
  selectTrustLevels,
  selectTrustLevel,
  (levels, level) => {
    const index = levels.findIndex((rung) => rung.level === level)

    return index >= 0 ? (levels[index + 1] ?? null) : null
  }
)

/**
 * How far along the **current level** the user is, 0–100.
 *
 * Measured within one rung rather than across the whole ladder. The bar used to
 * weight the two milestones — reaching EXPERIENCED filled the first 40% — so
 * ₴76 543 of the ₴100 000 needed for the next level drew as 30%, and there was
 * nothing on screen to explain the gap between the two figures.
 *
 * `100` at the top of the ladder, and while the ladder is still loading: there
 * is no next rung to be part-way to.
 *
 * A selector rather than a `computed` on the dashboard, because it is derived
 * state over two slices and the levels page needs the same arithmetic.
 */
export const selectTurnoverProgress = createSelector(
  selectCurrentRung,
  selectNextRung,
  selectTurnover,
  (current, next, turnover) => {
    if (!next) return 100

    const from = current?.minTurnover ?? 0
    const span = next.minTurnover - from
    if (span <= 0) return 100

    return Math.min(Math.max(((turnover - from) / span) * 100, 0), 100)
  }
)

/** UAH kopecks still to turn over before the next rung; `0` at the top. */
export const selectTurnoverRemaining = createSelector(
  selectNextRung,
  selectTurnover,
  (next, turnover) => (next ? Math.max(next.minTurnover - turnover, 0) : 0)
)
