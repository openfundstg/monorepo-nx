/**
 * Whether this page is being opened by a real Telegram user.
 *
 * Three states rather than a boolean, and the third is the reason: until the
 * server has verified the `initData`, "not authenticated" and "not asked yet"
 * are the same value — and a guard that could not tell them apart would bounce
 * every launch to the unavailable screen before the check had run.
 */
export enum SessionState {
  /** The check has not finished. Nothing may render yet. */
  PENDING = 'PENDING',
  /** Telegram signed the launch and the server verified the signature. */
  AUTHENTICATED = 'AUTHENTICATED',
  /** No Telegram launch, or one the server refused. */
  ANONYMOUS = 'ANONYMOUS'
}
