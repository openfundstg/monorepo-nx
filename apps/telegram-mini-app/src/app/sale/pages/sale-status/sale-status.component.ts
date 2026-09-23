import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import {
  isAcceptedStatementFile,
  SALE_STATEMENT_MAX_BYTES,
  SaleCardOrderState,
  SaleMethod,
  SaleEventType,
  KOPECKS_PER_UAH,
  SaleRemainderPolicy,
  TmaSaleStatus,
  sellRate
} from '@transacto/contracts'
import type {
  SaleCardOrder,
  SaleProgress,
  SaleStatementRejection,
  TmaSale
} from '@transacto/contracts'
import { SaleService } from '../../services/sale.service'
import { TmaService } from '../../../auth/services/tma.service'
import { WsService } from '../../../realtime/services/ws.service'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { ClockService } from '../../../shared/services/clock.service'
import { formatRemaining } from '../../../shared/utils/format.util'
import { UahPipe } from '../../../shared/pipes/uah.pipe'
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe'
import { DateTimePipe } from '../../../shared/pipes/date-time.pipe'
import { SaleStep } from '../../enums/sale-step.enum'
import { StatementBlockReason } from '../../enums/statement-block-reason.enum'
import type { SaleTimelineEntry } from '../../interfaces/sale-timeline-entry.interface'
import {
  COPIED_RESET_MS,
  PROGRESS_MAX_PERCENT,
  PROGRESS_MIN_PERCENT,
} from '../../constants/sale-status.const'
import { formatUah, formatUsdt } from '../../../shared/utils/format.util'
import { MetaPixelService } from '../../../shared/services/meta-pixel.service'
import { PixelStandardEvent } from '../../../shared/enums/pixel-event.enum'
import { TrackTapDirective } from '../../../shared/directives/track-tap.directive'
import { PixelTapEvent } from '../../../shared/enums/pixel-event.enum'
import { environment } from '../../../../environments/environment'

/** Prefix under which `SaleEventType` members are translated. */
const EVENT_KEY_PREFIX = 'SALE_EVENT.'

/**
 * Timeline events whose `amount` is USDT cents, not UAH kopecks.
 *
 * Almost every entry is fiat, so the fiat formatter was applied to all of them.
 * That was already wrong for `STOPPED_BY_USER`, which carries the refund in
 * USDT — invisibly, because its translation happens not to interpolate the
 * figure, and because the two formatters are currently identical arithmetic.
 * Neither of those is a guarantee: `REMAINDER_REFUNDED` does interpolate it, and
 * the moment either formatter gains a currency symbol the mislabelling becomes
 * a number quoted in the wrong unit.
 */
const USDT_AMOUNT_EVENTS: ReadonlySet<SaleEventType> = new Set([
  SaleEventType.STOPPED_BY_USER,
  SaleEventType.REMAINDER_REFUNDED,
])

/**
 * Statuses in which this sale can still change on its own.
 *
 * What the connection indicator is about. It reads the **socket**, and the
 * socket is up whenever the app is open — so a sale that ended weeks ago sat
 * under a green "live", which says something true about the connection and
 * something false about the sale. The two are only worth conflating while
 * there is something to be live *for*.
 */
const LIVE_STATUSES: ReadonlySet<TmaSaleStatus> = new Set([
  TmaSaleStatus.CREATED,
  TmaSaleStatus.TERMINAL_READY,
  TmaSaleStatus.AWAITING_FIAT,
  TmaSaleStatus.CLOSING,
])

@Component({
  selector: 'app-sale-status',
  imports: [
    FormsModule,
    TranslatePipe,
    UahPipe,
    DateTimePipe,
    UsdtPipe,
    TrackTapDirective
  ],
  templateUrl: './sale-status.component.html',
  styleUrl: './sale-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleStatusComponent implements OnInit, OnDestroy {
  /** Named for the template; the directive takes the member, not a string. */
  protected readonly PixelTapEvent = PixelTapEvent

  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly saleService = inject(SaleService)
  private readonly apiError = inject(ApiErrorService)
  private readonly clock = inject(ClockService)
  private readonly translate = inject(TranslateService)
  private readonly tma = inject(TmaService)
  private readonly metaPixel = inject(MetaPixelService)
  /** Public: the template reads `ws.connected()` for the live indicator. */
  readonly ws = inject(WsService)

  private readonly orderId = this.route.snapshot.paramMap.get('id') ?? ''

  /** Static detail — bank, amount, expected profit. Loaded once. */
  readonly order = signal<TmaSale | null>(null)

  /**
   * The live snapshot, from HTTP first and the socket thereafter.
   *
   * A `linkedSignal` rather than an `effect()` that writes a signal: the socket
   * value is the source, and a push for one of the user's *other* orders — the
   * room is per-user, so those land here too — simply keeps the previous value.
   * No merge and no dedupe, because every payload is a complete snapshot.
   */
  readonly progress = linkedSignal<SaleProgress | null, SaleProgress | null>({
    source: () => this.ws.saleProgress(),
    computation: (pushed, previous) => {
      const held = previous?.value ?? null
      if (pushed === null || pushed.saleId !== this.orderId) return held

      // Newest wins, by the server's own clock. Without this the push branch
      // would take any snapshot for this order unconditionally, letting a
      // stale frame — one already superseded by an HTTP re-fetch after a
      // reconnect — walk the page backwards.
      return held !== null && held.updatedAt > pushed.updatedAt ? held : pushed
    },
  })

  readonly loading = signal(true)
  readonly errorMsg = signal('')
  readonly copied = signal(false)

  /** Exposed so the template compares against named steps, not magic numbers. */
  protected readonly SaleStep = SaleStep

  readonly currentStatus = computed<TmaSaleStatus>(
    () => this.progress()?.status ?? this.order()?.status ?? TmaSaleStatus.CREATED,
  )

  readonly publicId = computed(() => this.progress()?.publicId ?? this.order()?.publicId ?? '')

  /**
   * Whether to say anything about the connection at all.
   *
   * Gated on `loading()` as well as on the status, because `currentStatus()`
   * falls back to CREATED until both responses land — without it a finished
   * sale would show the indicator for the first frame and then drop it.
   */
  readonly showsConnection = computed(
    () => !this.loading() && LIVE_STATUSES.has(this.currentStatus()),
  )

  readonly step = computed<SaleStep>(() => {
    const status = this.currentStatus()
    if (status === TmaSaleStatus.COMPLETED) return SaleStep.Completed
    if (status === TmaSaleStatus.TERMINAL_READY || status === TmaSaleStatus.AWAITING_FIAT) {
      return SaleStep.TerminalReady
    }
    if (status === TmaSaleStatus.FAILED || status === TmaSaleStatus.CANCELLED) {
      return SaleStep.Failed
    }
    return SaleStep.Created
  })

  readonly hasFailed = computed(
    () =>
      this.currentStatus() === TmaSaleStatus.FAILED ||
      this.currentStatus() === TmaSaleStatus.CANCELLED,
  )

  /**
   * Which `status.*` pair titles the middle step.
   *
   * The terminal being ready and the terminal waiting on money are one step to
   * the user but two different sentences, so the key follows the live status.
   */
  readonly middleStepKey = computed<string>(() =>
    this.currentStatus() === TmaSaleStatus.AWAITING_FIAT ? 'awaiting_fiat' : 'terminal_ready',
  )

  /**
   * Money in the jar, in UAH kopecks — the figure the whole screen is drawn
   * from. `null` (never scraped) reads as nothing yet.
   */
  /**
   * The rate this sale was priced at, read straight off it.
   *
   * It used to be recomputed here from a market snapshot and a stored markup,
   * which meant this screen had to know how the two combine. The order carries
   * the finished rate now — never today's rate, because every figure on this
   * screen belongs to the order.
   */
  readonly sellRateKopecks = computed(() => this.order()?.exchangeRate ?? 0)

  /**
   * What this order has taken in, as the backend finished it.
   *
   * **Neither of the two raw figures is right on its own**, which is why the
   * server sends a third rather than leaving this screen to combine them.
   * Money can sit in the jar with no order accounting for it — the case a user
   * notices first, because they can see it in their own banking app, and a bar
   * reading 0% against a jar holding money is simply wrong to them. And once
   * the order closes the jar carries on moving while the sale does not: a
   * completed ₴3 941 sale sat showing ₴2 889 because the last jar reading
   * landed after the order was no longer open to receive it.
   */
  readonly delivered = computed(() => this.progress()?.deliveredAmount ?? 0)

  readonly progressPercent = computed(() => this.asPercent(this.delivered()))

  /**
   * How much of the bar is money on its way — orders routed to this jar and
   * still open, drawn translucent ahead of what has arrived.
   *
   * Clamped to what is left of the track, so three pending orders on an almost
   * full jar do not paint past the end of it.
   */
  readonly pendingPercent = computed(() => {
    const pending = this.asPercent(this.progress()?.pendingAmount ?? 0)

    return Math.max(0, Math.min(pending, PROGRESS_MAX_PERCENT - this.progressPercent()))
  })

  private asPercent(amount: number): number {
    const snapshot = this.progress()
    if (snapshot === null || snapshot.targetAmount <= 0) return PROGRESS_MIN_PERCENT

    const percent = (amount / snapshot.targetAmount) * PROGRESS_MAX_PERCENT

    return Math.min(PROGRESS_MAX_PERCENT, Math.max(PROGRESS_MIN_PERCENT, percent))
  }

  /** Whole percent for the caption; the bar itself keeps the fractional width. */
  readonly progressPercentLabel = computed(() => Math.round(this.progressPercent()))

  /**
   * `sale.received_of` takes two **pre-formatted** strings: the dictionary
   * must never receive a raw kopeck figure to render itself.
   */
  readonly receivedOfParams = computed(() => ({
    received: formatUah(this.delivered()),
    target: formatUah(this.progress()?.targetAmount ?? 0),
  }))

  /**
   * Whether this order will close itself once the last stretch is unfillable.
   *
   * Worth saying on the status page and not only on the create form: the
   * difference between an order waiting on somebody to top a jar up by hand and
   * one that will finish on its own is the difference between needing to act
   * and needing to do nothing.
   */
  readonly refundsRemainder = computed(() => {
    // The detail document behind the snapshot, like every other computed here:
    // it lands first on a cold load, and reading only the snapshot would label
    // a refunding order as "waiting for the full amount" until the first push.
    const policy = this.progress()?.remainderPolicy ?? this.order()?.remainderPolicy

    return policy === SaleRemainderPolicy.REFUND_TO_BALANCE
  })

  /**
   * USDT cents this order gave back to the balance as its tail.
   *
   * Snapshot first, detail second, like {@link refundsRemainder}: the order
   * usually completes while this page is open, and the detail document behind
   * it is loaded once.
   */
  readonly returnedUsdt = computed(
    () => this.progress()?.refundedRemainderUsdt ?? this.order()?.refundedRemainderUsdt ?? 0,
  )

  readonly timeline = computed<readonly SaleTimelineEntry[]>(() => {
    const events = this.progress()?.events ?? []

    return events
      .map((event, index) => ({
        key: `${EVENT_KEY_PREFIX}${event.type}`,
        params: {
          amount: USDT_AMOUNT_EVENTS.has(event.type)
            ? formatUsdt(event.amount ?? 0)
            : formatUah(event.amount ?? 0),
          // Only `STATEMENT_CORRECTED` interpolates it — the sentence is
          // "₴300 arrived, not the ₴298 you gave us", and both figures have to
          // be on the event for it to be sayable at all.
          declared: formatUah(event.declaredAmount ?? 0),
        },
        at: event.at,
        trackId: `${event.at}-${event.type}-${index}`,
      }))
      // The server stores oldest-first; the feed reads newest-first. `.map()`
      // already produced a fresh array, so reversing it here mutates nothing
      // shared — `.toReversed()` would need the ES2023 lib, and this app
      // targets ES2022.
      .reverse()
  })

  /**
   * Last status a haptic fired for. A plain field on purpose: it exists only to
   * make the effect below idempotent, and a signal here would feed change
   * detection a value nothing renders.
   */
  private lastHapticStatus: TmaSaleStatus | null = null

  /**
   * Haptics are a genuine side effect — the only thing `effect()` is for.
   *
   * Gated on `loading()`. The effect first runs during the initial change
   * detection pass, long before the HTTP responses land, when `currentStatus()`
   * is still its CREATED fallback. Seeding the baseline from that meant the
   * real status always looked like a *change*, so opening an already-COMPLETED
   * order buzzed 'success' every single time.
   */
  private readonly statusHaptics = effect(() => {
    if (this.loading()) return

    const status = this.currentStatus()
    if (status === this.lastHapticStatus) return

    const isFirstObservation = this.lastHapticStatus === null
    this.lastHapticStatus = status
    // Don't buzz for the status the page was opened on.
    if (isFirstObservation) return

    if (status === TmaSaleStatus.COMPLETED) {
      // Reported from the same guard the haptic uses, rather than from an
      // effect of its own. Both need "this is a change, not the state the page
      // opened on", and two copies of that reasoning would eventually disagree
      // — the one that drifted here would double-count a conversion every time
      // a user reopened a finished order.
      //
      // The consequence of doing it on the client at all: an order that
      // completes while the app is closed is never counted. Fixing that means
      // Meta's server-side Conversions API, which is a different piece of work.
      this.metaPixel.trackConversion(
        PixelStandardEvent.PURCHASE,
        this.progress()?.targetAmount
      )
      this.tma.hapticFeedback('success')
    } else if (
      status === TmaSaleStatus.FAILED ||
      status === TmaSaleStatus.CANCELLED
    ) {
      this.tma.hapticFeedback('error')
    } else {
      this.tma.hapticFeedback('light')
    }
  })

  /**
   * The connection epoch the current snapshot is known to account for, or
   * `null` until the first load finishes.
   */
  private syncedThroughEpoch: number | null = null

  /**
   * Re-fetch whenever the socket connects past what the snapshot covers.
   *
   * socket.io replays nothing, so anything emitted while this client was not in
   * the room is gone — not delayed, gone. That covers two cases with one rule:
   * a genuine reconnect after a tunnel drop, and the narrower window at mount
   * between issuing the GET and actually joining the room, during which a push
   * has nowhere to land and the GET response may already have been generated.
   *
   * Costs nothing in the common case: arriving from the dashboard, the socket
   * is already connected, the epoch never moves past the baseline, and no
   * second request happens.
   */
  private readonly reconnectSync = effect(() => {
    const epoch = this.ws.connectionEpoch()
    if (this.syncedThroughEpoch === null || epoch <= this.syncedThroughEpoch) return

    this.syncedThroughEpoch = epoch
    void this.refreshProgress()
  })

  async ngOnInit(): Promise<void> {
    this.tma.showBackButton(() => this.router.navigate(['/']))

    // Subscribe *first*, then hydrate. The reverse — the extension's ordering —
    // leaves every push between the HTTP response and the room join with
    // nowhere to go. It only does that because it has no way to order two
    // snapshots; here both the socket branch and `applySnapshot` compare
    // `updatedAt`, so an early push cannot be clobbered by the slower response
    // and connecting first is strictly safer.
    this.ws.connect()
    await this.load()
  }

  ngOnDestroy(): void {
    this.tma.hideBackButton()
  }

  /**
   * Whether stopping early is possible right now.
   *
   * Straight from the snapshot, so it tracks the terminal rather than only the
   * status: an order with a payment still in play cannot be stopped, and that
   * changes without the status moving. The button disables itself the moment a
   * payer starts, instead of failing when tapped.
   */
  readonly canCancel = computed(() => this.progress()?.canCancel === true)

  /**
   * Whether this screen has to ask the user to close their jar.
   *
   * The jar outlives the order: once the sale is finished the jar keeps
   * accepting money, and a payer who started late lands hryvnia in it minutes
   * after the order expired — money nothing matches, and an appeal follows.
   *
   * Nobody but its owner can close a jar, so this is an instruction, not a
   * status. Until it is done the user's next sale is blocked, and a
   * stake they stopped early is still frozen — which is exactly why the screen
   * has to say so rather than leave them wondering what they are waiting for.
   */
  readonly awaitingJarClosure = computed(() => this.progress()?.awaitingJarClosure === true)

  /**
   * The last stretch, once no payment can reach it, or `null`.
   *
   * Straight from the snapshot rather than worked out here: whether a sale is
   * in its tail is arithmetic over a configurable floor, and a screen that
   * decided it separately could draw a payment the endpoints refuse to act on.
   */
  readonly tail = computed(() => this.progress()?.tail ?? null)

  /**
   * That stretch as a payment to confirm, or `null` — which is all this screen
   * ever draws of it.
   *
   * **Two conditions, and neither is about the tail being unusual.** It has to
   * have been taken on, because until somebody undertakes to send it there is
   * nothing on its way and a row would be inviting the seller to confirm a
   * payment that does not exist. And it has to be a card sale, because a jar's
   * arrives as a balance the scraper reads — the seller does nothing, sees
   * nothing, and a button there would credit the same hryvnia twice.
   *
   * So a jar sale's last stretch is invisible on purpose, and a card sale's is
   * indistinguishable from a payer's.
   */
  readonly lastPayment = computed(() => {
    const tail = this.tail()

    return tail?.claimed === true && this.saleMethod() === SaleMethod.CARD ? tail : null
  })

  /** The confirmation is in flight, so a second tap is not a second request. */
  readonly tailBusy = signal(false)
  readonly tailError = signal('')

  /**
   * Why stopping will not settle on the spot, if it will not.
   *
   * **The button stays and what changes is the promise.** `sale.stop_hint`
   * quotes a refund, and under either of these that figure is wrong or
   * premature — a payer mid-transfer can still reduce it, and a statement can
   * still correct it. So the hint names what is being waited on instead.
   *
   * **A tail has no case here**, and that is the point rather than an omission:
   * while an operator is transferring one the snapshot's `canCancel` is false
   * and this whole card is gone, and while nobody has taken it on, stopping
   * settles on the spot exactly as the ordinary hint says. The state in between
   * was the one the removed `stop_hint_tail` described, and it no longer exists.
   */
  readonly stopHintKey = computed(() => {
    if (this.statementRequired()) return 'sale.stop_hint_statement'
    if ((this.progress()?.pendingAmount ?? 0) > 0) return 'sale.stop_hint_winding_down'

    return 'sale.stop_hint'
  })

  /**
   * The seller says the last payment landed.
   *
   * One tap, like confirming any other payment on this sale, and for the same
   * reason: confirming hryvnia that never came costs them their own stake,
   * which is what makes it safe to take at face value.
   */
  async onConfirmTail(): Promise<void> {
    await this.runTailAction(() => this.saleService.confirmTail(this.orderId))
  }

  /**
   * …and the line under it, for the case where it did not.
   *
   * A chat rather than a refusal key. Denying here would be disputing *us*
   * rather than a payer, which is not a thing a button can adjudicate: whether
   * the transfer was really made is a question for a person with both sides in
   * front of them. `openTelegramLink` and not an `<a href>` — see the service.
   */
  onContactSupport(): void {
    if (environment.botUrl) this.tma.openTelegramLink(environment.botUrl)
  }

  /**
   * The confirmation, wrapped.
   *
   * The answer is the same snapshot the socket pushes, so the screen updates
   * from the response rather than waiting for a round trip through the gateway.
   *
   * Still a wrapper around one call, because the alternative — inlining it into
   * `onConfirmTail` — loses the guard that makes a double tap one request.
   */
  private async runTailAction(call: () => Promise<SaleProgress>): Promise<void> {
    if (this.tailBusy()) return

    this.tailBusy.set(true)
    this.tailError.set('')

    try {
      this.progress.set(await call())
      this.tma.hapticFeedback('success')
    } catch (error: unknown) {
      this.tailError.set(this.apiError.messageFor(error))
      this.tma.hapticFeedback('error')
    } finally {
      this.tailBusy.set(false)
    }
  }

  /** Two taps: the first arms, the second commits. */
  readonly cancelArmed = signal(false)
  readonly cancelling = signal(false)
  readonly cancelError = signal('')
  /** USDT cents returned, once it is done. */
  readonly refunded = signal<number | null>(null)

  /**
   * Stopping loses the profit and cannot be undone, so it takes two taps rather
   * than one — there is no native confirm dialog in the Mini App SDK, and a
   * mis-tap here costs the user their order.
   */
  async onCancel(): Promise<void> {
    if (!this.canCancel() || this.cancelling()) return

    if (!this.cancelArmed()) {
      this.cancelArmed.set(true)
      this.tma.hapticFeedback('warning')

      return
    }

    this.cancelling.set(true)
    this.cancelError.set('')

    try {
      const result = await this.saleService.cancel(this.orderId)
      this.refunded.set(result.refunded)
      this.tma.hapticFeedback('success')
      // The socket push carries the new status, so nothing is re-fetched here.
    } catch (error: unknown) {
      this.cancelError.set(this.apiError.messageFor(error))
      this.tma.hapticFeedback('error')
    } finally {
      this.cancelling.set(false)
      this.cancelArmed.set(false)
    }
  }

  /**
   * The payments a card sale's seller has to answer, oldest first.
   *
   * Empty on a jar sale, whose orders the scraper settles without anybody being
   * asked. Read off the progress snapshot rather than the sale document,
   * because an order arrives while this page is open and the document is
   * fetched once.
   */
  readonly cardOrders = computed<readonly SaleCardOrder[]>(
    () => this.progress()?.cardOrders ?? []
  )

  /**
   * Which variant this sale is, from the snapshot.
   *
   * Absent on a sale written before the variant existed, which means a jar —
   * the same reading the contract's own doc gives. Not inferred from
   * `cardOrders` being empty: a card sale before its first payer has none
   * either, and the tail block would then offer a jar seller a button their
   * endpoint refuses.
   */
  readonly saleMethod = computed(() => this.progress()?.saleMethod ?? SaleMethod.JAR)

  /**
   * The same payments, newest first — the order the list is read in.
   *
   * The server stores them as they arrived, which is what every lookup below
   * wants and the opposite of what somebody scanning the screen wants: the
   * payment they are being asked about is the newest one, and it was at the
   * bottom under a growing pile of settled ones. The timeline beside it already
   * reads newest first, and two lists on one screen running opposite ways is
   * its own small lie.
   *
   * A separate signal rather than reversing {@link cardOrders}, because the
   * finds below mean "the one open order" and must not start depending on which
   * end they are searched from.
   */
  readonly cardOrdersNewestFirst = computed<readonly SaleCardOrder[]>(() =>
    // `.map()` first so the reverse mutates a fresh array and not the snapshot;
    // `.toReversed()` would need the ES2023 lib and this app targets ES2022.
    this.cardOrders()
      .map((order) => order)
      .reverse(),
  )

  /**
   * The one order, if any, that is still a question.
   *
   * At most one can be: the credential is created with `max_open_orders: 1`, so
   * a seller is never asked about two amounts at once — which is the whole
   * point, since "did some money arrive" is a question nobody can answer about
   * a card that sees more than one transfer a day.
   */
  readonly openCardOrder = computed<SaleCardOrder | null>(
    () =>
      this.cardOrders().find(
        (order) => order.state === SaleCardOrderState.AWAITING_CONFIRMATION
      ) ?? null
  )

  /** …and the one waiting on a statement, for the same reason. */
  readonly disputedCardOrder = computed<SaleCardOrder | null>(
    () => this.cardOrders().find((order) => order.state === SaleCardOrderState.DISPUTED) ?? null
  )

  /**
   * Whether the tail of this sale is being held for a bank statement.
   *
   * The server's answer, not a rule restated here: it depends on which claims
   * have been through a statement and how far the last one reached, and a
   * second implementation of that could only ever disagree with the one that
   * decides whether the money moves.
   */
  readonly statementRequired = computed(() => this.progress()?.statementRequired === true)

  /**
   * The order a checkpoint statement is filed against — the most recent claim.
   *
   * A statement settles every claim in its period, so which order it is
   * addressed to changes nothing about what it proves. It decides where the
   * document is stored and how an operator finds it, and the newest claim is
   * the one they will be looking for.
   */
  readonly shortfallOrder = computed<SaleCardOrder | null>(
    () =>
      [...this.cardOrders()]
        .reverse()
        .find((order) => typeof order.declaredAmount === 'number') ?? null
  )

  /**
   * The document this sale has stopped on, or `null` while nothing has stopped.
   *
   * **Asked because an upload box is a demand whether or not it was meant as
   * one.** A statement is wanted in three situations, and only two of them hold
   * anything up; the third — a small shortfall on a payment that executed
   * anyway — keeps filling the sale while the box sits there looking like the
   * reason it is not. So the box is drawn for the two that are, and says which.
   *
   * **Composed from facts the server publishes, not from a rule restated
   * here.** That a payment is `DISPUTED` and that the sale is in its tail are
   * both on the snapshot; `statementRequired` is the server's own answer about
   * the claim. What this adds is which of them is the reason, and that is a
   * sentence rather than an arithmetic.
   *
   * A dispute outranks a held tail because it is the earlier stoppage and the
   * one with a payment attached: settling it may well fill the sale outright,
   * at which point there is no tail left to explain.
   */
  readonly statementBlock = computed<{
    order: SaleCardOrder
    reason: StatementBlockReason
  } | null>(() => {
    const disputed = this.disputedCardOrder()
    if (disputed) return { order: disputed, reason: StatementBlockReason.ROUTING_STOPPED }

    const held = this.shortfallOrder()
    if (!this.statementRequired() || this.tail() === null || held === null) return null

    return { order: held, reason: StatementBlockReason.TAIL_HELD }
  })

  readonly answeringOrderId = signal<number | null>(null)
  /** Which order, if any, has its "a different amount arrived" field open. */
  readonly amendingOrderId = signal<number | null>(null)
  /** What is typed into it, in whole hryvnia as a person writes them. */
  readonly amendedUah = signal('')
  readonly denyArmed = signal<number | null>(null)
  readonly cardOrderError = signal('')

  /**
   * How long the payer still has on one payment, in milliseconds.
   *
   * Negative once the moment has passed. Reads the shared clock, so every row
   * showing a countdown re-renders each second off one interval rather than
   * one of its own.
   */
  remainingMs(order: SaleCardOrder): number {
    return new Date(order.confirmDeadlineAt).getTime() - this.clock.now()
  }

  countdown(order: SaleCardOrder): string {
    return formatRemaining(this.remainingMs(order))
  }

  /**
   * Whether this payment's window has run out.
   *
   * **The one thing that decides whether a denial may be made at all.** Before
   * the deadline there is nothing to deny: the payer has time left, and a
   * seller pressing "nothing arrived" would be reporting the absence of money
   * that is not late yet — stopping their own terminal, and their own sale,
   * over a payment still in flight. After it, the money is genuinely overdue
   * and the question is a real one.
   *
   * Derived on the client from a deadline the server set, and the server does
   * not rely on this: the sweep disputes on the same instant within thirty
   * seconds, and `deny` is refused upstream for an order that is not open. This
   * is the screen agreeing with the rule, not enforcing it.
   */
  isOverdue(order: SaleCardOrder): boolean {
    return this.remainingMs(order) <= 0
  }

  /**
   * Why the seller's **last** statement for this order proved nothing, if it
   * did not.
   *
   * The whole list is kept on the document — an operator working a dispute
   * wants every attempt — but only the last one describes a document that still
   * exists as far as the seller is concerned. Rendering all of them put a
   * refused upload's reason underneath the verdict of the accepted one that
   * came after it, so a settled order read "the statement confirmed no money
   * arrived" and, directly below, "this statement's period does not cover the
   * payment". Two answers to one question, the stale one in red.
   *
   * No state check is needed to say which is which: an accepted statement
   * carries no rejection, so the last entry answers it by itself.
   */
  latestRejection(order: SaleCardOrder): SaleStatementRejection | null {
    return order.statements.at(-1)?.rejection ?? null
  }

  /**
   * The seller says one payment reached their card.
   *
   * One tap, unlike stopping the sale: this is the ordinary path and it is the
   * answer that costs nothing to get right. It is also testimony against the
   * teller's own interest — confirming money that never came spends their own
   * stake — which is what makes a single tap safe here and two taps necessary
   * on the denial.
   */
  async onConfirmCardOrder(orderId: number, receivedKopecks?: number): Promise<void> {
    if (this.answeringOrderId() !== null) return

    this.answeringOrderId.set(orderId)
    this.cardOrderError.set('')

    try {
      this.progress.set(
        await this.saleService.confirmOrder(this.orderId, orderId, receivedKopecks)
      )
      this.tma.hapticFeedback('success')
      this.amendingOrderId.set(null)
      this.amendedUah.set('')
    } catch (error: unknown) {
      this.cardOrderError.set(this.apiError.messageFor(error))
      this.tma.hapticFeedback('error')
    } finally {
      this.answeringOrderId.set(null)
      this.denyArmed.set(null)
    }
  }

  /**
   * Opens the "a different amount arrived" field for one order.
   *
   * Behind a second tap rather than always on screen, because the ordinary
   * answer is that the whole payment arrived and a field beside the button
   * invites people to fill it in. What it is for is the case a bank fee took a
   * few hryvnia on the way — and the seller is the only witness a card sale has.
   */
  startAmending(orderId: number, amount: number): void {
    this.amendingOrderId.set(orderId)
    this.amendedUah.set((amount / KOPECKS_PER_UAH).toFixed(2))
  }

  cancelAmending(): void {
    this.amendingOrderId.set(null)
    this.amendedUah.set('')
  }

  /**
   * What the typed figure comes to in kopecks, or `null` if it is not a figure.
   *
   * Refused rather than clamped when it is above the order: more cannot have
   * arrived than was sent, and quietly reading that as "the whole order" would
   * hide a typo that the seller meant to be a smaller number.
   */
  readonly amendedKopecks = computed<number | null>(() => {
    const uah = Number.parseFloat(this.amendedUah().replace(',', '.'))
    if (!Number.isFinite(uah) || uah <= 0) return null

    return Math.round(uah * KOPECKS_PER_UAH)
  })

  amendedValidFor(order: SaleCardOrder): boolean {
    const kopecks = this.amendedKopecks()

    return kopecks !== null && kopecks > 0 && kopecks <= order.amount
  }

  /**
   * …and says it did not.
   *
   * Two taps, because this one stops the sale taking any more money and asks
   * the seller for a bank statement — a mis-tap costs them the rest of their
   * sale until they produce a document. The same two-tap shape as stopping,
   * for the same reason: the Mini App SDK has no native confirm dialog.
   */
  async onDenyCardOrder(orderId: number): Promise<void> {
    if (this.answeringOrderId() !== null) return

    if (this.denyArmed() !== orderId) {
      this.denyArmed.set(orderId)
      this.tma.hapticFeedback('warning')

      return
    }

    this.answeringOrderId.set(orderId)
    this.cardOrderError.set('')

    try {
      this.progress.set(await this.saleService.denyOrder(this.orderId, orderId))
      this.tma.hapticFeedback('warning')
    } catch (error: unknown) {
      this.cardOrderError.set(this.apiError.messageFor(error))
      this.tma.hapticFeedback('error')
    } finally {
      this.answeringOrderId.set(null)
      this.denyArmed.set(null)
    }
  }

  readonly uploadingStatement = signal(false)

  /**
   * Sends the statement that settles a denied order.
   *
   * The response is the new snapshot whatever the document turned out to say,
   * so the screen updates from it: a refusal renders its own reason beside the
   * order, and a statement that contradicts the seller settles the order in
   * front of them. None of those is an error, and treating a refusal as one
   * would leave the user with a red message and no idea which statement to send
   * instead.
   */
  async onStatementPicked(event: Event, orderId: number): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]

    if (file === undefined || this.uploadingStatement()) return

    // Checked here as well as by the server, and the point is *where*: a
    // statement is the largest thing this product asks anybody to upload, and
    // sending ten megabytes over a phone connection to be told it was the wrong
    // type is the slowest possible way to learn. The `accept` attribute is a
    // hint the file picker may ignore; these are the rule, and they are the same
    // two the backend refuses on.
    if (!isAcceptedStatementFile({ fileName: file.name, mimeType: file.type })) {
      this.cardOrderError.set(this.translate.instant('SALE_STATEMENT.UNSUPPORTED_TYPE'))
      this.tma.hapticFeedback('error')
      input.value = ''

      return
    }

    if (file.size > SALE_STATEMENT_MAX_BYTES) {
      this.cardOrderError.set(this.translate.instant('SALE_STATEMENT.TOO_LARGE'))
      this.tma.hapticFeedback('error')
      input.value = ''

      return
    }

    this.uploadingStatement.set(true)
    this.cardOrderError.set('')

    try {
      this.progress.set(await this.saleService.uploadStatement(this.orderId, orderId, file))
      this.tma.hapticFeedback('success')
    } catch (error: unknown) {
      this.cardOrderError.set(this.apiError.messageFor(error))
      this.tma.hapticFeedback('error')
    } finally {
      this.uploadingStatement.set(false)
      // So picking the same file again fires `change` — a user who re-sends the
      // document after being told what was wrong with it picks the same one.
      input.value = ''
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/'])
  }

  async copyPublicId(): Promise<void> {
    const publicId = this.publicId()
    if (!publicId) return

    try {
      await navigator.clipboard.writeText(publicId)
      this.copied.set(true)
      this.tma.hapticFeedback('light')
      setTimeout(() => this.copied.set(false), COPIED_RESET_MS)
    } catch {
      /* clipboard not available */
    }
  }

  private async load(): Promise<void> {
    if (!this.orderId) {
      this.errorMsg.set(this.apiError.messageFor(null))
      this.loading.set(false)
      return
    }

    // Read before the request goes out, not after it returns: the snapshot can
    // only be trusted to cover the connection that existed when it was asked
    // for. Anything that connects later is a gap the effect above closes.
    const epochAtRequest = this.ws.connectionEpoch()

    try {
      // The detail and the live snapshot are independent reads; serialising
      // them would double the time the page spends on a spinner.
      const [order, progress] = await Promise.all([
        this.saleService.getById(this.orderId),
        this.saleService.getProgress(this.orderId),
      ])
      this.order.set(order)
      this.applySnapshot(progress)
      this.syncedThroughEpoch = epochAtRequest
    } catch (err: unknown) {
      // A missing or non-owned order is a real 404 now, not a 200 carrying an
      // `{ error }` body. Show why instead of bouncing to the dashboard.
      console.error('Failed to load sale:', err)
      this.errorMsg.set(this.apiError.messageFor(err))
    } finally {
      this.loading.set(false)
    }
  }

  private async refreshProgress(): Promise<void> {
    if (!this.orderId) return

    try {
      this.applySnapshot(await this.saleService.getProgress(this.orderId))
    } catch (err: unknown) {
      console.error('Failed to refresh sale progress:', err)
    }
  }

  private applySnapshot(snapshot: SaleProgress): void {
    // A push can land while the request is in flight. Both values are complete
    // snapshots of the same state, so the newer one simply wins.
    this.progress.update((current) =>
      current !== null && current.updatedAt >= snapshot.updatedAt ? current : snapshot,
    )
  }
}
