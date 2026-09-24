import { ChangeDetectionStrategy, Component, signal, inject, OnInit, computed } from '@angular/core'
import { Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { NgTemplateOutlet } from '@angular/common'
import {
  BankProvider,
  disclosesCardNumber,
  isSaleBankEnabled,
  cardDigits,
  isGoalWithinTolerance,
  isSameCardNumber,
  matchesMaskedCard,
  priceSale,
  roundToWholeUah,
  SaleMethod,
  SaleRemainderPolicy,
} from '@transacto/contracts'
import { TranslatePipe } from '@ngx-translate/core'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { BANK_NAME_KEY } from '../../../shared/constants/bank-name.const'
import { SaleService } from '../../services/sale.service'
import { SalePricingService } from '../../services/sale-pricing.service'
import { SaleSubmitService } from '../../services/sale-submit.service'
import { SaleAmountComponent } from '../../components/sale-amount/sale-amount.component'
import { SaleRateNoticeComponent } from '../../components/sale-rate-notice/sale-rate-notice.component'
import { SaleRemainderComponent } from '../../components/sale-remainder/sale-remainder.component'
import { TmaService } from '../../../auth/services/tma.service'
import { UahPipe } from '../../../shared/pipes/uah.pipe'
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe'
import { BankInstructionsComponent } from '../../components/bank-instructions/bank-instructions.component'
import {
  CARD_NUMBER_LENGTH,
  DEFAULT_BANK,
  DEFAULT_REMAINDER_POLICY,
  SALE_BANKS,
} from '../../constants/sale-create.const'
import { MetaPixelService } from '../../../shared/services/meta-pixel.service'
import { TrackTapDirective } from '../../../shared/directives/track-tap.directive'
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component'
import { PixelTapEvent } from '../../../shared/enums/pixel-event.enum'

@Component({
  selector: 'app-sale-create',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    TranslatePipe,
    UahPipe,
    UsdtPipe,
    BankInstructionsComponent,
    TrackTapDirective,
    ExchangeRateComponent, SaleAmountComponent, SaleRateNoticeComponent, SaleRemainderComponent],
  // Route-scoped state: two sale forms must not inherit each other's amount.
  providers: [SalePricingService, SaleSubmitService],
  templateUrl: './sale-create.component.html',
  styleUrl: './sale-create.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SaleCreateComponent implements OnInit {
  private readonly router = inject(Router)
  private readonly apiError = inject(ApiErrorService)
  private readonly metaPixel = inject(MetaPixelService)
  private readonly saleService = inject(SaleService)
  private readonly tma = inject(TmaService)

  /**
   * Everything both sale forms share — the config, the price and the three
   * refusals derived from them.
   *
   * It moved out of this component when the card form arrived and copied it:
   * the two had one statement of the price between them and two of everything
   * around it, and two of those copies had already drifted apart. What stays
   * here is what a jar sale asks that a card sale does not.
   */
  readonly pricing = inject(SalePricingService)

  readonly selectedBank = signal<BankProvider>(DEFAULT_BANK)

  /**
   * The picker, in priority order — see {@link SALE_BANKS}. Rendered with
   * `@for` rather than one block per bank, so the order and the recommended
   * badge are data rather than a template that has to be re-edited to reorder.
   */
  protected readonly banks = SALE_BANKS
  /** Exposed so the template can compare against enum members, not literals. */
  protected readonly BankProvider = BankProvider
  /** Which sale this form creates — the remainder picker asks. */
  protected readonly SaleMethod = SaleMethod
  protected readonly PixelTapEvent = PixelTapEvent

  /**
   * Both read straight from the contract the server enforces, rather than from
   * a list kept here. A picker offering a bank the server refuses would let a
   * user fill in a whole form for nothing.
   */
  protected readonly isBankEnabled = isSaleBankEnabled
  protected readonly bankDisclosesCard = disclosesCardNumber

  readonly dropLink = signal('')
  readonly cardNumber = signal('')

  /**
   * What to do with a tail no payment can cover.
   *
   * Starts on the first policy the picker actually offers — see
   * {@link DEFAULT_REMAINDER_POLICY} — and is sent on every order, so what the
   * screen shows and what the server stores cannot come apart on a default.
   */
  readonly remainderPolicy = signal<SaleRemainderPolicy>(DEFAULT_REMAINDER_POLICY)
  /** The submit half both forms share — the post, the recovery, the two flags. */
  readonly submit = inject(SaleSubmitService)

  /** In flight while the backend follows the bank's redirects. */
  readonly resolvingLink = signal(false)
  /** Set when resolution actually rewrote the link, so the UI can say so. */
  readonly linkResolved = signal(false)
  /** Why the pasted link was rejected, already translated. */
  readonly linkError = signal('')

  /**
   * The jar's own target, as the bank reports it, in UAH kopecks.
   *
   * Filled by the resolve step, so the mismatch is caught the moment the link
   * is pasted rather than at submit — the user is still in their bank app and
   * can fix the goal there and then. `null` means the bank did not tell us,
   * which is never treated as a mismatch.
   */
  readonly jarGoal = signal<number | null>(null)

  /**
   * The drop's owner as the bank reports them — masked, e.g. "Петренко І.".
   *
   * Shown so a user can see whose account they are about to point at. Surname
   * and an initial is all any Ukrainian bank discloses, so it is a sanity check
   * for the person reading it, never an identity we act on.
   */
  readonly dropOwner = signal<string | null>(null)

  /**
   * The card the drop pays into as PUMB publishes it — `53552800****0000`.
   *
   * Not a value the field can be filled from: four digits are missing and a
   * mask cannot be paid into. It is here to check what the user types, and to
   * show them which card they are supposed to be typing.
   */
  readonly dropCardMask = signal<string | null>(null)

  /**
   * The card the drop actually pays into, as the bank reports it.
   *
   * Kept as well as written into the field. Filling the input in is a
   * convenience the user can type over; keeping the bank's own answer is what
   * lets the two be compared afterwards. Without it a corrected card was only
   * caught by the server, at submit, after the user had left their bank app.
   *
   * `null` for every bank that names no card — Monobank and PUMB disclose none,
   * so there is nothing to check against and nothing is claimed.
   */
  readonly dropCardNumber = signal<string | null>(null)

  /**
   * Kept as a `computed` rather than decided once at resolve time: the user can
   * change the amount *after* pasting the link, and a verdict frozen at paste
   * time would then be about a total that no longer exists.
   */
  readonly goalMismatch = computed(() => {
    const goal = this.jarGoal()

    return goal !== null && !isGoalWithinTolerance(goal, this.pricing.targetKopecks())
  })

  /**
   * What pulling the amount up to the jar's goal would stake, in USDT cents.
   *
   * The check was reactive from the start — it recomputes on every keystroke —
   * but being told "your target is ₴930 and the jar wants ₴800" left the user
   * solving for the amount by hand, at a rate they cannot see, with the profit
   * percentage folded in. Most of them simply retyped numbers until they gave
   * up, which reads exactly like an error that will not clear.
   *
   * `priceSale` is the server's own pricing run backwards: hand it the
   * goal as the target and it answers with the stake that buys it. Using it
   * rather than solving the arithmetic again here is what keeps the offer, the
   * held total it produces and the server's stake from disagreeing — see its
   * own doc comment on why one calculation is not written twice in this
   * repository.
   *
   * `null` when there is no goal to aim at, which is every bank that does not
   * publish one and every moment before a link resolves.
   */
  readonly suggestedUsdtCents = computed(() => {
    const goal = this.jarGoal()
    if (goal === null || this.pricing.sellRateKopecks() <= 0) return null

    const cents = priceSale(goal, this.pricing.sellRateKopecks())
      .requiredUsdtCents

    return cents > 0 ? cents : null
  })

  /**
   * Whether the jar's goal and this sale's total are different figures at all,
   * the goal check's tolerance aside.
   *
   * The pull-up is offered on this rather than on {@link goalMismatch}: a jar a
   * hryvnia off the total passes that check and is still not the sale being
   * made, and the point of the offer is that the seller never has to choose
   * between the two — least of all after the rate has moved the total off a
   * goal they set a minute ago.
   */
  readonly goalDiffers = computed(() => {
    const goal = this.jarGoal()

    return goal !== null && roundToWholeUah(goal) !== this.pricing.targetKopecks()
  })

  /**
   * Whether the total is held at the jar's goal — the state the pull-up leaves
   * the form in, where a move in the rate re-derives the USDT rather than the
   * total. Said on screen, or the USDT changing by itself would look like the
   * very thing this replaced.
   */
  readonly heldAtGoal = computed(() => {
    const goal = this.jarGoal()
    const held = this.pricing.heldTargetKopecks()

    return goal !== null && held !== null && held === roundToWholeUah(goal)
  })

  /**
   * Whether the card typed is a different card from the one the drop pays into.
   *
   * The same comparison the server makes, from the same function, for the same
   * reason it is a `computed` and not a verdict taken at resolve time: the user
   * can edit the field afterwards, and a check frozen at paste time would be
   * about a number that is no longer on screen.
   *
   * Silent until the field holds a whole card. Sixteen digits arrive one
   * keystroke at a time, and calling every prefix a mismatch would put an error
   * under the input for the entire time it is being filled in.
   */
  readonly cardMismatch = computed(() => {
    const fromBank = this.dropCardNumber()
    const mask = this.dropCardMask()
    const typed = cardDigits(this.cardNumber())

    if (typed.length < CARD_NUMBER_LENGTH) return false

    // A bank that names the whole card is checked against the card; one that
    // publishes part of it is checked against what it published. The server
    // applies exactly these two rules, from the same two helpers.
    if (fromBank !== null) return !isSameCardNumber(fromBank, typed)
    if (mask !== null) return !matchesMaskedCard(typed, mask)

    return false
  })

  /**
   * Whether a complete card fits what a masking bank published.
   *
   * Only ever rendered as a tick. The mask itself stays on the server side of
   * the conversation: it is twelve of sixteen digits, and a screen that printed
   * it would let anyone holding a share link read most of the account off it.
   */
  readonly cardMatchesMask = computed(() => {
    const mask = this.dropCardMask()
    const typed = cardDigits(this.cardNumber())

    return mask !== null && typed.length === CARD_NUMBER_LENGTH && matchesMaskedCard(typed, mask)
  })

  /**
   * The last value handed to the resolver.
   *
   * Blur fires on every focus change, including one that did not touch the
   * field, so without this the same link is re-resolved on the way past.
   */
  private lastResolvedInput = ''

  /**
   * Whether the trust level's allowance is already spent.
   *
   * `maxParallelOrders()` starts at 0, which would read as "no slots" before the
   * config lands and grey out the form on every load. Nothing is exhausted
   * until the server has actually said what the allowance is.
   */
  /**
   * Whether the selected bank names the card its link pays into.
   *
   * When it does, the card is not the user's to supply: the field is filled in
   * from the link and locked, and the server takes the bank's answer regardless
   * of what is submitted. Typing sixteen digits off a phone screen was the step
   * this form got wrong most often, and every one of those failures was
   * avoidable for a bank that was telling us the answer all along.
   */
  /**
   * An amount that has been typed and is under the floor.
   *
   * `> 0` on purpose: an empty field is not a mistake, and putting an error
   * under the input before anything has been entered would greet every user
   * with a complaint. The rule itself was always enforced — `isValid()` refuses
   * and the server answers 1314 — but nothing on the screen said so, so a user
   * who typed 5 saw a dead button and no reason for it.
   */
  readonly cardIsFromBank = computed(() => this.bankDisclosesCard(this.selectedBank()))

  /**
   * A bank that should have named a card, on a link that resolved without one.
   *
   * There is nothing to fall back to — the server refuses such an order — so
   * this is a dead end the user has to fix by changing the link, and saying so
   * here is the only way they can know that.
   */
  readonly cardUnavailable = computed(
    () => this.cardIsFromBank() && this.linkResolved() && this.dropCardNumber() === null
  )

  /**
   * Whether the trust level's allowance is already spent.
   *
   * `maxParallelOrders()` starts at 0, which would read as "no slots" before the
   * config lands and grey out the form on every load. Nothing is exhausted
   * until the server has actually said what the allowance is.
   */
  /**
   * Whether an open jar is the reason — the only reason the user can act on.
   *
   * The two causes need different sentences: slots held by sales that are
   * *running* clear themselves, and there is nothing to do but wait; slots held
   * by sales that are *finished* clear only when their owner closes the jar,
   * and nothing at all happens until they do. Telling somebody to wait for the
   * second is telling them to wait forever.
   */
  readonly blockedByOpenJars = computed(
    () => this.pricing.slotsExhausted() && this.pricing.awaitingJarClosure().length > 0
  )

  /** Slots held by sales that really are still running. */
  readonly runningOrders = computed(() =>
    Math.max(0, this.pricing.openOrders() - this.pricing.awaitingJarClosure().length)
  )

  /**
   * USDT cents the server will freeze — the pricing service's own figure, not
   * a second derivation of it.
   *
   * This screen used to price the order again from the total, and a figure
   * worked out twice is a figure that can disagree with itself: it did, by a
   * cent, and that put a user's whole balance out of reach. The units are the
   * other half of the point — `targetKopecks()` is kopecks and `balanceCents()`
   * is USDT cents, and comparing those two directly is wrong by roughly the
   * exchange rate, a mistake this screen has made before.
   */
  readonly requiredCents = computed(() => this.pricing.stakeCents())

  readonly isValid = computed(() => {
    const link = this.dropLink().trim()
    const card = this.cardNumber().replace(/\D/g, '')

    return (
      // The rate, the floor, the balance and the allowance — the rules both
      // forms share, judged on the sale the server would actually take. No
      // rate, no quote: submitting would price the order at whatever the
      // server fetches, which is not the number the user was shown.
      //
      // It used to require the *typed* amount to reach ten on top, which
      // refused the jar's own pull-up: a goal of ₴481 at ₴48.19 is 9.98 USDT,
      // a sale the floor and the server both accept, beside a disabled button.
      this.pricing.isPriced() &&
      this.isBankEnabled(this.selectedBank()) &&
      // For a disclosing bank the card must have come from the bank. The
      // length check below passes on an auto-filled one, but would also pass
      // on a stale value left behind by a previous link.
      (!this.cardIsFromBank() || this.dropCardNumber() !== null) &&
      !this.goalMismatch() &&
      !this.cardMismatch() &&
      link.startsWith('http') &&
      card.length === CARD_NUMBER_LENGTH
    )
  })

  /** The label key for a bank — the same map the picker's own entries read. */
  bankNameKey(provider: BankProvider): string {
    return BANK_NAME_KEY[provider] ?? provider
  }

  /** Opens the finished sale whose jar is holding a slot. */
  openSale(saleId: string): void {
    void this.router.navigate(['/sale', saleId, 'status'])
  }

  ngOnInit(): void {
    this.tma.showBackButton(() => this.router.navigate(['/sale']))
    // Already fetched, by the route's resolver. Nothing is awaited here, so the
    // first frame this screen paints is the only one — no balance of 0.00 and
    // no refusal that corrects itself a moment later.
    this.pricing.seedFromRoute()
  }


  /**
   * Works out what the pasted link really points at, as soon as the field is
   * left alone.
   *
   * This is what removes the manual step for PUMB: its app shares a
   * `mobile-app.pumb.ua` short link, and the scraper needs the `box_id` that
   * only appears after a redirect. Users were told to open the link in a
   * browser and copy the address bar instead, which is the single most
   * error-prone instruction on this screen.
   *
   * A rejected link is reported here rather than at submit time, so the user
   * finds out while the bank app is still open next to them.
   */
  async onLinkBlur(): Promise<void> {
    const link = this.dropLink().trim()

    if (!link || link === this.lastResolvedInput) return
    this.lastResolvedInput = link

    this.resolvingLink.set(true)
    this.linkResolved.set(false)
    this.linkError.set('')

    try {
      const {
        link: resolved,
        resolved: didResolve,
        goal,
        cardNumber,
        cardNumberMask,
        ownerName,
      } = await this.saleService.resolveLink(this.selectedBank(), link)

      this.jarGoal.set(goal)
      this.dropOwner.set(ownerName)
      this.dropCardNumber.set(cardNumber)
      this.dropCardMask.set(cardNumberMask)
      // Filled in for them when the bank names the card the drop pays into.
      // Typing sixteen digits off a phone screen is the step this form got
      // wrong most often, and the server refuses a mismatch anyway — so the
      // only thing manual entry was adding here was a way to fail.
      if (cardNumber) this.cardNumber.set(cardNumber)
      this.dropLink.set(resolved)
      // Track the output too: the resolved link is what sits in the field now,
      // so a later blur must not send it back for a second, pointless round.
      this.lastResolvedInput = resolved
      this.linkResolved.set(didResolve)
      if (didResolve) this.tma.hapticFeedback('success')
    } catch (err: unknown) {
      // A failed resolve tells us nothing about the jar, so the previous goal
      // must not linger and keep validating against a link we no longer have.
      // The same goes for the owner; the card is left alone, since the user may
      // have typed it themselves and losing that would be rude.
      this.jarGoal.set(null)
      this.dropOwner.set(null)
      this.dropCardNumber.set(null)
      this.dropCardMask.set(null)
      // Left alone for a bank the user types the card for — losing what they
      // typed would be rude. Cleared for a bank that supplies it, where it is
      // not theirs and is now known to be wrong.
      if (this.cardIsFromBank()) this.cardNumber.set('')
      this.linkError.set(this.apiError.messageFor(err))
      this.tma.hapticFeedback('error')
    } finally {
      this.resolvingLink.set(false)
    }
  }

  /**
   * Switching banks invalidates any verdict already on screen: the same link is
   * usually wrong for the newly selected bank, and leaving a green "resolved"
   * note under it would be a lie.
   */
  /**
   * Pulls the amount up to the jar's goal, and keeps it there.
   *
   * The way out of a total that no longer matches the jar, and it moves the
   * half that is ours to move. The goal is set inside a banking app and takes a
   * minute to change — long enough for the rate to move again, which is the
   * loop users were stuck in — while the stake is a number on this screen. So
   * the goal stays and the USDT is derived from it, and from here on the total
   * is *held*: a later move re-derives the USDT again, and the notice above the
   * button says by how much. Typing an amount lets go.
   */
  pullUpToGoal(): void {
    const goal = this.jarGoal()
    if (goal === null) return

    this.pricing.holdTarget(goal)
    this.tma.hapticFeedback('light')
  }

  onSelectBank(bank: BankProvider): void {
    if (bank === this.selectedBank()) return
    // The picker greys these out; this is what makes the grey mean something.
    if (!this.isBankEnabled(bank)) return

    this.selectedBank.set(bank)
    this.linkResolved.set(false)
    this.linkError.set('')
    this.jarGoal.set(null)
    this.dropOwner.set(null)
    this.dropCardNumber.set(null)
    // A card filled in from the previous bank's link says nothing about this
    // one, and leaving it in a locked field would show an account this link
    // does not pay into.
    if (this.cardIsFromBank()) this.cardNumber.set('')
    this.lastResolvedInput = ''
  }

  async onSubmit(): Promise<void> {
    if (!this.isValid()) return

    // Where the money goes. The price — total, stake and rate — is the submit
    // service's to add, from the pricing service, so this screen cannot send
    // one figure priced differently from another.
    await this.submit.submit(() => ({
      bankType: this.selectedBank(),
      dropLink: this.dropLink().trim(),
      cardNumber: cardDigits(this.cardNumber()),
      remainderPolicy: this.remainderPolicy()
    }))
  }
}
