import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { exhaustMap, filter } from 'rxjs';
import {
  CENTS_PER_USDT,
  DEFAULT_MIN_ORDER_KOPECKS,
  minSaleTargetKopecks,
  priceSale,
  priceStake,
  roundToWholeUah,
  type SaleAwaitingJar,
  type SaleConfigResponse,
  type SaleQuote,
} from '@transacto/contracts';
import { ActivatedRoute } from '@angular/router';
import { selectSellRate } from '../../core/store/rates.selectors';
import type { SaleRateChange } from '../interfaces/sale-rate-change.interface';
import { SALE_CONFIG_KEY } from '../resolvers/sale-config.resolver';
import { SaleService } from './sale.service';

/**
 * What a sale costs and whether it may be created — the half both forms share.
 *
 * **It exists because the two forms had already drifted.** The jar form and the
 * card form each kept their own copy of `GET /sales/config`, of the target and
 * stake arithmetic, and of the three refusals derived from them — and two of
 * those copies disagreed. `slotsExhausted` guarded against an allowance of zero
 * on one page and not the other; `belowMinimum` compared whole USDT on one and
 * cents on the other, through two import paths to the same constant. Neither
 * was noticeable on either screen alone, which is what makes it the kind of
 * divergence worth removing rather than documenting.
 *
 * What stays on each page is what genuinely differs: a jar sale's goal and
 * card-mask checks, a card sale's card and recipient-name checks. Those have
 * nothing in common and collapsing them would need the `if` the two forms exist
 * to avoid.
 *
 * **The rate is followed for as long as the form is open.** It used to be read
 * once, by the route's resolver, and a form left open for a minute went on
 * quoting it after the market had moved — while the server re-priced the
 * submitted total at the live rate and froze a stake the screen had never
 * shown. Now the app's one rate poll is the trigger: when it sees a sell rate
 * this form is not priced at, the config is read again, every figure is
 * recomputed from it, and {@link rateChange} says what moved.
 *
 * Not `providedIn: 'root'`: this holds one form's state, and two forms open one
 * after another must not inherit each other's amount. Provided by the page.
 */
@Injectable()
export class SalePricingService {
  private readonly saleService = inject(SaleService);
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(Store);

  /** What the user typed, in whole USDT. The page owns the input; this prices it. */
  readonly usdtAmount = signal<number | null>(null);

  /**
   * A hryvnia total this sale is held at, in kopecks — or `null` while the
   * total follows the USDT typed.
   *
   * Set when a jar seller pulls the amount up to their jar's goal. The goal
   * lives in a banking app and takes a minute to change; the stake is a number
   * on this screen. So once the two agree, a move in the rate re-derives the
   * USDT and leaves the goal where it is. The other way round moved the total
   * off a goal the seller had already set, and sent them back into their bank
   * for as long as the market kept moving.
   *
   * Released the moment they type an amount: a figure typed is a figure meant.
   */
  readonly heldTargetKopecks = signal<number | null>(null);

  /** All from `GET /sales/config`; the literals are only a first paint. */
  readonly sellRateKopecks = signal(0);
  readonly balanceCents = signal(0);
  readonly maxParallelOrders = signal(0);
  readonly openOrders = signal(0);
  readonly awaitingJarClosure = signal<readonly SaleAwaitingJar[]>([]);
  readonly minOrderKopecks = signal(DEFAULT_MIN_ORDER_KOPECKS);
  readonly rateUnavailable = signal(false);

  /**
   * What the form showed before the rate last moved under it — or `null` when
   * it has not moved since the user last touched the amount.
   *
   * The screen says so whenever this is set: the rate it moved from and to, and
   * the figures before and after. A total that changes by itself is the one
   * thing a seller must not first learn about from the finished sale.
   */
  readonly rateChange = signal<SaleRateChange | null>(null);

  /**
   * The sale this form describes, priced exactly as the server prices it.
   *
   * **A typed amount is the stake, to the cent** — `priceStake` — and the total
   * is its price rounded to the nearest hryvnia. It used to be the other way
   * round: the total was floored and the stake recovered from it, so ten USDT
   * at ₴48.19 became ₴481 and 9.98 USDT, and a seller found a different amount
   * on the finished sale from the one they had typed, more often than not.
   *
   * **A held total is the jar's goal**, and the stake is what that goal costs —
   * `priceSale`, the direction a figure set in a bank has to take.
   */
  readonly quote = computed<SaleQuote>(() => {
    const held = this.heldTargetKopecks();

    return held !== null
      ? priceSale(held, this.sellRateKopecks())
      : priceStake(Math.round((this.usdtAmount() ?? 0) * CENTS_PER_USDT), this.sellRateKopecks());
  });

  /** The whole-hryvnia total, in kopecks — the figure a jar's goal is set to. */
  readonly targetKopecks = computed(() => this.quote().targetKopecks);

  /** The USDT that leaves the balance, in cents — what is sold. */
  readonly stakeCents = computed(() => this.quote().requiredUsdtCents);

  /**
   * What the amount field shows: the figure typed — or, while the total is
   * held, the USDT it costs at the rate that applies now, which is the figure
   * that changes when the market does.
   */
  readonly amountField = computed(() => {
    if (this.heldTargetKopecks() === null) return this.usdtAmount();

    const cents = this.stakeCents();

    return cents > 0 ? cents / CENTS_PER_USDT : null;
  });

  /**
   * Whether this sale is under the minimum amount, as the server decides it.
   *
   * **It used to compare the stake against ten USDT flat, and that refused the
   * minimum itself.** The stake was recovered from a floored total then, and
   * typing exactly ten produced 9.99 on most rates — so the form disabled its
   * own button beside a line reading "minimum 10 USDT". A typed stake is exact
   * now, but a held total's stake is still recovered from the goal and drifts
   * with the rate, and one rule has to judge both.
   *
   * `minSaleTargetKopecks` is the same call the server makes, in the same
   * units — see it for why the floor is a target rather than a stake.
   */
  readonly belowMinimum = computed(
    () =>
      this.targetKopecks() > 0 &&
      this.targetKopecks() < minSaleTargetKopecks(this.sellRateKopecks()),
  );

  readonly hasSufficientBalance = computed(() => this.stakeCents() <= this.balanceCents());

  /**
   * Guarded on the allowance being known.
   *
   * Before the config lands `maxParallelOrders` is zero, and `0 >= 0` would
   * refuse every order on a screen that has not finished loading.
   */
  readonly slotsExhausted = computed(
    () => this.maxParallelOrders() > 0 && this.openOrders() >= this.maxParallelOrders(),
  );

  /** Everything both forms require, whatever else each of them also requires. */
  readonly isPriced = computed(
    () =>
      this.sellRateKopecks() > 0 &&
      this.stakeCents() > 0 &&
      !this.belowMinimum() &&
      this.hasSufficientBalance() &&
      !this.slotsExhausted(),
  );

  constructor() {
    // The poll is only the trigger — the rate this form prices at still comes
    // from `/sales/config`, beside the balance and the allowance it is judged
    // against, for the reason `RatesState` gives. What the poll adds is the
    // moment: the form learns the market moved when the rest of the app does,
    // and asks again then rather than on a timer of its own.
    //
    // Nothing is asked before the resolver's figures are seeded, since those
    // were read a moment ago; and `exhaustMap` drops a second move that lands
    // while the first re-read is still in flight — the answer to the first is
    // already the newer figure.
    this.store
      .select(selectSellRate)
      .pipe(
        filter(
          (polled) =>
            polled !== null && this.sellRateKopecks() > 0 && polled !== this.sellRateKopecks(),
        ),
        exhaustMap(() => this.refresh()),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /**
   * The amount field's writer: a figure typed, which releases a held total.
   *
   * Also clears {@link rateChange}. A report of what the rate did to the old
   * figures is about figures no longer on screen once the user has typed new
   * ones.
   */
  setAmount(usdt: number | null): void {
    this.heldTargetKopecks.set(null);
    this.usdtAmount.set(usdt);
    this.rateChange.set(null);
  }

  /**
   * Holds the total at a hryvnia figure — a jar's goal — and lets the USDT
   * follow the rate from here on. See {@link heldTargetKopecks}.
   *
   * Snapped to whole hryvnia as the server snaps it: a goal reported as
   * 234 999 kopecks is the ₴2 350 the owner typed.
   */
  holdTarget(kopecks: number): void {
    this.heldTargetKopecks.set(roundToWholeUah(kopecks));
    this.rateChange.set(null);
  }

  /** The user has read what the rate did. */
  dismissRateChange(): void {
    this.rateChange.set(null);
  }

  /**
   * Takes the figures a route resolver already fetched.
   *
   * **The form's normal way in.** Fetching from `ngOnInit` meant the first
   * frame was painted from the literals above — a balance of 0.00, an allowance
   * of zero — and every rule derived from them was false for as long as the
   * request took. The user watched a balance they do not have, and a refusal,
   * get replaced by the truth.
   *
   * `null` is the resolver's way of saying the call failed. It is treated
   * exactly as a failed {@link load}, so the screen has one description of that
   * state rather than two.
   */
  seed(config: SaleConfigResponse | null | undefined): void {
    // Falsy rather than `=== null`: route data is untyped, so a key that is
    // absent arrives as `undefined` — and reading an allowance off that is a
    // crash, not a degraded form.
    if (!config) {
      this.sellRateKopecks.set(0);
      this.rateUnavailable.set(true);
      // A move reported to a rate that is now unknown would read "→ 0,00"; the
      // outage is the news, and it has its own line.
      this.rateChange.set(null);

      return;
    }

    // Before anything moves, so the record is of what was on screen.
    this.noteRateChange(config.sellRate);

    this.maxParallelOrders.set(config.maxParallelOrders);
    this.openOrders.set(config.openOrders);
    // `?? []` for a server older than the field: an absent list is "we cannot
    // tell you which", which must read as none rather than crash the form.
    this.awaitingJarClosure.set(config.slotsAwaitingJarClosure ?? []);
    this.balanceCents.set(config.balance);
    this.sellRateKopecks.set(config.sellRate);
    this.minOrderKopecks.set(config.minOrderKopecks || DEFAULT_MIN_ORDER_KOPECKS);
    // The whole config call 503s when the market is unreachable, so a rate of
    // zero here means the same thing as the request failing outright.
    this.rateUnavailable.set(!config.sellRate);
  }

  /**
   * Takes them from the route, where the resolver left them.
   *
   * Here rather than in each form so that neither has to know the key the
   * resolver files them under, nor to assert the type of an untyped `data` bag.
   * Both forms called `seed(route.snapshot.data[KEY] as …)` and that cast is
   * exactly the kind of thing that is right in one copy and wrong in the other.
   */
  seedFromRoute(): void {
    this.seed(this.route.snapshot.data[SALE_CONFIG_KEY] as SaleConfigResponse | null | undefined);
  }

  /**
   * Fetches them again — the retry handler, and the path a refused quote takes
   * when the rate has moved under it. A passing outage costs one tap.
   */
  async load(): Promise<void> {
    this.rateUnavailable.set(false);

    try {
      this.seed(await this.saleService.getConfig());
    } catch (error) {
      console.error('Failed to load sale config:', error);
      this.seed(null);
    }
  }

  /**
   * Fetches them again because the poll saw the rate move.
   *
   * Quiet, where {@link load} is not: nobody asked for this request, so it
   * raises no overlay, and a failure keeps the figures on screen rather than
   * blanking a form that was priced a moment ago. If the rate really has moved,
   * the server refuses the stale quote at submit and that refusal takes the
   * loud path.
   */
  private async refresh(): Promise<void> {
    try {
      this.seed(await this.saleService.getConfig(true));
    } catch (error) {
      console.error('Failed to refresh sale config:', error);
    }
  }

  /**
   * Records what the form showed before a new rate lands, when it is new.
   *
   * A move while an earlier one is still on screen is reported as one: from
   * what the user last saw settled to what applies now. A rate that has come
   * back to where it started is no move at all, and says nothing — every
   * figure derived from it is back where it was too.
   *
   * Nothing is recorded when there was no rate to move from: a form recovering
   * from an outage is priced for the first time, not re-priced.
   */
  private noteRateChange(next: number): void {
    // An answer with no rate is an outage, reported as one — see `seed`.
    if (next <= 0) {
      this.rateChange.set(null);

      return;
    }

    const previous = this.sellRateKopecks();
    if (previous <= 0 || next === previous) return;

    const before = this.rateChange() ?? {
      rateKopecks: previous,
      targetKopecks: this.targetKopecks(),
      stakeCents: this.stakeCents(),
    };

    this.rateChange.set(before.rateKopecks === next ? null : before);
  }
}
