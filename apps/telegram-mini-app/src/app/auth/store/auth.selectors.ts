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
 * A demo account's generated history, or `null` for everybody else.
 *
 * Part of the session because it arrives with it — `/auth` is the one request
 * every launch makes, and the guard renders nothing before it has answered,
 * so no screen can be drawn from real figures first and invented ones after.
 */
export const selectDemoPack = createSelector(selectSession, (session) => session?.demo ?? null)

/** Whether this launch is a demo account's. */
export const selectIsDemo = createSelector(selectDemoPack, (pack) => pack !== null)

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
