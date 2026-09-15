import { createFeatureSelector, createSelector } from '@ngrx/store'
import { TrustLevel } from '@transacto/contracts'
import { USER_FEATURE, type UserState } from './user.state'

const selectUser = createFeatureSelector<UserState>(USER_FEATURE)

export const selectProfile = createSelector(selectUser, (state) => state.profile)
export const selectHistory = createSelector(selectUser, (state) => state.history)
export const selectTrustLevelInfo = createSelector(selectUser, (state) => state.trustLevel)

/**
 * Finished sales whose jars are still open, and still holding a slot.
 *
 * Read by the dashboard, which is where a user meets this at all: the create
 * form's copy only reaches somebody already trying to start a sale.
 */
export const selectSlotsAwaitingJarClosure = createSelector(
  selectUser,
  (state) => state.slotsAwaitingJarClosure
)

/** Available balance in USDT cents — zero, not `null`, before the first read. */
export const selectBalance = createSelector(selectProfile, (user) => user?.balance ?? 0)

/** The part committed to open sales, in USDT cents. */
export const selectFrozenBalance = createSelector(selectProfile, (user) => user?.frozenBalance ?? 0)

/** Lifetime turnover in UAH kopecks — what the trust ladder is measured in. */
export const selectTurnover = createSelector(selectProfile, (user) => user?.totalTurnover ?? 0)

/**
 * The rung this user stands on, falling back to the lowest.
 *
 * The fallback is the reading, not a formality: before the profile arrives, the
 * safe assumption about somebody's level is the one that grants least.
 */
export const selectTrustLevel = createSelector(
  selectTrustLevelInfo,
  (info) => info?.level ?? TrustLevel.NEWBIE
)

export const selectHistoryLoaded = createSelector(selectUser, (state) => state.historyLoaded)

/** `true` only while there is nothing at all to draw. */
export const selectProfileLoading = createSelector(
  selectUser,
  (state) => state.loadingProfile && state.profile === null
)
