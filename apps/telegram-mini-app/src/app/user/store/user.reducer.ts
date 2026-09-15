import { createReducer, on } from '@ngrx/store'
import { authActions } from '../../auth/store/auth.actions'
import { userActions } from './user.actions'
import { initialUserState } from './user.state'

export const userReducer = createReducer(
  initialUserState,

  /**
   * `/auth` already returns the profile, so the opening handshake seeds this
   * slice rather than being followed by a second request for what it just said.
   * Reacting to another feature's action is the point of a store: the two used
   * to be reconciled in a component, which had to decide which of them was
   * fresher every time either moved.
   */
  on(authActions.authenticateSuccess, (state, { session }) => ({
    ...state,
    profile: session.user,
    trustLevel: session.trustLevel
  })),

  on(userActions.loadProfile, (state) => ({ ...state, loadingProfile: true })),
  on(userActions.loadProfileSuccess, (state, { user, trustLevel, slotsAwaitingJarClosure }) => ({
    ...state,
    profile: user,
    trustLevel,
    slotsAwaitingJarClosure,
    loadingProfile: false
  })),
  on(userActions.loadProfileFailure, (state) => ({ ...state, loadingProfile: false })),

  on(userActions.loadHistory, (state) => ({ ...state, loadingHistory: true })),
  on(userActions.loadHistorySuccess, (state, { history }) => ({
    ...state,
    history,
    loadingHistory: false,
    historyLoaded: true
  })),
  on(userActions.loadHistoryFailure, (state) => ({
    ...state,
    loadingHistory: false,
    historyLoaded: true
  })),

  /**
   * Ignored before there is a profile to apply it to. An event that arrived
   * first has nothing to be a balance *of*, and inventing a user around one
   * number would put a card on screen with every other field blank.
   */
  on(userActions.balancePushed, (state, { balance }) =>
    state.profile === null ? state : { ...state, profile: { ...state.profile, balance } }
  )
)
