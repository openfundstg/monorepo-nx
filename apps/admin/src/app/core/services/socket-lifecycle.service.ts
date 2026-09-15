import { DestroyRef, inject, Injectable } from '@angular/core';
import { Actions, ofType } from '@ngrx/effects';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { authActions } from '../../auth/store/auth.actions';
import { AdminSocketService } from './admin-socket.service';

/**
 * Opens the socket when a session begins and closes it when one ends.
 *
 * A service rather than an effect because it has no action to dispatch — it is
 * a side effect on a stream, and `createEffect(..., { dispatch: false })` for
 * two lines of connect/disconnect reads as ceremony. Instantiated once by the
 * shell.
 *
 * Closing on logout is the part that matters: the admin room carries every
 * user's traffic, and a socket left open after sign-out would keep receiving it
 * in a tab nobody is watching.
 */
@Injectable({ providedIn: 'root' })
export class SocketLifecycleService {
  private readonly actions = inject(Actions);
  private readonly socket = inject(AdminSocketService);
  /**
   * Captured here rather than relied on implicitly inside `start()`.
   *
   * `takeUntilDestroyed()` with no argument needs an injection context, and
   * `start()` is called from a component's lifecycle hook where there is none.
   * This service is root-provided, so the ref it holds lives as long as the app
   * — which is exactly the lifetime the socket should have.
   */
  private readonly destroyRef = inject(DestroyRef);

  start(): void {
    this.actions
      .pipe(
        ofType(authActions.loginSuccess, authActions.restoreSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.socket.connect());

    this.actions
      .pipe(
        ofType(authActions.logoutSuccess, authActions.sessionExpired),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.socket.disconnect());
  }
}
