import { Injectable, signal } from '@angular/core';

/**
 * Whether this launch's credential has aged out from under the app.
 *
 * `initData` is minted once, into the launch URL's fragment, and Telegram
 * offers no way to renew it — not even a reload, which re-reads that same
 * fragment and its original `auth_date`. So when the server answers
 * `ERROR.TMA_AUTH.EXPIRED` the app is not in a state it can recover from: every
 * request it will ever make from here carries the same dead credential.
 *
 * Before this existed, nothing noticed. A Mini App left open past the window
 * simply stopped working — the amounts list polled every twenty seconds and
 * failed every time, the refresh bar under it went on promising an update, and
 * the only thing on screen that still moved was the rate, because
 * `GET /tma/rates` is public. Reloading made it worse rather than better: the
 * same expired `initData` failed `POST /auth`, which the effects read as "not
 * from Telegram", and the guard put the user on the "open this in Telegram"
 * gate — inside Telegram.
 *
 * Set once and never unset, for the reason {@link AppVersionService} gives for
 * its own latch: the only exit is a new launch, and nothing this app can do
 * counts as one.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryService {
  private readonly _expired = signal(false);

  readonly expired = this._expired.asReadonly();

  /** Called by the interceptor, on the server's word and nothing else. */
  markExpired(): void {
    this._expired.set(true);
  }
}
