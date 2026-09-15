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
import { TranslatePipe } from '@ngx-translate/core'
import {
  SaleEventType,
  SaleRemainderPolicy,
  TmaSaleStatus,
  sellRate
} from '@transacto/contracts'
import type { SaleProgress, TmaSale } from '@transacto/contracts'
import { SaleService } from '../../services/sale.service'
import { TmaService } from '../../../auth/services/tma.service'
import { WsService } from '../../../realtime/services/ws.service'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { UahPipe } from '../../../shared/pipes/uah.pipe'
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe'
import { DateTimePipe } from '../../../shared/pipes/date-time.pipe'
import { SaleStep } from '../../enums/sale-step.enum'
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

@Component({
  selector: 'app-sale-status',
  imports: [TranslatePipe, UahPipe, DateTimePipe, UsdtPipe, TrackTapDirective],
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
