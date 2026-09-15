import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AUTH_FEATURE, type AuthState } from './auth.state';

const selectAuth = createFeatureSelector<AuthState>(AUTH_FEATURE);

export const selectSession = createSelector(selectAuth, (state) => state.session);
export const selectIsAuthenticated = createSelector(selectAuth, (state) => state.session !== null);
export const selectAuthRestored = createSelector(selectAuth, (state) => state.restored);
export const selectAuthLoading = createSelector(selectAuth, (state) => state.loading);
export const selectAuthError = createSelector(selectAuth, (state) => state.error);
export const selectSessionExpired = createSelector(selectAuth, (state) => state.expired);
export const selectUsername = createSelector(
  selectAuth,
  (state) => state.session?.username ?? null,
);

/** Read by the CSRF interceptor on every state-changing request. */
export const selectCsrfToken = createSelector(
  selectAuth,
  (state) => state.session?.csrfToken ?? null,
);
