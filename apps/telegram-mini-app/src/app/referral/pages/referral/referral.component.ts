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
  type WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { REFERRAL_CODE_PATTERN,
  CENTS_PER_USDT,
} from '@transacto/contracts';
import type {
  ReferralBalanceUpdateEvent,
  ReferralEntry,
  ReferralSummary,
} from '@transacto/contracts';
import { TmaService } from '../../../auth/services/tma.service';
import { WsService } from '../../../realtime/services/ws.service';
import { ApiErrorService } from '../../../shared/services/api-error.service';
import { UahPipe } from '../../../shared/pipes/uah.pipe';
import { UsdtPipe } from '../../../shared/pipes/usdt.pipe';
import { DateTimePipe } from '../../../shared/pipes/date-time.pipe';
import { ReferralService } from '../../services/referral.service';
import { CONFIRMATION_MS } from '../../constants/referral.const';

/** The two headline figures, in USDT cents. */
interface ReferralTotals {
  balance: number;
  totalEarned: number;
}

@Component({
  selector: 'app-referral',
  imports: [FormsModule, TranslatePipe, UahPipe, UsdtPipe, DateTimePipe],
  templateUrl: './referral.component.html',
  styleUrl: './referral.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferralComponent implements OnInit, OnDestroy {
  private readonly referralService = inject(ReferralService);
  private readonly apiError = inject(ApiErrorService);
  private readonly tma = inject(TmaService);
  private readonly ws = inject(WsService);

  readonly loading = signal(true);
  readonly summary = signal<ReferralSummary | null>(null);
  readonly errorMsg = signal('');

  /** What the transfer field holds, in whole USDT — cents are the wire unit. */
  readonly transferUsdt = signal<number | null>(null);
  readonly transferring = signal(false);
  readonly transferred = signal(false);

  readonly codeInput = signal('');
  readonly redeeming = signal(false);

  readonly copied = signal(false);
  readonly codeCopied = signal(false);

  /**
   * The referral pot and the lifetime total, in USDT cents.
   *
   * Two sources feed them — the fetched summary and the
   * `referral.balance_updated` push — and neither is reliably the newer one, so
   * the last source to *change* wins. That matters on this page specifically:
   * `WsService` is root-scoped and latches its last event for the app's
   * lifetime, so an event from an earlier visit is already sitting there before
   * this component mounts. Preferring the push unconditionally would show that
   * stale figure over a freshly fetched one.
   *
   * Modelled on the dashboard's balance for the same reason.
   */
  private readonly totals = linkedSignal<
    { fetched: ReferralTotals; pushed: ReferralBalanceUpdateEvent | null },
    ReferralTotals
  >({
    source: () => ({
      fetched: {
        balance: this.summary()?.balance ?? 0,
        totalEarned: this.summary()?.totalEarned ?? 0,
      },
      pushed: this.ws.referralBalanceUpdated(),
    }),
    computation: (sources, previous) => {
      if (!previous) return sources.fetched;

      const pushed = sources.pushed;
      if (pushed !== null && pushed !== previous.source.pushed)
        return { balance: pushed.referralBalance, totalEarned: pushed.totalEarned };

      // Compared field by field, not by reference: `source` rebuilds this
      // object on every read, so a reference check would call it changed every
      // time and the push would never win.
      const fetched = sources.fetched;
      const previousFetched = previous.source.fetched;
      if (
        fetched.balance !== previousFetched.balance ||
        fetched.totalEarned !== previousFetched.totalEarned
      )
        return fetched;

      return previous.value;
    },
  });

  readonly balance = computed(() => this.totals().balance);
  readonly totalEarned = computed(() => this.totals().totalEarned);

  readonly referrals = computed<readonly ReferralEntry[]>(() => this.summary()?.referrals ?? []);

  readonly canTransfer = computed(() => {
    const cents = this.transferCents();

    return !this.transferring() && cents > 0 && cents <= this.balance();
  });

  readonly canRedeem = computed(
    () => !this.redeeming() && REFERRAL_CODE_PATTERN.test(this.codeInput().trim().toUpperCase()),
  );

  /**
   * The push already reflected on screen.
   *
   * Seeded from whatever the socket signal holds at mount, for the same reason
   * the totals above are: a latched event from an earlier visit is not news and
   * must not trigger a refetch.
   */
  private lastHandledEarning = this.ws.referralBalanceUpdated();

  /**
   * A payout landing while the page is open moves the per-referral breakdown
   * too, and the push carries only the two totals — so the list is re-read.
   * Quietly, without dropping a page the user is reading back to its spinner.
   */
  private readonly earningRefresh = effect(() => {
    const event = this.ws.referralBalanceUpdated();
    if (event === null || event === this.lastHandledEarning) return;

    this.lastHandledEarning = event;
    void this.load(false);
  });

  /** One timer per confirmation, so a copy does not cut a transfer's short. */
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;
  private codeCopiedTimer: ReturnType<typeof setTimeout> | undefined;
  private transferredTimer: ReturnType<typeof setTimeout> | undefined;

  async ngOnInit(): Promise<void> {
    this.ws.connect();
    await this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
    clearTimeout(this.transferredTimer);
  }

  /** Fills the field with everything available, in whole USDT. */
  transferAll(): void {
    this.tma.hapticFeedback('light');
    this.transferUsdt.set(this.balance() / CENTS_PER_USDT);
  }

  async transfer(): Promise<void> {
    if (!this.canTransfer()) return;

    this.transferring.set(true);
    this.errorMsg.set('');

    try {
      await this.referralService.transfer(this.transferCents());
      this.transferUsdt.set(null);
      this.tma.hapticFeedback('success');

      this.transferred.set(true);
      clearTimeout(this.transferredTimer);
      this.transferredTimer = setTimeout(() => this.transferred.set(false), CONFIRMATION_MS);

      // Both balances moved server-side; re-read so the pot, the spendable
      // balance and the breakdown all come from one consistent state.
      await this.load(false);
    } catch (error: unknown) {
      this.tma.hapticFeedback('error');
      this.errorMsg.set(this.apiError.messageFor(error));
    } finally {
      this.transferring.set(false);
    }
  }

  async redeem(): Promise<void> {
    if (!this.canRedeem()) return;

    this.redeeming.set(true);
    this.errorMsg.set('');

    try {
      const summary = await this.referralService.redeem(this.codeInput().trim().toUpperCase());
      this.summary.set(summary);
      this.codeInput.set('');
      this.tma.hapticFeedback('success');
    } catch (error: unknown) {
      this.tma.hapticFeedback('error');
      this.errorMsg.set(this.apiError.messageFor(error));
    } finally {
      this.redeeming.set(false);
    }
  }

  async copyLink(): Promise<void> {
    await this.copy(this.summary()?.link, this.copied, 'copiedTimer');
  }

  /** The code alone, for sending in a message rather than as a link. */
  async copyCode(): Promise<void> {
    await this.copy(this.summary()?.code, this.codeCopied, 'codeCopiedTimer');
  }

  /**
   * Copies a value and flashes its own confirmation.
   *
   * The timer key is passed in so each confirmation clears only itself —
   * copying the code must not cut short the badge from copying the link.
   *
   * A clipboard failure is swallowed on purpose: the API is unavailable on
   * insecure origins and in some in-app browsers, and the value is on screen to
   * be selected by hand either way, so an error message would only be noise.
   */
  private async copy(
    value: string | undefined,
    flag: WritableSignal<boolean>,
    timerKey: 'copiedTimer' | 'codeCopiedTimer',
  ): Promise<void> {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      this.tma.hapticFeedback('light');

      flag.set(true);
      clearTimeout(this[timerKey]);
      this[timerKey] = setTimeout(() => flag.set(false), CONFIRMATION_MS);
    } catch {
      /* clipboard not available */
    }
  }

  /** USDT cents, from the whole-USDT figure the user typed. */
  private transferCents(): number {
    return Math.round((this.transferUsdt() ?? 0) * CENTS_PER_USDT);
  }

  /**
   * @param showSpinner `false` for a background refresh, so a socket push does
   * not blank a page the user is reading.
   */
  private async load(showSpinner = true): Promise<void> {
    if (showSpinner) this.loading.set(true);

    try {
      // `showSpinner` doubles as "the user is waiting on this": a background
      // refresh must not blur a page they are reading.
      this.summary.set(await this.referralService.getSummary(!showSpinner));
    } catch (error: unknown) {
      this.errorMsg.set(this.apiError.messageFor(error));
    } finally {
      this.loading.set(false);
    }
  }
}
