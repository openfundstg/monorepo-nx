import { createFeatureSelector, createSelector } from '@ngrx/store'
import { SessionState } from '../enums/session-state.enum'
import { AUTH_FEATURE, type AuthState } from './auth.state'

const selectAuth = createFeatureSelector<AuthState>(AUTH_FEATURE)

export const selectSessionStatus = createSelector(selectAuth, (state) => state.status)
export const selectSession = createSelector(selectAuth, (state) => state.session)
export const selectIsAuthenticated = createSelector(
  selectSessionStatus,
  (status) => status === SessionState.AUTHENTICATED
)

/**
 * Whether the server has answered at all.
 *
 * The guard waits on this rather than on {@link selectSession}, for the reason
 * spelled out on `AuthState.status`.
 */
export const selectSessionSettled = createSelector(
  selectSessionStatus,
  (status) => status !== SessionState.PENDING
)
