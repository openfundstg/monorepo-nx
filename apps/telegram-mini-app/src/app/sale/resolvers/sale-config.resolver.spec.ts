import { TestBed } from '@angular/core/testing';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { SaleService } from '../services/sale.service';
import { saleConfigResolver } from './sale-config.resolver';

/**
 * What both sale forms are drawn from.
 *
 * The resolver exists so neither form paints a frame from the defaults its own
 * signals were declared with — a balance of 0.00 and an allowance of zero,
 * which between them make every rule on the screen false for as long as the
 * request takes.
 */
describe('saleConfigResolver', () => {
  const resolve = (getConfig: () => Promise<unknown>) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SaleService, useValue: { getConfig } }],
    });

    return TestBed.runInInjectionContext(() =>
      saleConfigResolver({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  };

  it('hands the form the figures it was given', async () => {
    const config = { sellRate: 4000, balance: 10_000 };

    await expect(resolve(() => Promise.resolve(config))).resolves.toBe(config);
  });

  /**
   * **`null`, never a rejection.** A resolver that throws cancels the
   * navigation, so a passing outage would leave the user on the screen they
   * came from with nothing said and nothing to retry. The form is reached
   * instead, and says the rate is unavailable — which it can, because `null` is
   * the same state a failed re-fetch puts it in.
   */
  it('resolves to null when the call fails, rather than cancelling the navigation', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('503'));

    await expect(resolve(failing)).resolves.toBeNull();
    expect(failing).toHaveBeenCalledOnce();
  });
});
