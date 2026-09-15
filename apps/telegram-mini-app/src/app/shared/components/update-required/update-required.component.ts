import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AppVersionService } from '../../services/app-version.service';
import { LogoComponent } from '../logo/logo.component';

/**
 * The screen that appears when the app on screen is no longer the app we ship.
 *
 * Deliberately impossible to dismiss: no close button, no backdrop to tap, and
 * it paints over everything including the nav. That is the point of it. A
 * stale Mini App is not a cosmetic problem here — it holds the wire contracts
 * of a product that moves money, and a client from before a contract changed
 * can show a figure the server no longer means or send a shape it no longer
 * accepts.
 *
 * One button, and it reloads. There is nothing else to offer: the code that
 * would implement any other choice is the code being replaced.
 */
@Component({
  selector: 'app-update-required',
  imports: [TranslatePipe, LogoComponent],
  templateUrl: './update-required.component.html',
  styleUrl: './update-required.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateRequiredComponent {
  private readonly version = inject(AppVersionService);

  reload(): void {
    this.version.reload();
  }
}
