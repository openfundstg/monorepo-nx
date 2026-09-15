import { createReducer, on } from '@ngrx/store';
import { authActions } from './auth.actions';
import { initialAuthState } from './auth.state';

export const authReducer = createReducer(
  initialAuthState,
  on(authActions.restore, (state) => ({ ...state, loading: true })),
  on(authActions.restoreSuccess, (state, { session }) => ({
    ...state,
    session,
    loading: false,
    restored: true,
  })),
  on(authActions.restoreFailure, (state) => ({
    ...state,
    session: null,
    loading: false,
    restored: true,
  })),

  // A fresh attempt clears the expiry notice: the operator is answering it, and
  // leaving it up alongside a "wrong password" would show two explanations for
  // one empty form.
  on(authActions.login, (state) => ({ ...state, loading: true, error: null, expired: false })),
  on(authActions.loginSuccess, (state, { session }) => ({
    ...state,
    session,
    loading: false,
    error: null,
    restored: true,
  })),
  on(authActions.loginFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(authActions.logoutSuccess, (state) => ({
    ...state,
    session: null,
    loading: false,
    error: null,
    expired: false,
    restored: true,
  })),
  on(authActions.sessionExpired, (state) => ({
    ...state,
    session: null,
    loading: false,
    expired: true,
    restored: true,
  })),
);
