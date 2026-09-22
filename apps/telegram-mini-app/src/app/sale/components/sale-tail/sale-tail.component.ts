import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SaleMethod, type SaleTailProgress } from '@transacto/contracts';
import { TranslatePipe } from '@ngx-translate/core';
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
 * why, and where the transfer has got to — which is the part that moves. It has
 * three states and they are not decorations: nobody has been asked yet (a
 * statement of the seller's own is still outstanding), somebody has been asked,
 * and somebody has **taken it on**. Only the last is an order on its way, and
 * only the last is why the stop button has gone — for good, until the transfer
 * lands or support gives the gap back, which is why that state names support
 * rather than a time.
 *
 * Its own component rather than more of `sale-status`, which is already 800
 * lines — and because the page renders the stop card twice, so a block placed
 * inline would have wanted to be too.
 */
@Component({
  selector: 'app-sale-tail',
  imports: [TranslatePipe, UahPipe],
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

  /** The confirmation is in flight, so it says so rather than being tapped twice. */
  readonly busy = input(false);

  readonly confirmTail = output<void>();

  protected readonly SaleMethod = SaleMethod;

  /**
   * Whether the seller has a button to say the transfer landed.
   *
   * Card sales only, and not before an operator has **taken it on** — which is
   * stricter than having been asked, and deliberately so. An alert nobody has
   * answered has nobody going to their banking app, so an "it arrived" button
   * there would ask the seller to confirm a payment that was never started;
   * the endpoint refuses it with `TAIL_NOT_CLAIMED` for the same reason.
   */
  protected readonly canConfirm = computed(
    () => this.method() === SaleMethod.CARD && this.tail().claimed,
  );
}
