import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The step between tapping "cancel" and giving the payout back.
 *
 * Cancelling is not undoable and it is not free: the payout returns to
 * Transacto's book and another trader may take it within seconds, so a user who
 * meant to keep it cannot simply reserve the same one again — and a user who
 * has *already transferred* and taps this out of impatience has given away the
 * payout their money is sitting against.
 *
 * Hence a confirmation with a sentence rather than a bare button, matching
 * {@link ConfirmFiatAmountModal} on the way in. Presentational only: it decides
 * nothing and reports which button was pressed.
 */
@Component({
  selector: 'app-confirm-fiat-cancel',
  imports: [TranslatePipe],
  templateUrl: './confirm-fiat-cancel.modal.html',
  styleUrl: './confirm-fiat-cancel.modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmFiatCancelModal {
  /** While the cancellation is in flight: both buttons stop answering. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly dismissed = output<void>();

  /** The backdrop dismisses, except while the cancellation is in flight. */
  onBackdrop(): void {
    if (!this.busy()) this.dismissed.emit();
  }
}
