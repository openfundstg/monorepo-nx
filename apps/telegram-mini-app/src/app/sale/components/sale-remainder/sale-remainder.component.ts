import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { SaleMethod, SaleRemainderPolicy } from '@transacto/contracts';
import { TranslatePipe } from '@ngx-translate/core';
import { TmaService } from '../../../auth/services/tma.service';
import { remainderPolicyOptions, type RemainderPolicyOption } from '../../constants/sale-create.const';
import { SalePricingService } from '../../services/sale-pricing.service';

/**
 * What happens to a tail no payment can cover.
 *
 * **Both sale variants end the same way and the question belongs to both.** A
 * sale is finished when what is left is smaller than the pipeline will route,
 * and from there it either comes back as USDT or waits for somebody to pay it
 * in by hand. Which of those it is has nothing to do with whether the hryvnia
 * arrived in a jar or on a card — so a picker that existed only on the jar form
 * was a question the card form silently answered for the user.
 *
 * It answered it with the server's default, `WAIT_FOR_TOP_UP`, which on a card
 * sale means an operator transferring the last few hryvnia by hand. Nobody had
 * asked for that.
 *
 * The selection is a `model()`, so each form owns the value and this owns the
 * asking — the pattern the bank picker would use if it were extracted too.
 *
 * **What is on offer is not the same on both, and the method input is why.**
 * Waiting is an ending a jar sale cannot be given yet, so that row arrives
 * greyed and badged from {@link remainderPolicyOptions} — which reads the same
 * contract rule the server refuses by, rather than a second list kept in step
 * by hand.
 */
@Component({
  selector: 'app-sale-remainder',
  imports: [TranslatePipe],
  templateUrl: './sale-remainder.component.html',
  styleUrl: './sale-remainder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleRemainderComponent {
  private readonly tma = inject(TmaService);

  /** The floor the "return anything under ₴X" copy names, from the priced config. */
  readonly pricing = inject(SalePricingService);

  /** Which sale is asking — it decides what the picker may offer. */
  readonly method = input.required<SaleMethod>();

  readonly policy = model.required<SaleRemainderPolicy>();

  protected readonly options = computed(() => remainderPolicyOptions(this.method()));

  /**
   * `pointer-events: none` on the greyed row already stops the tap, and this
   * refuses it again.
   *
   * Belt and braces on purpose: the stylesheet is what a user meets and this is
   * what holds when a rule changes — the bank picker keeps the same pair, and
   * the comment on `.bank-option.unavailable` says which of the two makes the
   * grey mean something.
   */
  protected select(option: RemainderPolicyOption): void {
    if (option.comingSoon || option.policy === this.policy()) return;

    this.policy.set(option.policy);
    this.tma.hapticFeedback('light');
  }
}
