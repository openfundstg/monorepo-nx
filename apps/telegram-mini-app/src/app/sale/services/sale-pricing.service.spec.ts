import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store, provideStore } from '@ngrx/store';
import { MIN_USDT_AMOUNT, priceSale, priceStake, TrustLevel } from '@transacto/contracts';
import type { SaleConfigResponse } from '@transacto/contracts';
import { ratesActions } from '../../core/store/rates.actions';
import { ratesReducer } from '../../core/store/rates.reducer';
import { RATES_FEATURE } from '../../core/store/rates.state';
import { SalePricingService } from './sale-pricing.service';
import { SaleService } from './sale.service';

const config = (sellRate: number, overrides: Partial<SaleConfigResponse> = {}): SaleConfigResponse => ({
  trustLevel: TrustLevel.NEWBIE,
  sellRate,
  balance: 10_000_000,
  maxParallelOrders: 3,
  openOrders: 0,
  minOrderKopecks: 30_000,
  slotsAwaitingJarClosure: [],
  ...overrides,
});

/**
 * The service as a form gets it: the real rates slice behind it, so what the
 * poll reports reaches it through the same selector the app wires up, and a
 * config call whose answer each test decides.
 */
const setUp = (getConfig: Mock = vi.fn()): SalePricingService => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideStore({ [RATES_FEATURE]: ratesReducer }),
      SalePricingService,
      { provide: SaleService, useValue: { getConfig } },
      { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
    ],
  });

  return TestBed.inject(SalePricingService);
};

/** The app's rate poll landing on a sell rate, exactly as `rates.effects` reports one. */
const pollSees = (sell: number): void =>
  TestBed.inject(Store).dispatch(ratesActions.loadSuccess({ rates: { buy: sell - 100, sell } }));

/** Lets a background re-read that the poll started run to its end. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/**
 * **The bug: a seller could not sell the minimum amount.**
 *
 * They typed ten USDT. The hryvnia total was floored to a whole hryvnia and the
 * stake recovered from it — a lossy round trip, so ten came back as 9.99, and
 * `belowMinimum`, which compared that recovered figure against ten USDT flat,
 * disabled the form's own button beside a line reading "minimum 10 USDT".
 *
 * A typed stake is exact now, but the floor is still measured as a total — a
 * total held at a jar's goal has its stake recovered from it — so what this
 * pins is that the minimum is admitted at every rate, whichever way it is
 * reached.
 */
describe('SalePricingService minimum amount', () => {
  let service: SalePricingService;

  beforeEach(() => {
    service = setUp();
  });

  /** The rate the bug was found on — ₴48.04 does not divide into whole hryvnia. */
  it('accepts the minimum amount at a rate that does not divide into whole hryvnia', () => {
    service.seed(config(4_804));
    service.usdtAmount.set(MIN_USDT_AMOUNT);

    // ₴480 rather than ₴480.40 — and the ten typed, not the 9.99 it used to be.
    expect(service.targetKopecks()).toBe(48_000);
    expect(service.stakeCents()).toBe(1_000);

    expect(service.belowMinimum()).toBe(false);
    expect(service.isPriced()).toBe(true);
  });

  /** And on every rate, not just the one somebody happened to report. */
  it('accepts the minimum amount at every whole-kopeck rate', () => {
    const refused = [];

    for (let rate = 3_000; rate <= 6_000; rate += 1) {
      service.seed(config(rate));
      service.usdtAmount.set(MIN_USDT_AMOUNT);

      if (service.belowMinimum()) refused.push(rate);
    }

    expect(refused).toEqual([]);
  });

  it('still refuses an amount under the minimum', () => {
    const accepted = [];

    for (let rate = 3_000; rate <= 6_000; rate += 7) {
      service.seed(config(rate));
      service.usdtAmount.set(MIN_USDT_AMOUNT - 1);

      if (!service.belowMinimum()) accepted.push(rate);
    }

    expect(accepted).toEqual([]);
  });

  /**
   * Nothing typed is not "below the minimum" — it is nothing typed. The form
   * would otherwise open with its own refusal already on screen.
   */
  it('says nothing about an empty field', () => {
    service.seed(config(4_804));

    expect(service.belowMinimum()).toBe(false);
  });

  /** Nor before the market has answered, when there is no rate to judge by. */
  it('says nothing while the rate is unknown', () => {
    service.seed(null);
    service.usdtAmount.set(MIN_USDT_AMOUNT);

    expect(service.belowMinimum()).toBe(false);
    // …but the form is not submittable either, for the reason it says.
    expect(service.isPriced()).toBe(false);
  });

  /**
   * The form and the server must price the same sale identically — that is what
   * `priceStake`/`priceSale` living in the contracts package is for.
   */
  it('prices the sale exactly as the server will', () => {
    service.seed(config(4_804));
    service.usdtAmount.set(37);

    expect(service.quote()).toEqual(priceStake(3_700, 4_804));
  });
});

/**
 * **What the seller asked for: "if I type 10 USDT, it is 10 USDT".**
 *
 * The stake used to be recovered from a floored total, so ten USDT at ₴48.19
 * was ₴481 and 9.98 USDT — a different amount from the one typed on most
 * sales. The stake is the figure typed now, and the total gives way instead:
 * its price, rounded to the nearest whole hryvnia a jar's goal can hold.
 */
describe('SalePricingService selling the amount typed', () => {
  let service: SalePricingService;

  beforeEach(() => {
    service = setUp();
  });

  it('sells exactly the USDT typed', () => {
    service.seed(config(4_819));
    service.setAmount(10);

    expect(service.stakeCents()).toBe(1_000);
    // ₴481.90, to the nearest hryvnia.
    expect(service.targetKopecks()).toBe(48_200);
  });

  /** Nearest, not down: a floored total would price every sale under its rate. */
  it.each([
    ['up from half a hryvnia', 4_815, 48_200],
    ['down from under half', 4_814, 48_100],
  ])('rounds the total %s', (_label, rate, total) => {
    service.seed(config(rate));
    service.setAmount(10);

    expect(service.stakeCents()).toBe(1_000);
    expect(service.targetKopecks()).toBe(total);
  });

  /**
   * The case the old floor existed for: a balance that is not whole USDT. It
   * was spendable then only by selling less than typed; it is spendable now
   * because what is typed is what is sold.
   */
  it('sells a whole balance of 10.02 as 10.02', () => {
    service.seed(config(4_819, { balance: 1_002 }));
    service.setAmount(10.02);

    expect(service.stakeCents()).toBe(1_002);
    expect(service.hasSufficientBalance()).toBe(true);
  });

  it('refuses a cent past the balance', () => {
    service.seed(config(4_819, { balance: 1_001 }));
    service.setAmount(10.02);

    expect(service.hasSufficientBalance()).toBe(false);
  });
});

/**
 * **The bug: the form read the rate once.** The resolver fetched it on the way
 * in and nothing asked again, so a form left open for a minute went on quoting
 * a rate the server had stopped taking — and the server, which re-priced the
 * total at the live one, froze a stake the screen had never shown.
 *
 * The app's rate poll is the trigger; `/sales/config` is still where the rate
 * comes from, beside the balance it is judged against.
 */
describe('SalePricingService following the rate', () => {
  let getConfig: Mock;
  let service: SalePricingService;

  beforeEach(() => {
    getConfig = vi.fn().mockResolvedValue(config(4_850));
    service = setUp(getConfig);
    service.seed(config(4_819));
  });

  it('reads its figures again when the poll sees a rate it is not priced at', async () => {
    pollSees(4_850);
    await settle();

    expect(service.sellRateKopecks()).toBe(4_850);
  });

  /** Nobody asked for this request, so it must not grey the screen out. */
  it('asks in the background', async () => {
    pollSees(4_850);
    await settle();

    expect(getConfig).toHaveBeenCalledWith(true);
  });

  /** The rate a form prices at arrives with the balance it is judged against. */
  it('takes the rest of the figures from the same answer', async () => {
    getConfig.mockResolvedValue(config(4_850, { balance: 12_345, openOrders: 1 }));

    pollSees(4_850);
    await settle();

    expect(service.balanceCents()).toBe(12_345);
    expect(service.openOrders()).toBe(1);
  });

  it('asks nothing when the poll agrees with it', async () => {
    pollSees(4_819);
    await settle();

    expect(getConfig).not.toHaveBeenCalled();
  });

  /** The resolver's figures were read a moment ago; the poll has nothing to add. */
  it('asks nothing before its own figures are in', async () => {
    const fresh = setUp(getConfig);

    pollSees(4_850);
    await settle();

    expect(getConfig).not.toHaveBeenCalled();
    expect(fresh.sellRateKopecks()).toBe(0);
  });

  /**
   * A passing outage must not blank a form that was priced a moment ago. If the
   * rate really moved, the server refuses the stale quote at submit, and that
   * refusal takes the loud path.
   */
  it('keeps its figures when the background read fails', async () => {
    getConfig.mockRejectedValue(new Error('offline'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    pollSees(4_850);
    await settle();
    quiet.mockRestore();

    expect(service.sellRateKopecks()).toBe(4_819);
    expect(service.rateUnavailable()).toBe(false);
  });
});

/**
 * **What the seller asked for: "if the rate changes, tell the user".**
 *
 * The figures are recomputed the moment a new rate lands, which is exactly why
 * they cannot be left to speak for themselves — a total that changes by itself
 * is the thing nobody notices until the finished sale.
 */
describe('SalePricingService reporting a move', () => {
  let service: SalePricingService;

  beforeEach(() => {
    service = setUp();
    service.seed(config(4_819));
    service.setAmount(10);
  });

  it('records what was on screen before the move', () => {
    service.seed(config(4_900));

    expect(service.rateChange()).toEqual({
      rateKopecks: 4_819,
      targetKopecks: 48_200,
      stakeCents: 1_000,
    });
    // …and the figures themselves have moved on: the same ten USDT, a new total.
    expect(service.stakeCents()).toBe(1_000);
    expect(service.targetKopecks()).toBe(49_000);
  });

  /** The first rate a form is given is a price, not a change of one. */
  it('says nothing about the first rate', () => {
    const fresh = setUp();
    fresh.seed(config(4_819));

    expect(fresh.rateChange()).toBeNull();
  });

  it('says nothing when the rate has not moved', () => {
    service.seed(config(4_819));

    expect(service.rateChange()).toBeNull();
  });

  /**
   * Two moves before the seller has looked are one move to them — from what
   * they last saw settled to what applies now.
   */
  it('reports two moves as one, from what was last seen', () => {
    service.seed(config(4_850));
    service.seed(config(4_900));

    expect(service.rateChange()?.rateKopecks).toBe(4_819);
    expect(service.sellRateKopecks()).toBe(4_900);
  });

  /** The market flickers a kopeck and back several times an hour. */
  it('says nothing once the rate is back where it started', () => {
    service.seed(config(4_820));
    service.seed(config(4_819));

    expect(service.rateChange()).toBeNull();
  });

  /** A move to an unknown rate would read "→ 0,00"; the outage has its own line. */
  it('says nothing about a rate that became unknown', () => {
    service.seed(config(4_900));
    service.seed(null);

    expect(service.rateChange()).toBeNull();
    expect(service.rateUnavailable()).toBe(true);
  });

  /** The same outage, told by an answer that arrived but carries no rate. */
  it('says nothing about an answer that carries no rate', () => {
    service.seed(config(4_900));
    service.seed(config(0));

    expect(service.rateChange()).toBeNull();
    expect(service.rateUnavailable()).toBe(true);
  });

  /** Nor about recovering from one: that is a first price, not a changed one. */
  it('says nothing when a rate returns after an outage', () => {
    service.seed(null);
    service.seed(config(4_900));

    expect(service.rateChange()).toBeNull();
  });

  /** Once new figures are typed, a report about the old ones is about nothing on screen. */
  it('lets the report go once an amount is typed', () => {
    service.seed(config(4_900));
    service.setAmount(20);

    expect(service.rateChange()).toBeNull();
  });

  it('lets the report go once it is dismissed', () => {
    service.seed(config(4_900));
    service.dismissRateChange();

    expect(service.rateChange()).toBeNull();
  });
});

/**
 * **What the seller asked for, for a jar: "let me pull the USDT up to the
 * amount in my jar".** The goal is set in a banking app and takes a minute to
 * change — long enough for the rate to move again. So the goal is held and the
 * USDT follows it.
 */
describe('SalePricingService holding a total', () => {
  let service: SalePricingService;

  beforeEach(() => {
    service = setUp();
    service.seed(config(4_819));
  });

  it('holds the total and derives the USDT from it', () => {
    service.holdTarget(48_100);

    expect(service.targetKopecks()).toBe(48_100);
    expect(service.stakeCents()).toBe(priceSale(48_100, 4_819).requiredUsdtCents);
    expect(service.amountField()).toBe(9.98);
  });

  /** The whole point: a move re-derives the USDT and leaves the goal alone. */
  it('keeps the total and re-derives the USDT when the rate moves', () => {
    service.holdTarget(48_100);
    service.seed(config(4_900));

    expect(service.targetKopecks()).toBe(48_100);
    expect(service.amountField()).toBe(priceSale(48_100, 4_900).requiredUsdtCents / 100);
    expect(service.rateChange()).toEqual({
      rateKopecks: 4_819,
      targetKopecks: 48_100,
      stakeCents: 998,
    });
  });

  it('lets go the moment an amount is typed', () => {
    service.holdTarget(48_100);
    service.setAmount(20);

    expect(service.heldTargetKopecks()).toBeNull();
    expect(service.targetKopecks()).toBe(priceStake(2_000, 4_819).targetKopecks);
    expect(service.amountField()).toBe(20);
  });

  /** A goal reported as 48 099 kopecks is the ₴481 its owner typed, as the server reads it. */
  it('snaps a goal to whole hryvnia, as the server does', () => {
    service.holdTarget(48_099);

    expect(service.targetKopecks()).toBe(48_100);
  });

  /**
   * A held total is still a sale, judged by the same rules: a jar set to the
   * minimum stays sellable through a move the goal check would tolerate.
   */
  it('keeps a jar set to the minimum sellable through a small rise', () => {
    service.setAmount(MIN_USDT_AMOUNT);
    service.holdTarget(service.targetKopecks());
    service.seed(config(4_860));

    expect(service.stakeCents()).toBeLessThan(1_000);
    expect(service.belowMinimum()).toBe(false);
  });
});
