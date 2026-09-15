import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { FiatDepositWatchMode } from '@transacto/contracts';
import type {
  FiatDepositAmountOption,
  FiatDepositWatch,
  SaveFiatDepositWatchReq,
} from '@transacto/contracts';
import { NgTemplateOutlet } from '@angular/common';
import { FiatDepositService } from '../../services/fiat-deposit.service';
import { ConfirmFiatAmountModal } from '../../modals/confirm-fiat-amount/confirm-fiat-amount.modal';
import { FiatRulesModal } from '../../modals/fiat-rules/fiat-rules.modal';
import { FiatWatchModal } from '../../modals/fiat-watch/fiat-watch.modal';
import { TmaService } from '../../../auth/services/tma.service';
import { ApiErrorService } from '../../../shared/services/api-error.service';
import { formatUahWhole, formatUsdt } from '../../../shared/utils/format.util';
import { ExchangeRateComponent } from '../../../shared/components/exchange-rate/exchange-rate.component';
import { selectBuyRate } from '../../../core/store/rates.selectors';

/** How often the offer is re-read while the screen is open. */
const REFRESH_INTERVAL_MS = 20_000;

/**
 * The amounts a user can top up with by paying somebody's payout.
 *
 * Only sums are shown. The card behind each one belongs to a payout anybody may
 * still take, and it is revealed on the next screen — once the payout is
 * actually theirs.
 *
 * Nothing here is reserved on a single tap. A tap opens
 * {@link ConfirmFiatAmountModal}, because reserving takes a stranger's payout in
 * this user's name and starts a clock they cannot stop.
 */
@Component({
  selector: 'app-fiat-deposit-amounts',
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    ExchangeRateComponent,
    ConfirmFiatAmountModal,
    FiatRulesModal,
    FiatWatchModal,
  ],
  templateUrl: './fiat-deposit-amounts.component.html',
  styleUrl: './fiat-deposit-amounts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiatDepositAmountsComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly fiatDeposits = inject(FiatDepositService);
  private readonly tma = inject(TmaService);
  private readonly apiError = inject(ApiErrorService);
  private readonly store = inject(Store);

  /**
   * Kopecks per USDT for this product — the discounted top-up rate, from the
   * one poll that feeds every screen.
   *
   * The per-amount USDT figures below still come from the options response,
   * because those are what the server priced and what a reservation freezes.
   * The two agree by construction: both are the same discount applied to the
   * same cached market figure.
   */
  readonly exchangeRate = this.store.selectSignal(selectBuyRate);

  readonly options = signal<readonly FiatDepositAmountOption[]>([]);
  /** Whether the rules sheet is open. */
  readonly showingRules = signal(false);
  readonly payWindowMinutes = signal(0);
  readonly loading = signal(true);
  /**
   * Whether the list is on the automatic refresh — which is what the bar under
   * the rate is drawing, and why it goes away the moment
   * {@link stopRefreshing} does.
   */
  readonly polling = signal(false);
  /** A background re-read is in flight; the bar says so rather than sitting full. */
  readonly refreshing = signal(false);
  /**
   * Bumped on every tick so the template can throw the bar away and build a new
   * one, which is the only way a CSS animation starts over. Its value means
   * nothing; that it changed is the whole signal.
   */
  readonly cycle = signal(0);
  /** The bar spans one interval exactly, from the constant, so the two cannot drift. */
  readonly refreshDurationMs = `${REFRESH_INTERVAL_MS}ms`;
  /** The amount awaiting confirmation, or `null` when no dialog is open. */
  readonly pending = signal<FiatDepositAmountOption | null>(null);
  /** The amount being reserved right now, which freezes the dialog's buttons. */
  readonly reserving = signal<number | null>(null);
  readonly errorMsg = signal('');
  readonly loadFailed = signal(false);
  /**
   * Whether the offer above is a reading of Transacto's book at all.
   *
   * Starts `true` so the apology is never the first thing a user sees while the
   * first read is still in flight. Together with {@link loadFailed} it is what
   * separates "there is nothing right now" from "this is our fault" — the two
   * used to render as the same empty list.
   */
  readonly bookAvailable = signal(true);
  /**
   * This user's standing request for an amount, or `null` when they have none.
   *
   * `undefined` is the third state and the reason this is not just `null`: it
   * means the offer has not been read yet, or the read failed. Without it a
   * failed load rendered the "not found a suitable amount?" prompt at somebody
   * who already had a request — the same lie the settings screen was written to
   * avoid, and worst in the outage case, where accepting the prompt would
   * overwrite the range they could no longer see.
   */
  readonly watch = signal<FiatDepositWatch | null | undefined>(undefined);
  /** Whether the request sheet is open. */
  readonly editingWatch = signal(false);
  /** A save or a cancellation is in flight; the sheet's controls stop answering. */
  readonly savingWatch = signal(false);
  readonly watchErrorMsg = signal('');

  /** Read by the template to name the mode of an existing request. */
  readonly Mode = FiatDepositWatchMode;

  readonly formatUahWhole = formatUahWhole;
  readonly formatUsdt = formatUsdt;

  /**
   * Re-reads the offer while the screen is open.
   *
   * The amounts move: payouts are taken by other traders. The rate no longer
   * moves with them — it arrives on the app-wide poll — so this refreshes the
   * list alone.
   */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Whether this screen is still the one the user is looking at.
   *
   * A load started before they left resolves after they have gone, and a
   * navigation issued from it would move somebody who is already somewhere
   * else. Clearing the timer is not enough on its own: it stops the *next*
   * refresh, not the request already in flight.
   */
  private open = false;

  /**
   * Bumped by every write to the standing request.
   *
   * The offer is re-read every twenty seconds and carries the request with it,
   * so a poll that left before a save or a cancel answers after it and would
   * put the old value back — the just-saved request blanked to "not
   * subscribed", or a cancelled one back on screen offering to be cancelled
   * again. A boolean cannot express that; a sequence can.
   */
  private watchGeneration = 0;

  async ngOnInit(): Promise<void> {
    this.open = true;
    this.tma.showBackButton(() => this.router.navigate(['/deposit']));
    await this.load();

    this.startRefreshing();
  }

  /**
   * The same cadence the server re-reads Transacto's book at, so the screen is
   * never more than one poll behind what can actually be reserved.
   *
   * The cycle is bumped here rather than inside {@link load}, so the bar tracks
   * the tick itself: a refresh the dialog suppresses still consumed an
   * interval, and a bar that stalled through it would promise a list that was
   * not being re-read.
   */
  private startRefreshing(): void {
    this.polling.set(true);
    this.refreshTimer = setInterval(() => {
      this.cycle.update((value) => value + 1);
      void this.load(true);
    }, REFRESH_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    this.open = false;
    this.stopRefreshing();
    this.tma.hideBackButton();
  }

  private stopRefreshing(): void {
    this.polling.set(false);

    if (this.refreshTimer === null) return;

    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  /**
   * Opens the top-up the user already holds, unless they have left this screen.
   *
   * The check is the point: `getOptions` is a round trip, and on a slow one the
   * user is long gone by the time it answers. Navigating then would pull them
   * back from wherever they had got to.
   */
  private async navigateToActive(depositId: string): Promise<void> {
    if (!this.open) return;

    await this.router.navigate(['/deposit/fiat', depositId]);
  }

  /**
   * Also the retry handler, so a passing outage costs one tap.
   *
   * `silent` is the background refresh: it must not blank a list the user is
   * reading, and it must not fire while a confirmation is open or a reservation
   * is in flight — the amount under their finger is about to be claimed, and
   * pulling the list out from under the dialog would leave the two disagreeing.
   */
  async load(silent = false): Promise<void> {
    if (silent && (this.pending() !== null || this.reserving() !== null)) return;

    this.loading.set(!silent);
    this.refreshing.set(silent);
    if (!silent) this.loadFailed.set(false);

    // Which request this is, for the request that is about to answer. A write
    // to the standing request bumps it, so an answer that left before the write
    // cannot put the old value back afterwards.
    const generation = this.watchGeneration;

    try {
      const config = await this.fiatDeposits.getOptions();

      // A user who already holds a top-up is sent back to it rather than shown
      // a list every tap on which would be refused.
      //
      // **Only on a load they asked for.** A background refresh that navigated
      // took the screen out from under somebody who had deliberately left the
      // top-up behind — and took it again twenty seconds later, and again after
      // that. A top-up under review is the case that made it unbearable: an
      // operator has to act on it, the user cannot, and nothing they did got
      // them away from a screen that only said "being checked". A refresh that
      // finds one now stops refreshing instead, because there is nothing left
      // on this list for them to act on either.
      if (config.activeDepositId !== null) {
        if (silent) {
          this.stopRefreshing();

          return;
        }

        await this.navigateToActive(config.activeDepositId);

        return;
      }

      this.options.set(config.options);
      this.payWindowMinutes.set(config.payWindowMinutes);
      this.bookAvailable.set(config.bookAvailable);
      // Cleared on **any** load that worked, not only one the user asked for.
      // It used to be cleared only by a non-silent read, so a screen whose
      // first read failed kept apologising over a list the poll had already
      // filled — for as long as the app stayed open, with a Retry button as the
      // only way out of a state that had already fixed itself.
      this.loadFailed.set(false);

      // Not while the sheet is open, and not if a write has happened since this
      // request left: either would put a stale answer on screen over what the
      // user has just done.
      if (!this.editingWatch() && generation === this.watchGeneration)
        this.watch.set(config.watch);
    } catch {
      // A failed background refresh leaves the last good offer on screen; only
      // a failed first read is worth telling the user about.
      if (!silent) this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  /**
   * Opens the sheet where a range is left.
   *
   * Deliberately reachable whether or not the list is empty, and whether or not
   * the book could be read: somebody looking at nothing at all is exactly who
   * should be offered the chance to be called back.
   */
  openWatch(): void {
    this.tma.hapticFeedback('light');
    this.watchErrorMsg.set('');
    this.editingWatch.set(true);
  }

  dismissWatch(): void {
    if (this.savingWatch()) return;

    this.editingWatch.set(false);
  }

  async saveWatch(request: SaveFiatDepositWatchReq): Promise<void> {
    if (this.savingWatch()) return;

    this.savingWatch.set(true);
    this.watchErrorMsg.set('');
    this.watchGeneration += 1;

    try {
      this.watch.set(await this.fiatDeposits.saveWatch(request));
      this.tma.hapticFeedback('success');
      this.editingWatch.set(false);
    } catch (err: unknown) {
      // Two of the three refusals are rules only the server knows — the
      // account's ceiling and the product's own floor — so its answer is the
      // message, translated by code.
      this.watchErrorMsg.set(this.apiError.messageFor(err));
      this.tma.hapticFeedback('error');
    } finally {
      this.savingWatch.set(false);
    }
  }

  /**
   * Cancels the standing request.
   *
   * Cleared optimistically and put back if the server refuses, for the same
   * reason every other toggle in this app is: a control that waits for a round
   * trip before moving reads as broken on a phone.
   */
  async cancelWatch(): Promise<void> {
    if (this.savingWatch()) return;

    const previous = this.watch();
    this.savingWatch.set(true);
    this.watchGeneration += 1;
    this.watch.set(null);
    this.tma.hapticFeedback('light');

    try {
      await this.fiatDeposits.removeWatch();
    } catch (err: unknown) {
      this.watch.set(previous);
      this.errorMsg.set(this.apiError.messageFor(err));
      this.tma.hapticFeedback('error');
    } finally {
      this.savingWatch.set(false);
    }
  }

  openRules(): void {
    this.tma.hapticFeedback('light');
    this.showingRules.set(true);
  }

  /** Opens the confirmation. Nothing is claimed until it is answered. */
  select(option: FiatDepositAmountOption): void {
    if (this.reserving() !== null) return;

    this.errorMsg.set('');
    this.tma.hapticFeedback('light');
    this.pending.set(option);
  }

  dismiss(): void {
    if (this.reserving() !== null) return;

    this.pending.set(null);
  }

  async confirm(): Promise<void> {
    const option = this.pending();
    if (option === null || this.reserving() !== null) return;

    this.reserving.set(option.amountUah);
    this.errorMsg.set('');

    try {
      const deposit = await this.fiatDeposits.reserve(option.amountUah);
      this.tma.hapticFeedback('success');
      await this.router.navigate(['/deposit/fiat', deposit.id]);
    } catch (err: unknown) {
      // Losing the race for an amount is ordinary here, so the list is
      // refreshed with the refusal rather than left showing a sum that is gone.
      this.errorMsg.set(this.apiError.messageFor(err));
      this.tma.hapticFeedback('error');
      this.pending.set(null);
      await this.load();
    } finally {
      this.reserving.set(null);
    }
  }
}
