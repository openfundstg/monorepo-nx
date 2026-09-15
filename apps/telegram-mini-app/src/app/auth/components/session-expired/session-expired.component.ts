import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TmaService } from '../../services/tma.service';
import { LogoComponent } from '../../../shared/components/logo/logo.component';

/**
 * The screen for a launch whose credential has aged out.
 *
 * Modelled on `UpdateRequiredComponent` — undismissable, painted over
 * everything — because it reports the same kind of fact: the app on screen
 * cannot be worked with any more. What differs is the only sentence that
 * matters, and it is the reason this could not simply reuse that screen.
 *
 * **It must not offer a reload.** `initData` lives in the launch URL's
 * fragment, so reloading re-reads the same one, fails `POST /auth` and lands
 * the user on the "open this in Telegram" gate — a worse screen than the one
 * they started on, reached by pressing the button we gave them. The only thing
 * that mints a new `auth_date` is a new launch, so the button closes the app
 * and the text asks them to open it again.
 *
 * `close()` is not guaranteed: an older client, or a Mini App opened somewhere
 * the SDK is not present, simply does nothing. The instruction is therefore in
 * the text rather than only in the button — a user who reads it can act on it
 * whether or not the button works.
 */
@Component({
  selector: 'app-session-expired',
  imports: [TranslatePipe, LogoComponent],
  templateUrl: './session-expired.component.html',
  styleUrl: './session-expired.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionExpiredComponent {
  private readonly tma = inject(TmaService);

  close(): void {
    this.tma.close();
  }
}
