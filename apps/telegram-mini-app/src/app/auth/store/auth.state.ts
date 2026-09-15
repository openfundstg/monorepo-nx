import type { AuthResponse } from '@transacto/contracts'
import { SessionState } from '../enums/session-state.enum'

/**
 * Who is opening the app, decided once and held for the session.
 *
 * **The whole app used to render before this existed.** Nothing guarded a
 * route, so a stranger typing the URL into a browser got the dashboard — empty,
 * because every request behind it answered `401`, but complete: the balance
 * card, the trust ladder, the nav, the buttons. The data was never at risk; the
 * product surface was on display to anyone who found the address.
 *
 * **This is not a security boundary and must not be mistaken for one.** The
 * bundle is downloadable and the check runs in the client, so anyone determined
 * can reach the markup. What stops data leaving is `TmaAuthService` on the
 * backend, which verifies Telegram's HMAC on every single request and is the
 * only thing that ever could — a static SPA cannot be gated server-side,
 * because `initData` arrives in the URL *fragment*, which browsers never send.
 *
 * The verdict comes from the **server**, not from the presence of a string.
 * `initData` is attacker-supplied text; only `POST /auth` can say whether
 * Telegram signed it.
 */
export interface AuthState {
  /**
   * The verdict. {@link SessionState.PENDING} until the server answers, which is
   * the distinction the guard exists for: "not authenticated" and "not asked
   * yet" are otherwise the same value, and reading eagerly bounces every
   * legitimate launch to the unavailable screen and back.
   */
  readonly status: SessionState
  /** What `/auth` returned, or `null` when it has not answered or refused. */
  readonly session: AuthResponse | null
}

export const AUTH_FEATURE = 'auth'

export const initialAuthState: AuthState = {
  status: SessionState.PENDING,
  session: null
}
