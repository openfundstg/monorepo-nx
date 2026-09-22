import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SaleMethod, type SaleTailProgress } from '@transacto/contracts';
import { TranslatePipe } from '@ngx-translate/core';
import { DateTimePipe } from '../../../shared/pipes/date-time.pipe';
import { UahPipe } from '../../../shared/pipes/uah.pipe';

/**
 * The last stretch, and what the seller can do about it.
 *
 * **It exists because the seller is owed an explanation.** From their side the
 * sale simply stops: the bar is nearly full, no new payer arrives, and nothing
 * says why. What is happening is that the gap left is smaller than the payment
 * system will route an order for, so it can only come as one transfer somebody
 * makes by hand — which is a different kind of waiting from every other pause
 * in this product, and the only one with no clock a payer is running.
 *
 * So the block says three things in the order they matter: how much is left,
 * that one more transfer is coming and has no deadline, and which of the two
 * things standing between the seller and their money is theirs to do.
 *
 * Its own component rather than more of `sale-status`, which is already 800
 * lines — and because the page renders the stop card twice, so a block placed
 * inline would have wanted to be too.
 */
@Component({
  selector: 'app-sale-tail',
  imports: [TranslatePipe, UahPipe, DateTimePipe],
  templateUrl: './sale-tail.component.html',
  styleUrl: './sale-tail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleTailComponent {
  readonly tail = input.required<SaleTailProgress>();

  /**
   * Which variant this is, and it decides whether there is anything to confirm.
   *
   * A jar sale's tail is *seen* rather than reported — the scraper reads the
   * balance, so the transfer arrives on its own and the sale closes without
   * anybody tapping anything. Offering the button there would be offering to
   * credit the same hryvnia twice, and the endpoint refuses it.
   */
  readonly method = input.required<SaleMethod>();

  /** A call is in flight; both buttons wait for it rather than racing. */
  readonly busy = input(false);

  readonly confirmTail = output<void>();
  readonly releaseTail = output<void>();

  protected readonly SaleMethod = SaleMethod;

  /**
   * Whether the seller has a button to say the transfer landed.
   *
   * Card sales only, and not before an operator has been asked: a tail still
   * held for a statement of the seller's own has nobody transferring anything
   * yet, so a "it arrived" button would be asking them to confirm a payment
   * nobody has been asked to make.
   */
  protected readonly canConfirm = computed(
    () => this.method() === SaleMethod.CARD && this.tail().announced,
  );
}
