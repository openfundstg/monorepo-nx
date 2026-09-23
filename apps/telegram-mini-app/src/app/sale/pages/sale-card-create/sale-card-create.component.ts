import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import {
  BankProvider,
  CARD_NUMBER_LENGTH,
  cardDigits,
  formatCardNumber,
  isLuhnValid,
  MIN_RECEIVER_NAME_LENGTH,
  MIN_USDT_AMOUNT,
  SaleMethod,
  SaleRemainderPolicy,
  saleCardMaxOrders,
  saleCardMinOrderKopecks
} from '@transacto/contracts'
import { TranslatePipe } from '@ngx-translate/core'
import { TmaService } from '../../../auth/services/tma.service'
import { CARD_SALE_BANKS, DEFAULT_CARD_SALE_BANK } from '../../constants/sale-card-create.const'
import { DEFAULT_REMAINDER_POLICY } from '../../constants/sale-create.const'
import { CardInstructionsComponent } from '../../components/card-instructions/card-instructions.component'
import { SaleAmountComponent } from '../../components/sale-amount/sale-amount.component'
import { SaleRemainderComponent } from '../../components/sale-remainder/sale-remainder.component'
import { SalePricingService } from '../../services/sale-pricing.service'
import { SaleSubmitService } from '../../services/sale-submit.service'

/**
 * Selling USDT straight to the seller's own card.
 *
 * The jar form's mirror with every witness removed. There is no link to paste,
 * so no goal to match and no bank to name the card: the seller types sixteen
 * digits and the name on the card, and both are claims until a statement says
 * otherwise.
 *
 * **What this screen owes the user is that the deal is stated before they take
 * it.** A card sale asks something a jar sale never does — that they answer,
 * per payment, whether the money arrived — and the obligation, the number of
 * payments and the size of each are all named here rather than discovered
 * afterwards.
 */
@Component({
  selector: 'app-sale-card-create',
  imports: [
    FormsModule,
    TranslatePipe,
    CardInstructionsComponent,
    SaleAmountComponent,
    SaleRemainderComponent
  ],
  templateUrl: './sale-card-create.component.html',
  styleUrl: './sale-card-create.component.scss',
  // Route-scoped state: two sale forms must not inherit each other's amount.
  providers: [SalePricingService, SaleSubmitService],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SaleCardCreateComponent implements OnInit {
  private readonly router = inject(Router)
  private readonly tma = inject(TmaService)

  /**
   * Everything both sale forms share — the config, the price and the three
   * refusals derived from them. Provided by this route, so one form's amount
   * never reaches the other.
   */
  readonly pricing = inject(SalePricingService)

  readonly selectedBank = signal<BankProvider>(DEFAULT_CARD_SALE_BANK)
  readonly cardNumber = signal('')
  readonly receiverName = signal('')

  /**
   * What happens to a tail no payment can cover.
   *
   * Asked here as well as on the jar form, because a card sale ends the same
   * way. It was not, and the server's own default — wait for somebody to pay
   * the tail in by hand — was being chosen for people who had not been asked.
   */
  readonly remainderPolicy = signal<SaleRemainderPolicy>(DEFAULT_REMAINDER_POLICY)

  /** Which sale this form creates — the remainder picker asks. */
  protected readonly SaleMethod = SaleMethod

  /** Only the banks whose statements something can read — see the constant. */
  protected readonly banks = CARD_SALE_BANKS
  protected readonly minOrderUsdt = MIN_USDT_AMOUNT
  protected readonly cardLength = CARD_NUMBER_LENGTH

  /** The submit half both forms share — the post, the recovery, the three flags. */
  readonly submit = inject(SaleSubmitService)

  /**
   * How the sale will be split, named before it is agreed to.
   *
   * The same two functions that produce the credential's `min_amount` and
   * `max_tx_count_total` upstream. A screen computing these differently would
   * be describing a product that does not exist — which is the whole reason
   * they live in the contract rather than here.
   */
  readonly perOrderKopecks = computed(() =>
    saleCardMinOrderKopecks(this.pricing.targetKopecks(), this.pricing.minOrderKopecks())
  )

  readonly maxOrders = computed(() =>
    saleCardMaxOrders(this.pricing.targetKopecks(), this.pricing.minOrderKopecks())
  )

  /** The two things only a card sale asks for. */
  readonly cardComplete = computed(() => cardDigits(this.cardNumber()).length === CARD_NUMBER_LENGTH)

  /**
   * Sixteen digits that also agree with their own check digit.
   *
   * Luhn refuses a card, it never confirms one — but what it refuses is the
   * single mistyped or transposed digit, which is both the likeliest mistake on
   * this field and the most expensive: the payout goes to a number the seller
   * does not hold, and nothing downstream can tell that from a correct one.
   */
  readonly cardValid = computed(() => isLuhnValid(this.cardNumber()))

  /** Complete and wrong — the only state worth a sentence of its own. */
  readonly cardInvalid = computed(() => this.cardComplete() && !this.cardValid())

  readonly nameComplete = computed(
    () => this.receiverName().trim().length >= MIN_RECEIVER_NAME_LENGTH
  )

  readonly isValid = computed(
    () =>
      this.pricing.isPriced() &&
      this.cardValid() &&
      this.nameComplete() &&
      !this.submit.submitting()
  )

  /**
   * Regroups the field as it is typed.
   *
   * Written back to the element as well as to the signal, because the input is
   * bound one way: the value the user produced and the value this screen holds
   * are not the same string, and letting the DOM keep its own would put the
   * digits and the mask out of step on the next keystroke.
   */
  onCardInput(event: Event): void {
    const input = event.target as HTMLInputElement
    const formatted = formatCardNumber(input.value)

    input.value = formatted
    this.cardNumber.set(formatted)
  }

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/sale']))
    // Already fetched, by the route's resolver. Nothing is awaited here, so the
    // first frame this screen paints is the only one — no balance of 0.00 and
    // no refusal that corrects itself a moment later.
    this.pricing.seedFromRoute()
  }

  async onSubmit(): Promise<void> {
    if (!this.isValid()) return

    await this.submit.submit(() => ({
      saleMethod: SaleMethod.CARD,
      fiatAmount: this.pricing.targetKopecks(),
      bankType: this.selectedBank(),
      cardNumber: cardDigits(this.cardNumber()),
      receiverName: this.receiverName().trim(),
      remainderPolicy: this.remainderPolicy(),
      // The rate this total was worked out at. The market moves while a form is
      // being filled, and the server refuses a quote it has moved out from
      // under rather than freezing a stake against a target it never agreed.
      quotedRate: this.pricing.sellRateKopecks()
    }))
  }
}
