import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TmaService } from '../../../auth/services/tma.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe';
import { SalePricingService } from '../../services/sale-pricing.service';

/**
 * "The rate moved", said where the sale is confirmed.
 *
 * **Placed directly above the confirm button on both forms**, not beside the
 * figures it is about. The forms are long, and a seller is at the bottom of one
 * when they commit; a notice at the top would move the numbers under a thumb
 * already on its way to the button, and say so somewhere nobody was looking.
 *
 * It names the rate it moved from and to, and — when the move reached them —
 * the figures before and after, so nothing needs working out. What a form can
 * *do* about it is projected in: the jar form offers to pull the amount up to
 * its jar's goal, which the card form has no equivalent of.
 *
 * Reads {@link SalePricingService} from the route, like the amount block,
 * rather than taking inputs: both forms provide it, and a move is a fact about
 * the price rather than about either form.
 */
@Component({
  selector: 'app-sale-rate-notice',
  imports: [TranslatePipe, UahPipe, UsdtPipe],
  templateUrl: './sale-rate-notice.component.html',
  styleUrl: './sale-rate-notice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleRateNoticeComponent {
  readonly pricing = inject(SalePricingService);
  private readonly tma = inject(TmaService);

  /**
   * Whether the move reached the figures as well as the rate.
   *
   * It often does not: a kopeck on the rate is ten on a ten-USDT total, which
   * leaves a whole-hryvnia total where it was more often than not. The rate is
   * news either way; a line saying the amounts went from X to X is not.
   */
  readonly amountsMoved = computed(() => {
    const change = this.pricing.rateChange();

    return (
      change !== null &&
      change.targetKopecks > 0 &&
      (change.targetKopecks !== this.pricing.targetKopecks() ||
        change.stakeCents !== this.pricing.stakeCents())
    );
  });

  /**
   * A buzz for every move reported — the screen changed under the seller
   * without their touching it, which is exactly what a haptic is for.
   */
  private readonly announce = effect(() => {
    if (this.pricing.rateChange() !== null) this.tma.hapticFeedback('warning');
  });
}
