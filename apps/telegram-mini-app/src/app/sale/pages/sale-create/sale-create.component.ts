import { ChangeDetectionStrategy, Component, signal, inject, OnInit, computed } from '@angular/core'
import { Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import {
  BankProvider,
  disclosesCardNumber,
  ERROR,
  isSaleBankEnabled,
  cardDigits,
  isGoalWithinTolerance,
  isSameCardNumber,
  matchesMaskedCard,
  CENTS_PER_USDT,
  priceSale,
  type SaleAwaitingJar,
  SaleRemainderPolicy,
  targetForStake,
} from '@transacto/contracts'
import { TranslatePipe } from '@ngx-translate/core'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { BANK_NAME_KEY } from '../../../shared/constants/bank-name.const'
import { SaleService } from '../../services/sale.service'
import { TmaService } from '../../../auth/services/tma.service'
import { UahPipe } from '../../../shared/pipes/uah.pipe'
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe'
import { BankInstructionsComponent } from '../../components/bank-instructions/bank-instructions.component'
import {
  CARD_NUMBER_LENGTH,
  DEFAULT_BANK,
  DEFAULT_MIN_ORDER_KOPECKS,
  DEFAULT_REMAINDER_POLICY,
  MIN_ORDER_USDT,
  REMAINDER_POLICY_OPTIONS,
  SALE_BANKS,
  isRemainderPolicyEnabled,
} from '../../constants/sale-create.const'
import { MetaPixelService } from '../../../shared/services/meta-pixel.service'
import { PixelStandardEvent } from '../../../shared/enums/pixel-event.enum'
import { TrackTapDirective } from '../../../shared/directives/track-tap.directive'
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component'
import { PixelTapEvent } from '../../../shared/enums/pixel-event.enum'

@Component({
  selector: 'app-sale-create',
  imports: [
    FormsModule,
    TranslatePipe,
    UahPipe,
    UsdtPipe,
    BankInstructionsComponent,
    TrackTapDirective,
    ExchangeRateComponent
  ],
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

  readonly usdtAmount = signal<number | null>(null)
  readonly selectedBank = signal<BankProvider>(DEFAULT_BANK)
  /**
   * The picker, in priority order — see {@link SALE_BANKS}. Rendered
   * with `@for` rather than one block per bank, so the order and the recommended
   * badge are data rather than a template that has to be re-edited to reorder.
   */
  protected readonly banks = SALE_BANKS
  /** Exposed so the template can compare against enum members, not literals. */
  protected readonly BankProvider = BankProvider
  protected readonly PixelTapEvent = PixelTapEvent

  /**
   * Both read straight from the contract the server enforces, rather than
   * from a list kept here. A picker offering a bank the server refuses would
   * let a user fill in a whole form for nothing.
   */
  /** The floor, named on screen rather than only enforced. */
  protected readonly minOrderUsdt = MIN_ORDER_USDT

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
  /** The picker, in the order it is rendered — see {@link REMAINDER_POLICY_OPTIONS}. */
  protected readonly remainderOptions = REMAINDER_POLICY_OPTIONS

  /**
   * The smallest order the pipeline will route, in UAH kopecks.
   *
   * Seeded from the contract and replaced by `GET /sales/config`, which
   * carries whatever the server is actually configured with. The screen quotes
   * this figure to the user — "anything under ₴300 comes back" — so a stale copy
   * would be describing a different offer from the one the server settles.
   */
  readonly minOrderKopecks = signal(DEFAULT_MIN_ORDER_KOPECKS)

  /** Seeded from `GET /sales/config`; the literal is only a first paint. */
  /**
   * How many sales this user's trust level allows at once, and how many
   * of those are already running.
   *
   * Both come from `GET /sales/config`, so the form can refuse before a
   * round trip rather than after the user has filled in a link, a card and an
   * amount. The server checks again under a lock — this is the courtesy, not
   * the enforcement.
   */
  readonly maxParallelOrders = signal(0)
  readonly openOrders = signal(0)
  /**
   * The finished sales among those, and the jars still holding their slots.
   *
   * Kept as rows rather than a count because a count cannot be explained. A
   * user whose only sale finished an hour ago reads "1 / 1 active" as a bug in
   * the product — they can see nothing is running — and "finish the current
   * one" as advice for a sale that is already finished. Naming the sale and its
   * bank turns both into an instruction they can act on.
   */
  readonly awaitingJarClosure = signal<readonly SaleAwaitingJar[]>([])
  /**
   * Kopecks per USDT, and 0 until the server says otherwise.
   *
   * It used to start at a hardcoded ₴46.52. That was a third price in a system
   * that should have one: the screen quoted it for a beat on every load, and
   * kept quoting it for the whole session whenever the config call failed —
   * while the order the server actually wrote priced off the live market.
   */
  readonly sellRateKopecks = signal(0)
  /** The market could not be reached, so nothing on this screen can be priced. */
  readonly rateUnavailable = signal(false)
  /**
   * The caller's **available** USDT cents, straight from the same config call —
   * `freezeBalance` is already subtracted server-side, so no second request and
   * no local arithmetic is needed to get to a spendable figure.
   */
  readonly balanceCents = signal(0)
  readonly submitting = signal(false)
  readonly errorMsg = signal('')
  /**
   * The submit was refused because the market moved, and the rate on screen has
   * since been re-read.
   *
   * Its own flag rather than a reading of `errorMsg`: the message is a
   * translated sentence and matching on one would break the day it is reworded.
   * Cleared by taking the new amount, or by editing the one on screen — either
   * way the user has answered it.
   */
  readonly rateMoved = signal(false)

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

    return goal !== null && !isGoalWithinTolerance(goal, this.targetKopecks())
  })

  /**
   * The stake that would make the target land on the jar's own goal, in USDT.
   *
   * The check was reactive from the start — it recomputes on every keystroke —
   * but being told "your target is ₴930 and the jar wants ₴800" left the user
   * solving for the amount by hand, at a rate they cannot see, with the profit
   * percentage folded in. Most of them simply retyped numbers until they gave
   * up, which reads exactly like an error that will not clear.
   *
   * `priceSale` is the server's own pricing run backwards: hand it the
   * goal as the target and it answers with the stake that buys it. Using it
   * rather than solving the arithmetic again here is what keeps the suggestion
   * and the check from disagreeing — see its own doc comment on why one
   * calculation is not written twice in this repository.
   *
   * `null` when there is no goal to aim at, which is every bank that does not
   * publish one and every moment before a link resolves.
   */
  readonly suggestedUsdtCents = computed(() => {
    const goal = this.jarGoal()
    if (goal === null || this.sellRateKopecks() <= 0) return null

    const cents = priceSale(goal, this.sellRateKopecks())
      .requiredUsdtCents

    return cents > 0 ? cents : null
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
   * The three figures on the maths preview, all whole hryvnia.
   *
   * Whole hryvnia because the target is the goal the user types into their
   * bank, and banks take hryvnia — a target of ₴9 490,08 is one nobody can
   * enter, and the backend blocks an order whose jar target does not match.
   * Deriving the other two from the quantised target rather than quantising
   * each separately is what keeps the preview's own arithmetic adding up on
   * screen.
   *
   * **Down, not to nearest** — see `floorToWholeUah` in contracts. The stake is
   * derived back out of the target, so a target rounded *up* quotes a stake
   * above the USDT the user typed. On roughly 29% of possible balances that
   * put the full balance one cent out of reach: a user holding 10,02 USDT
   * could stake at most 10,01. Only whole USDT amounts were ever immune.
   *
   * Mirrors `SaleFacadeService` step for step, via the same shared
   * helpers: if the two ever disagreed, the quote shown here would freeze a
   * different stake than the one the server takes.
   */
  /**
   * The order's money, all of it, from one shared calculation.
   *
   * `priceSale` and `targetForStake` in `@transacto/contracts` are the
   * only statement of this arithmetic. This screen used to re-derive every
   * figure and carried a comment promising it mirrored the server "step for
   * step" — which is how the quote shown and the stake taken came to disagree
   * by a cent, putting a user's whole balance out of reach.
   *
   * Whole hryvnia because the target is the goal the user types into their
   * bank, and banks take hryvnia — ₴9 490,08 is a figure nobody can enter, and
   * the backend blocks an order whose jar target does not match.
   */
  readonly targetKopecks = computed(() =>
    targetForStake(this.usdtAmount() ?? 0, this.sellRateKopecks()),
  )

  readonly quote = computed(() => priceSale(this.targetKopecks(), this.sellRateKopecks()))

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
  readonly belowMinimum = computed(() => {
    const amount = this.usdtAmount() ?? 0

    return amount > 0 && amount < MIN_ORDER_USDT
  })

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
  readonly slotsExhausted = computed(
    () => this.maxParallelOrders() > 0 && this.openOrders() >= this.maxParallelOrders()
  )

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
    () => this.slotsExhausted() && this.awaitingJarClosure().length > 0
  )

  /** Slots held by sales that really are still running. */
  readonly runningOrders = computed(() =>
    Math.max(0, this.openOrders() - this.awaitingJarClosure().length)
  )

  /**
   * USDT cents the server will freeze — the same figure it computes, not a
   * second derivation of it.
   *
   * Only the **pre-profit** leg is staked: the server strips the profit back
   * off the target and converts what is left. The units are the whole point —
   * `targetKopecks()` is kopecks including profit and `balanceCents()` is USDT
   * cents, and comparing those two directly is wrong by roughly the exchange
   * rate — a mistake this screen has made before.
   */
  readonly requiredCents = computed(() => this.quote().requiredUsdtCents)

  readonly hasSufficientBalance = computed(() => this.requiredCents() <= this.balanceCents())

  readonly isValid = computed(() => {
    const amount = this.usdtAmount() ?? 0
    const link = this.dropLink().trim()
    const card = this.cardNumber().replace(/\D/g, '')

    return (
      amount >= MIN_ORDER_USDT &&
      // No rate, no quote: submitting would price the order at whatever the
      // server fetches, which is not the number the user was shown.
      !this.rateUnavailable() &&
      !this.slotsExhausted() &&
      this.isBankEnabled(this.selectedBank()) &&
      // For a disclosing bank the card must have come from the bank. The
      // length check below passes on an auto-filled one, but would also pass
      // on a stale value left behind by a previous link.
      (!this.cardIsFromBank() || this.dropCardNumber() !== null) &&
      this.hasSufficientBalance() &&
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

  async ngOnInit(): Promise<void> {
    this.tma.showBackButton(() => this.router.navigate(['/sale']))
    await this.loadConfig()
  }

  /** Also the retry handler, so a passing outage costs one tap. */
  async loadConfig(): Promise<void> {
    this.rateUnavailable.set(false)
    try {
      const config = await this.saleService.getConfig()
      this.maxParallelOrders.set(config.maxParallelOrders)
      this.openOrders.set(config.openOrders)
      // `?? []` for a server older than the field: an absent list is "we cannot
      // tell you which", which must read as none rather than crash the form.
      this.awaitingJarClosure.set(config.slotsAwaitingJarClosure ?? [])
      this.balanceCents.set(config.balance)
      this.sellRateKopecks.set(config.sellRate)
      // Absent only on a server older than the field; the seeded default is the
      // same number it would have sent.
      this.minOrderKopecks.set(config.minOrderKopecks || DEFAULT_MIN_ORDER_KOPECKS)
      // The whole config call 503s when the market is unreachable, so a rate of
      // zero here means the same thing as the request failing outright.
      this.rateUnavailable.set(!config.sellRate)
    } catch (err) {
      console.error('Failed to load sale config:', err)
      this.sellRateKopecks.set(0)
      this.rateUnavailable.set(true)
    }
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
   * Fills the amount in with the stake the jar's goal asks for.
   *
   * Held in cents and divided only here, so the figure on screen goes through
   * the same `usdt` pipe as every other USDT amount in the app and cannot
   * render as `17.4`.
   */
  useSuggestedAmount(): void {
    const cents = this.suggestedUsdtCents()
    if (cents === null) return

    this.usdtAmount.set(cents / CENTS_PER_USDT)
    this.rateMoved.set(false)
    this.tma.hapticFeedback('light')
  }

  onSelectRemainderPolicy(policy: SaleRemainderPolicy): void {
    // The picker greys these out; this is what makes the grey mean something,
    // as it does for a switched-off bank above.
    if (!isRemainderPolicyEnabled(policy)) return

    this.remainderPolicy.set(policy)
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

  /**
   * Re-prices the order at the current rate, leaving the jar alone.
   *
   * The way out of a moved market, and it moves the half that is ours to move.
   * The jar's goal is set inside a banking app and takes a minute to change —
   * long enough for the rate to move again, which is exactly the loop users
   * were stuck in — while the stake is a number on this screen. So the goal
   * stays and the USDT is recomputed to buy it at the rate that now applies.
   */
  useCurrentRate(): void {
    const cents = this.suggestedUsdtCents()
    if (cents === null) return

    this.usdtAmount.set(cents / CENTS_PER_USDT)
    this.rateMoved.set(false)
    this.errorMsg.set('')
    this.tma.hapticFeedback('light')
  }

  async onSubmit(): Promise<void> {
    if (!this.isValid()) return

    // The backend expects fiatAmount in kopecks. The targetKopecks is already in kopecks.
    const amountKopecks = this.targetKopecks()
    this.submitting.set(true)
    this.errorMsg.set('')

    try {
      const result = await this.saleService.create({
        fiatAmount: amountKopecks,
        bankType: this.selectedBank(),
        dropLink: this.dropLink().trim(),
        cardNumber: this.cardNumber().replace(/\D/g, ''),
        // The rate this total was worked out at. The market moves while a form
        // is being filled, and the server refuses a quote it has moved out from
        // under rather than freezing a stake against an unreachable target.
        quotedRate: this.sellRateKopecks(),
        remainderPolicy: this.remainderPolicy()
      })
      // The stake is frozen by the time this resolves, so the step is real
      // rather than an intention. The completion that follows — if it does — is
      // reported separately, from the status page.
      this.metaPixel.trackConversion(PixelStandardEvent.INITIATE_CHECKOUT, amountKopecks)
      this.tma.hapticFeedback('success')
      this.router.navigate(['/sale', result.saleId, 'status'])
    } catch (err: unknown) {
      console.error('Failed to create sale:', err)
      this.errorMsg.set(this.apiError.messageFor(err))
      this.tma.hapticFeedback('error')

      // The market moved between the quote and the submit. Refusing is right —
      // a jar whose goal no longer matches can never fill — but leaving the
      // screen holding the rate it was refused for is not: the form would go on
      // deriving the same stale target, and the next tap fails the same way.
      // So the rate is re-read and the user is offered the new amount.
      if (this.apiError.codeOf(err) === ERROR.SALE.RATE_CHANGED.code) {
        await this.loadConfig()
        this.rateMoved.set(true)
      }
    } finally {
      this.submitting.set(false)
    }
  }
}
