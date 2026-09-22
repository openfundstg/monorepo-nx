import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { BANK_NAME_KEY } from '../../../shared/constants/bank-name.const'
import { Store } from '@ngrx/store'
import { formatPercent, formatUah } from '../../../shared/utils/format.util'
import { TranslatePipe } from '@ngx-translate/core'
import { BankProvider, OFFICIAL_CHANNEL_URL } from '@transacto/contracts'
import {
  BalanceEntryKind,
  SaleRemainderPolicy,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus
} from '@transacto/contracts'
import type { BalanceHistoryEntry } from '@transacto/contracts'
import { TmaService } from '../../../auth/services/tma.service'
import { WsService } from '../../../realtime/services/ws.service'
import { HistoryTab } from '../../../shared/enums/history-tab.enum'
import { DateTimePipe } from '../../../shared/pipes/date-time.pipe'
import { UahPipe } from '../../../shared/pipes/uah.pipe'
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe'
import { TrackTapDirective } from '../../../shared/directives/track-tap.directive'
import { TourAnchorDirective } from '../../../shared/directives/tour-anchor.directive'
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component'
import { LogoComponent } from '../../../shared/components/logo/logo.component'
import { SaleMethodIconComponent } from '../../../shared/components/sale-method-icon/sale-method-icon.component'
import { PixelTapEvent } from '../../../shared/enums/pixel-event.enum'
import { TourStep } from '../../../shared/enums/tour-step.enum'
import {
  selectBuyRate,
  selectRoundTripProfitKopecks,
  selectRoundTripProfitPercent,
  selectSellRate
} from '../../../core/store/rates.selectors'
import { userActions } from '../../../user/store/user.actions'
import {
  selectBalance,
  selectFrozenBalance,
  selectHistory,
  selectHistoryLoaded,
  selectProfile,
  selectTrustLevel,
  selectTurnover,
  selectSlotsAwaitingJarClosure
} from '../../../user/store/user.selectors'
import { trustActions } from '../../store/trust.actions'
import { selectNextRung, selectTurnoverProgress } from '../../store/trust.selectors'

/**
 * The home screen: what the user holds, where they stand, what has happened.
 *
 * It reads; it does not reconcile. Every figure here comes from a selector, and
 * the three sources that used to feed them — the launch session, the profile
 * fetched on entry, and the `balance.updated` socket push — meet in the store
 * instead. This screen previously ran a `linkedSignal` deciding, on every
 * render, which of a fetched balance and a pushed one was the newer; the store
 * answers that by construction, because the last write is the state.
 */
@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    TranslatePipe,
    UahPipe,
    UsdtPipe,
    DateTimePipe,
    TrackTapDirective,
    TourAnchorDirective,
    ExchangeRateComponent,
    LogoComponent,
    SaleMethodIconComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit {
  /** Named for the template; both directives take the member, not a string. */
  protected readonly PixelTapEvent = PixelTapEvent
  protected readonly TourStep = TourStep
  /** Exposed so the template compares against enum members, not literals. */
  protected readonly HistoryTab = HistoryTab

  private readonly store = inject(Store)
  private readonly ws = inject(WsService)
  private readonly router = inject(Router)
  private readonly tma = inject(TmaService)

  /**
   * Opens the official channel in Telegram.
   *
   * Through {@link TmaService.openTelegramLink} and never an `<a href>`: inside
   * the WebView a plain link lands on t.me's own "open in Telegram" page, which
   * is a dead end for somebody who is already in Telegram.
   */
  openChannel(): void {
    this.tma.hapticFeedback('light')
    this.tma.openTelegramLink(OFFICIAL_CHANNEL_URL)
  }

  /**
   * The two prices the buttons below quote, in kopecks per USDT, or `null`
   * while unknown.
   *
   * This card only *shows* them. A screen that freezes a stake or credits a
   * deposit takes its rate from the same response as the amounts it is quoting
   * — see `RatesState`.
   */
  readonly sellRate = this.store.selectSignal(selectSellRate)
  readonly buyRate = this.store.selectSignal(selectBuyRate)
  /**
   * What a round trip through both rates earns, in percent.
   *
   * The two figures beside the buttons are prices; this is what they *mean* —
   * hryvnia in at the lower one, USDT out at the higher one, and the difference
   * is the user's. A screen showing two rates and leaving the arithmetic to the
   * reader is a screen most readers do not do the arithmetic on.
   *
   * Read from the store rather than computed here: it is derived from the two
   * rates by the one helper that knows how, and it is deliberately not the two
   * spreads added up. `null` until both rates are known, so the banner is
   * absent rather than promising nothing.
   */
  readonly roundTripProfitPercent = this.store.selectSignal(selectRoundTripProfitPercent)

  /** The same round trip in kopecks per USDT — the gap between the two rates. */
  readonly roundTripProfitKopecks = this.store.selectSignal(selectRoundTripProfitKopecks)

  /**
   * The banner's two figures as finished strings, or `null` to draw nothing.
   *
   * Both formatted here rather than in the template: `formatUah` and
   * `formatPercent` fix the locale for the whole app, and numbers handed to
   * `translate` would be grouped by whatever the active language decided.
   *
   * Which of the two leads is the dictionary's business, not this component's —
   * it hands over both and the sentence decides. Today the percentage opens the
   * line and the hryvnia backs it up, because the hryvnia is the figure a
   * reader can check: it is the difference between the two rates printed
   * directly above.
   */
  readonly roundTripProfit = computed(() => {
    const percent = this.roundTripProfitPercent()
    const kopecks = this.roundTripProfitKopecks()

    if (percent === null || kopecks === null || kopecks <= 0) return null

    return { uah: formatUah(kopecks), percent: formatPercent(percent) }
  })

  readonly balance = this.store.selectSignal(selectBalance)
  readonly frozenBalance = this.store.selectSignal(selectFrozenBalance)
  readonly turnover = this.store.selectSignal(selectTurnover)
  readonly currentTrustLevel = this.store.selectSignal(selectTrustLevel)
  readonly nextLevel = this.store.selectSignal(selectNextRung)
  readonly turnoverProgress = this.store.selectSignal(selectTurnoverProgress)
  readonly history = this.store.selectSignal(selectHistory)
  /**
   * Finished sales whose jars are still open.
   *
   * Each is holding a sale slot, and only its owner can release it. The
   * dashboard is where this has to be said: a user in that state is not trying
   * to start a sale — they are looking at a screen that says nothing is running
   * while the product behaves as though something is.
   */
  readonly awaitingJarClosure = this.store.selectSignal(selectSlotsAwaitingJarClosure)

  private readonly profile = this.store.selectSignal(selectProfile)
  private readonly historyLoaded = this.store.selectSignal(selectHistoryLoaded)

  /**
   * The spinner covers the first paint only.
   *
   * The guard's `/auth` has usually already seeded the profile by the time this
   * mounts, so in practice it waits on the timeline alone.
   */
  readonly loading = computed(() => this.profile() === null || !this.historyLoaded())

  readonly activeTab = signal(HistoryTab.ALL)

  readonly filteredHistory = computed(() => {
    const all = this.history()

    switch (this.activeTab()) {
      case HistoryTab.DEPOSITS:
        // Every way money arrives. To the user this is one thing with several
        // routes — a chain transfer, a hryvnia payout, referral earnings moved
        // across, an operator putting something right — and a tab that hid some
        // of them would be answering a question about our storage rather than
        // about their money. A movement qualifies by direction: a debited
        // correction took money away and does not belong under "deposits".
        return all.filter(
          (item) =>
            item.type === 'deposit' ||
            item.type === 'fiat_deposit' ||
            (item.type === 'balance_movement' && item.cryptoCents > 0)
        )
      case HistoryTab.SALES:
        return all.filter((item) => item.type === 'sale')
      default:
        return all
    }
  })

  /**
   * Asks for a fresh read on every entry, rather than trusting what is held.
   *
   * The balance moves while the app is elsewhere — a fiat top-up is credited by
   * a reconciler thirty seconds after the receipt lands — and the session is a
   * snapshot from launch. The refresh is a background one, so it does not grey
   * out the figures already on screen while it runs.
   *
   * The ladder is dispatched unconditionally too; its effect drops the second
   * and later asks, so this costs one request per session.
   */
  /** The label key for a bank, so a reminder can say which app to open. */
  bankNameKey(provider: BankProvider): string {
    return BANK_NAME_KEY[provider] ?? provider
  }

  /** Opens the finished sale whose jar is still holding a slot. */
  openSale(saleId: string): void {
    void this.router.navigate(['/sale', saleId, 'status'])
  }

  ngOnInit(): void {
    this.store.dispatch(userActions.loadProfile())
    this.store.dispatch(userActions.loadHistory())
    this.store.dispatch(trustActions.loadLadder())

    this.ws.connect()
  }

  /**
   * Whether this order gives its unfillable tail back instead of waiting.
   *
   * Absent on orders created before the choice existed, which behaved as
   * "wait" — so the fallback is the reading, not a formality.
   */
  refundsRemainder(item: BalanceHistoryEntry): boolean {
    return (
      item.type === 'sale' &&
      item.remainderPolicy === SaleRemainderPolicy.REFUND_TO_BALANCE
    )
  }

  /**
   * True when the entry added money to the balance, which the row colours green.
   *
   * Settled money only, and the same gate governs {@link isDebited}: a top-up
   * that was cancelled or is still on its way has added nothing yet, and a
   * green figure beside «СКАСОВАНО» would say it had. Those rows stay the
   * default colour until the money actually moves.
   */
  isCredited(item: BalanceHistoryEntry): boolean {
    switch (item.type) {
      case 'deposit':
        return item.status === TmaDepositStatus.COMPLETED || item.status === TmaDepositStatus.PAID_LATE
      case 'fiat_deposit':
        return item.status === TmaFiatDepositStatus.COMPLETED
      case 'balance_movement':
        // Already settled — the only question left is which way it went.
        return item.cryptoCents > 0
      default:
        // A sale spends USDT. The hryvnia it fetched is the figure underneath,
        // not this one, so the headline is never a credit.
        return false
    }
  }

  /** True when the entry took money out of the balance, which the row colours red. */
  isDebited(item: BalanceHistoryEntry): boolean {
    switch (item.type) {
      case 'balance_movement':
        return item.cryptoCents < 0
      case 'sale':
        // Running, the stake is frozen rather than spent; cancelled, it comes
        // back. Only a finished sale has cost the user anything.
        return item.status === TmaSaleStatus.COMPLETED
      default:
        return false
    }
  }

  /**
   * The face of a movement that belongs to no process.
   *
   * A map rather than a template `@switch`, because these two rows are the only
   * ones on this list with nothing behind them to open — the icon is all the
   * user gets to tell them apart at a glance.
   */
  movementIcon(kind: BalanceEntryKind): string {
    return kind === BalanceEntryKind.REFERRAL_TRANSFER ? '🎁' : '🛠️'
  }

  onItemClick(item: BalanceHistoryEntry): void {
    switch (item.type) {
      case 'deposit':
        this.router.navigate(['/deposit', item.id, 'verify'])
        return
      case 'fiat_deposit':
        this.router.navigate(['/deposit/fiat', item.id])
        return
      case 'balance_movement':
        // Nowhere to go: a referral transfer and an operator's correction have
        // no screen of their own, and a tap that navigated to nothing would
        // read as a broken row.
        return
      default:
        this.router.navigate(['/sale', item.id, 'status'])
    }
  }
}
