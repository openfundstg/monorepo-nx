import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe';
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component';

/**
 * The step between tapping an amount and being committed to it.
 *
 * Reserving is not like the other buttons in this app. It takes a stranger's
 * payout out of Transacto's book **in the user's name**, starts a clock, and
 * blocks them from reserving anything else until it ends — and the way out of
 * one they did not mean to take is to wait it out or cancel, neither of which
 * is free. Before this, a mis-tap on a scrolling list of sums did all of that
 * with no way back.
 *
 * So it restates what the tap actually buys: the exact hryvnia to transfer, the
 * USDT it credits, the rate behind the pair, and how long they will have. The
 * figures are the ones the server priced — passed in, never recomputed here —
 * so this dialog cannot quote a different number from the list behind it.
 *
 * Presentational only. It decides nothing and calls nothing: the page owns the
 * reservation, and this reports which button was pressed.
 */
@Component({
  selector: 'app-confirm-fiat-amount',
  imports: [TranslatePipe, UahPipe, UsdtPipe, ExchangeRateComponent],
  templateUrl: './confirm-fiat-amount.modal.html',
  styleUrl: './confirm-fiat-amount.modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmFiatAmountModal {
  /** The exact sum to transfer, in UAH kopecks. */
  readonly amountUah = input.required<number>();
  /** What it credits, in USDT cents, as the server priced it. */
  readonly cryptoCents = input.required<number>();
  /** Kopecks per USDT — the discounted top-up rate, not the market one. */
  readonly exchangeRate = input.required<number | null>();
  /** Minutes to pay once the payout is theirs. */
  readonly payWindowMinutes = input.required<number>();
  /** While the reservation is in flight: both buttons stop answering. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly dismissed = output<void>();

  /**
   * The backdrop cancels, except while a reservation is in flight.
   *
   * Dismissing then would leave the user on the list with a payout being taken
   * in their name behind it — the screen and the truth pointing different ways.
   */
  onBackdrop(): void {
    if (!this.busy()) this.dismissed.emit();
  }
}
