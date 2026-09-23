import { Injectable, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_MIN_ORDER_KOPECKS,
  minSaleTargetKopecks,
  priceSale,
  targetForStake,
  type SaleAwaitingJar,
  type SaleConfigResponse,
} from '@transacto/contracts';
import { ActivatedRoute } from '@angular/router';
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
 * Not `providedIn: 'root'`: this holds one form's state, and two forms open one
 * after another must not inherit each other's amount. Provided by the page.
 */
@Injectable()
export class SalePricingService {
  private readonly saleService = inject(SaleService);
  private readonly route = inject(ActivatedRoute);

  /** What the user typed, in whole USDT. The page owns the input; this prices it. */
  readonly usdtAmount = signal<number | null>(null);

  /** All from `GET /sales/config`; the literals are only a first paint. */
  readonly sellRateKopecks = signal(0);
  readonly balanceCents = signal(0);
  readonly maxParallelOrders = signal(0);
  readonly openOrders = signal(0);
  readonly awaitingJarClosure = signal<readonly SaleAwaitingJar[]>([]);
  readonly minOrderKopecks = signal(DEFAULT_MIN_ORDER_KOPECKS);
  readonly rateUnavailable = signal(false);

  /** The hryvnia total, derived exactly as the server derives it. */
  readonly targetKopecks = computed(() =>
    targetForStake(this.usdtAmount() ?? 0, this.sellRateKopecks()),
  );

  /** …and the stake that total costs, by the same one statement of it. */
  readonly stakeCents = computed(
    () => priceSale(this.targetKopecks(), this.sellRateKopecks()).requiredUsdtCents,
  );

  /**
   * Whether this sale is under the minimum amount, as the server decides it.
   *
   * **It used to compare the recovered stake against ten USDT flat, and that
   * refused the minimum itself.** The stake here is not what the user typed: it
   * is what came back through `targetForStake` → `priceSale`, and that round
   * trip floors the target to a whole hryvnia. Typing exactly ten produced 9.99
   * on most rates, so the form disabled its own button beside a line reading
   * "minimum 10 USDT".
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

      return;
    }

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
}
