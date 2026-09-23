import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MIN_USDT_AMOUNT, priceSale, targetForStake, TrustLevel } from '@transacto/contracts';
import type { SaleConfigResponse } from '@transacto/contracts';
import { SalePricingService } from './sale-pricing.service';
import { SaleService } from './sale.service';

/**
 * **The bug: a seller could not sell the minimum amount.**
 *
 * They type ten USDT. `targetForStake` floors the hryvnia total to a whole
 * hryvnia so the derived stake never lands above what they typed, and
 * `priceSale` then recovers the stake from that floored total. The round trip
 * is lossy by construction, so ten came back as 9.99 — and `belowMinimum`,
 * which compared that recovered figure against ten USDT flat, disabled the
 * form's own button beside a line reading "minimum 10 USDT".
 *
 * It happened on every rate where `10 × rate` does not land on a whole
 * hryvnia, which is every rate that is not a multiple of ten kopecks.
 */
describe('SalePricingService minimum amount', () => {
  let service: SalePricingService;

  const config = (sellRate: number): SaleConfigResponse => ({
    trustLevel: TrustLevel.NEWBIE,
    sellRate,
    balance: 10_000_000,
    maxParallelOrders: 3,
    openOrders: 0,
    minOrderKopecks: 30_000,
    slotsAwaitingJarClosure: []
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SalePricingService,
        { provide: SaleService, useValue: { getConfig: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }
      ]
    });

    service = TestBed.inject(SalePricingService);
  });

  /** The rate the bug was found on — ₴48.04 does not divide into whole hryvnia. */
  it('accepts the minimum amount at a rate that floors the target', () => {
    service.seed(config(4_804));
    service.usdtAmount.set(MIN_USDT_AMOUNT);

    // The trap, stated: ₴480 rather than ₴480.40, and 9.99 USDT rather than 10.
    expect(service.targetKopecks()).toBe(48_000);
    expect(service.stakeCents()).toBe(999);

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
   * `priceSale`/`targetForStake` living in the contracts package is for.
   */
  it('derives the stake the server will take', () => {
    service.seed(config(4_804));
    service.usdtAmount.set(37);

    expect(service.stakeCents()).toBe(
      priceSale(targetForStake(37, 4_804), 4_804).requiredUsdtCents
    );
  });
});
