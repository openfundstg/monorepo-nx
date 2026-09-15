import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LoadingService } from '../../services/loading.service';

/**
 * The app-wide "waiting on the network" state, drawn once in the shell.
 *
 * Deliberately blocking: while it is up, taps do not reach what is underneath,
 * which is what stops a second submit landing on top of the first. It renders
 * nothing at all when idle, so it costs nothing the rest of the time.
 */
@Component({
  selector: 'app-loading-overlay',
  templateUrl: './loading-overlay.component.html',
  styleUrl: './loading-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingOverlayComponent {
  private readonly loading = inject(LoadingService);

  /** Already delayed — see `LoadingService`. */
  readonly visible = this.loading.visible;
}
