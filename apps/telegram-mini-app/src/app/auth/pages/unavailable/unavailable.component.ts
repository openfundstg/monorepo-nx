import { ChangeDetectionStrategy, Component } from '@angular/core'
import { TranslatePipe } from '@ngx-translate/core'
import { LogoComponent } from '../../../shared/components/logo/logo.component'
import { environment } from '../../../../environments/environment'

/**
 * What somebody sees when the app was not opened from Telegram.
 *
 * Deliberately says almost nothing. It is the only screen the open internet can
 * reach, so it carries no balances, no rates and no product vocabulary — a bare
 * "open this in Telegram" and a link to the bot.
 *
 * It does now carry the mark, which it previously did not. That is a considered
 * relaxation rather than an oversight: the name is already on the bot anyone
 * following the link lands on, and a stranger who reaches this page learns who
 * the app belongs to and still nothing about what it does. Everything else on
 * the "no hint of what is behind it" list stands.
 *
 * It is also the screen a *verified* user must never see, which is why
 * `anonymousGuard` sits on its route.
 */
@Component({
  selector: 'app-unavailable',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LogoComponent],
  templateUrl: './unavailable.component.html',
  styleUrl: './unavailable.component.scss'
})
export class UnavailableComponent {
  /** Empty when no bot is configured, in which case no link is offered. */
  readonly botUrl = environment.botUrl
}
