import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  linkedSignal,
  signal,
  type WritableSignal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  isFiatDepositPayable,
  TmaFiatDepositStatus,
  TmaFiatReceiptStatus,
  type FiatDepositStatusEvent,
  type TmaFiatDeposit,
} from '@transacto/contracts';
import { FiatDepositService } from '../../services/fiat-deposit.service';
import { ConfirmFiatCancelModal } from '../../modals/confirm-fiat-cancel/confirm-fiat-cancel.modal';
import { environment } from '../../../../environments/environment';
import { TmaService } from '../../../auth/services/tma.service';
import { WsService } from '../../../realtime/services/ws.service';
import { ApiErrorService } from '../../../shared/services/api-error.service';
import {
  formatUah,
  formatUahPlain,
  formatUahWhole,
  formatUsdt,
} from '../../../shared/utils/format.util';

/** Seconds in a minute, for the countdown's own arithmetic. */
const SECONDS_PER_MINUTE = 60;

/** How long a row says "copied" before going back to offering the copy. */
const COPIED_FLASH_MS = 2_000;

/**
 * One reserved payout: who to pay, how long is left, and what has landed.
 *
 * The card on this screen belongs to a stranger's payout that is, for now, this
 * user's to settle. Everything here follows from that: the timer is real, the
 * amount has to be transferred exactly, and the screen stops offering the card
 * the moment the top-up is no longer payable.
 */
@Component({
  selector: 'app-fiat-deposit-order',
  imports: [TranslatePipe, ConfirmFiatCancelModal],
  templateUrl: './fiat-deposit-order.component.html',
  styleUrl: './fiat-deposit-order.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiatDepositOrderComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fiatDeposits = inject(FiatDepositService);
  private readonly tma = inject(TmaService);
  private readonly apiError = inject(ApiErrorService);
  private readonly ws = inject(WsService);

  private readonly depositId = this.route.snapshot.paramMap.get('id') ?? '';

  /**
   * The top-up, from HTTP first and the socket thereafter.
   *
   * A `linkedSignal` rather than an `effect()` writing a signal. The push is a
   * movement, not a snapshot — status and coverage only — so it is merged into
   * what is held, and a push for one of this user's *other* top-ups (the socket
   * room is per-user, so those arrive here too) leaves the held value alone.
   */
  readonly deposit = linkedSignal<FiatDepositStatusEvent | null, TmaFiatDeposit | null>({
    source: () => this.ws.fiatDepositStatusChanged(),
    computation: (pushed, previous) => {
      const held = previous?.value ?? null;
      if (held === null || pushed === null || pushed.depositId !== held.id) return held;

      const payable = isFiatDepositPayable(pushed.status);

      return {
        ...held,
        status: pushed.status,
        coveredUah: pushed.coveredUah,
        // The server stops sending the card once a top-up closes, and so does
        // this: a screen left open must not still invite a transfer.
        recipientCard: payable ? held.recipientCard : null,
      };
    },
  });

  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly cancelling = signal(false);
  readonly appealing = signal(false);
  /** Whether the "give the payout back?" sheet is open. */
  readonly confirmingCancel = signal(false);
  /**
   * One flag per copyable row, rather than one shared "copied".
   *
   * Two rows offer a copy on this screen and they are copied one after the
   * other; a single flag would flash the confirmation on both, and the second
   * tap would look like it had copied the card when it had copied the amount.
   */
  readonly copiedCard = signal(false);
  readonly copiedAmount = signal(false);
  readonly errorMsg = signal('');
  readonly secondsLeft = signal(0);

  protected readonly TmaFiatDepositStatus = TmaFiatDepositStatus;
  protected readonly TmaFiatReceiptStatus = TmaFiatReceiptStatus;

  readonly formatUahWhole = formatUahWhole;
  readonly formatUsdt = formatUsdt;

  readonly status = computed(() => this.deposit()?.status ?? null);
  readonly isPayable = computed(() => {
    const status = this.status();
    return status !== null && isFiatDepositPayable(status);
  });

  /** Anything already accepted, which is what makes cancelling somebody else's call. */
  readonly hasPaidSomething = computed(() => (this.deposit()?.coveredUah ?? 0) > 0);

  /** A receipt is with Transacto's recognition and has no verdict yet. */
  readonly recognising = computed(() =>
    (this.deposit()?.receipts ?? []).some(
      (receipt) => receipt.status === TmaFiatReceiptStatus.PARSING,
    ),
  );

  /**
   * Everything is paid and the top-up has not closed yet.
   *
   * The gap is real and can last minutes: coverage is arithmetic over accepted
   * receipts, but a top-up completes only when Transacto reports the payout
   * executed, which a reconciler notices on its own schedule. Before this
   * existed the screen kept saying "transfer exactly ₴0" into that gap — an
   * instruction that cannot be followed, on a screen where the user had in fact
   * done everything right.
   */
  readonly awaitingConfirmation = computed(() => this.isPayable() && this.remainingUah() === 0);

  /** Whether there is still a transfer to make. */
  readonly awaitingPayment = computed(() => this.isPayable() && this.remainingUah() > 0);

  readonly remainingUah = computed(() => {
    const deposit = this.deposit();
    return deposit === null ? 0 : Math.max(0, deposit.amountUah - deposit.coveredUah);
  });

  /**
   * The sum to transfer, written whole only when it is whole.
   *
   * `formatUahWhole` on its own rounded it — under a label that says
   * *exactly*, and beside a copy button that hands over the real figure. A
   * remainder is very often not whole: coverage is counted in the amounts
   * Transacto read off the receipts, so anything paid in parts leaves kopecks
   * behind.
   */
  readonly remainingLabel = computed(() => {
    const kopecks = this.remainingUah();

    return kopecks % 100 === 0 ? formatUahWhole(kopecks) : formatUah(kopecks);
  });

  readonly coveragePercent = computed(() => {
    const deposit = this.deposit();
    if (deposit === null || deposit.amountUah === 0) return 0;

    return Math.min(100, Math.round((deposit.coveredUah / deposit.amountUah) * 100));
  });

  readonly formattedTime = computed(() => {
    const seconds = this.secondsLeft();
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
    const rest = seconds % SECONDS_PER_MINUTE;

    return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
  });

  /**
   * The deadline has passed but the receipt can still be uploaded.
   *
   * Deliberately not the same thing as "closed": the payout is held past the
   * visible timer precisely so somebody who paid at the last second can still
   * prove it.
   */
  readonly overdue = computed(() => this.awaitingPayment() && this.secondsLeft() === 0);

  private timer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    this.tma.showBackButton(() => this.router.navigate(['/']));
    await this.load();
  }

  ngOnDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.tma.hideBackButton();
  }

  async load(): Promise<void> {
    this.loading.set(true);

    try {
      const deposit = await this.fiatDeposits.getById(this.depositId);
      this.deposit.set(deposit);
      this.startCountdown(deposit.payDeadlineAt);
    } catch (err: unknown) {
      this.errorMsg.set(this.apiError.messageFor(err));
    } finally {
      this.loading.set(false);
    }
  }

  async copyCard(): Promise<void> {
    const card = this.deposit()?.recipientCard;
    if (!card) return;

    await this.copy(card, this.copiedCard);
  }

  /**
   * The sum still to transfer, in the plainest form a bank will accept.
   *
   * What is copied is what is owed *now* — the same figure the row shows — so
   * somebody who has already covered part of the payout pastes the remainder
   * rather than the original amount and overpays a stranger's payout.
   */
  async copyAmount(): Promise<void> {
    await this.copy(formatUahPlain(this.remainingUah()), this.copiedAmount);
  }

  /**
   * One copy, one flash of "copied", and silence when there is no clipboard.
   *
   * A refusal here is not worth an error on screen: the number and the card are
   * both still on it, in full, to be read off by hand.
   */
  private async copy(text: string, copied: WritableSignal<boolean>): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied.set(true);
      this.tma.hapticFeedback('light');
      setTimeout(() => copied.set(false), COPIED_FLASH_MS);
    } catch {
      /* clipboard not available */
    }
  }

  async onReceiptPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined || this.uploading()) return;

    this.uploading.set(true);
    this.errorMsg.set('');

    try {
      this.deposit.set(await this.fiatDeposits.uploadReceipt(this.depositId, file));
      this.tma.hapticFeedback('success');
    } catch (err: unknown) {
      this.errorMsg.set(this.apiError.messageFor(err));
      this.tma.hapticFeedback('error');
    } finally {
      this.uploading.set(false);
      // Cleared so picking the same file again still fires a change event —
      // which is exactly what somebody re-uploading after a refusal does.
      input.value = '';
    }
  }

  /**
   * Opens the confirmation rather than cancelling.
   *
   * The tap that gives a payout back has to be the second one: the first is too
   * easy to make while waiting, and the payout is gone the moment it lands.
   */
  askToCancel(): void {
    if (this.cancelling() || this.hasPaidSomething()) return;

    this.tma.hapticFeedback('light');
    this.confirmingCancel.set(true);
  }

  /**
   * Asks an operator to look at a top-up the clock beat, then opens the chat.
   *
   * Two steps and both matter: the write stops the payout being released on the
   * hold sweep and puts the row where an operator will see it, and the chat is
   * where the user actually shows the receipt. The bot is opened even when the
   * write fails — somebody who has transferred money and cannot upload proof
   * must reach a person either way.
   */
  async appeal(): Promise<void> {
    if (this.appealing()) return;

    this.appealing.set(true);
    this.errorMsg.set('');

    try {
      this.deposit.set(await this.fiatDeposits.appeal(this.depositId));
      this.tma.hapticFeedback('success');
    } catch (err: unknown) {
      this.errorMsg.set(this.apiError.messageFor(err));
      this.tma.hapticFeedback('error');
    } finally {
      this.appealing.set(false);
      if (environment.botUrl) this.tma.openTelegramLink(environment.botUrl);
    }
  }

  async cancel(): Promise<void> {
    if (this.cancelling() || this.hasPaidSomething()) return;

    this.cancelling.set(true);
    this.errorMsg.set('');

    try {
      this.deposit.set(await this.fiatDeposits.cancel(this.depositId));
      this.tma.hapticFeedback('light');
      this.confirmingCancel.set(false);
    } catch (err: unknown) {
      this.errorMsg.set(this.apiError.messageFor(err));
      // The sheet stays open on a failure, with the message under it: closing
      // it would leave the user looking at a top-up that is still live with no
      // idea why the tap did nothing.
    } finally {
      this.cancelling.set(false);
    }
  }

  goToDashboard(): void {
    this.router.navigate(['/']);
  }

  private startCountdown(deadline: string): void {
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(deadline).getTime() - Date.now()) / 1000),
      );
      this.secondsLeft.set(remaining);
      if (remaining === 0 && this.timer !== null) clearInterval(this.timer);
    };

    tick();
    this.timer = setInterval(tick, 1000);
  }
}
