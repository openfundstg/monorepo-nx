import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { authActions } from './auth/store/auth.actions';
import { SocketLifecycleService } from './core/services/socket-lifecycle.service';

/**
 * The application root, and nothing else.
 *
 * It asks who the cookie belongs to and starts the socket lifecycle. Both are
 * app-wide and neither belongs to a screen: a component that opened the socket
 * would close it on the next navigation, and a guard that restored the session
 * would do so once per guarded route.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly socketLifecycle = inject(SocketLifecycleService);

  ngOnInit(): void {
    this.socketLifecycle.start();
    // Dispatched before anything renders, because the guards wait on its
    // answer — see `adminGuard`.
    this.store.dispatch(authActions.restore());
  }
}
