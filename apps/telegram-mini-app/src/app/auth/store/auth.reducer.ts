import { createReducer, on } from '@ngrx/store'
import { SessionState } from '../enums/session-state.enum'
import { authActions } from './auth.actions'
import { initialAuthState } from './auth.state'

export const authReducer = createReducer(
  initialAuthState,
  on(authActions.authenticateSuccess, (state, { session }) => ({
    ...state,
    status: SessionState.AUTHENTICATED,
    session
  })),
  on(authActions.authenticateAnonymous, (state) => ({
    ...state,
    status: SessionState.ANONYMOUS,
    session: null
  }))
)
