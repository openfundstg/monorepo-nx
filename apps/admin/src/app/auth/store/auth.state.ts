import type { AdminSessionRes, ApiError } from '@transacto/contracts';

export interface AuthState {
  readonly session: AdminSessionRes | null;
  readonly loading: boolean;
  readonly error: ApiError | null;
  /**
   * Whether the opening `restore` has answered yet.
   *
   * The guard waits on this rather than on `session`, because "no session yet"
   * and "no session" are the same value and only this tells them apart — without
   * it, a reload on any deep link bounces to the login form before the cookie
   * has been checked.
   */
  readonly restored: boolean;
  /** Set when the session ended on its own, so the form can say so. */
  readonly expired: boolean;
}

export const AUTH_FEATURE = 'auth';

export const initialAuthState: AuthState = {
  session: null,
  loading: false,
  error: null,
  restored: false,
  expired: false,
};
