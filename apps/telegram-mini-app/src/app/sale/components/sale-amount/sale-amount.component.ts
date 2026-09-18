import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MIN_USDT_AMOUNT } from '@transacto/contracts';
import { TranslatePipe } from '@ngx-translate/core';
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe';
import { SalePricingService } from '../../services/sale-pricing.service';
import { SaleSubmitService } from '../../services/sale-submit.service';

/**
 * How much USDT is being sold, and the four figures that decide whether it can be.
 *
 * **The same block on both sale forms, and it was written twice.** The amount
 * field, the rate, the floor, the balance, the parallel-sale allowance and the
 * total underneath are not the jar's or the card's — they are the sale's, and
 * the two variants differ in where the hryvnia goes rather than in what is being
 * sold. Keeping two copies is how the two screens came to state the same rule in
 * different units once already.
 *
 * It reads {@link SalePricingService} and {@link SaleSubmitService} from the
 * route rather than taking inputs: both forms provide them, both provide the
 * same instance to this component, and threading a dozen signals through inputs
 * would be the duplication moved rather than removed.
 *
 * What each form still owns is the *sentence* it says when a figure refuses the
 * order — the jar has to explain a slot held by an open jar, which the card has
 * no equivalent of — so those are projected in, immediately under the figures
 * they are about.
 */
@Component({
  selector: 'app-sale-amount',
  imports: [FormsModule, TranslatePipe, UahPipe, UsdtPipe, ExchangeRateComponent],
  templateUrl: './sale-amount.component.html',
  styleUrl: './sale-amount.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleAmountComponent {
  readonly pricing = inject(SalePricingService);
  readonly submit = inject(SaleSubmitService);

  /** Named on screen rather than only enforced — see the pricing service. */
  protected readonly minOrderUsdt = MIN_USDT_AMOUNT;
}
