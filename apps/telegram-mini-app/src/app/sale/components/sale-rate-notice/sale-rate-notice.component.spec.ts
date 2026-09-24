import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { provideStore } from '@ngrx/store';
import { TrustLevel, type SaleConfigResponse } from '@transacto/contracts';
import { TmaService } from '../../../auth/services/tma.service';
import { ratesReducer } from '../../../core/store/rates.reducer';
import { RATES_FEATURE } from '../../../core/store/rates.state';
import { SalePricingService } from '../../services/sale-pricing.service';
import { SaleService } from '../../services/sale.service';
import { SaleRateNoticeComponent } from './sale-rate-notice.component';

/** A form's own action, projected in — the jar form's pull-up, here a stand-in. */
@Component({
  imports: [SaleRateNoticeComponent],
  providers: [SalePricingService],
  template: `<app-sale-rate-notice><button class="projected">act</button></app-sale-rate-notice>`,
})
class HostComponent {}

const config = (sellRate: number): SaleConfigResponse => ({
  trustLevel: TrustLevel.NEWBIE,
  sellRate,
  balance: 10_000_000,
  maxParallelOrders: 3,
  openOrders: 0,
  minOrderKopecks: 30_000,
  slotsAwaitingJarClosure: [],
});

/**
 * "The rate moved", where the sale is confirmed.
 *
 * The figures on a sale form recompute the moment a new rate lands, which is
 * exactly why this has to exist: a total that changes by itself is the thing
 * a seller does not notice until the sale is made.
 */
describe('SaleRateNoticeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let pricing: SalePricingService;
  let haptic: Mock;

  beforeEach(async () => {
    haptic = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideTranslateService(),
        provideStore({ [RATES_FEATURE]: ratesReducer }),
        { provide: SaleService, useValue: { getConfig: vi.fn() } },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
        { provide: TmaService, useValue: { hapticFeedback: haptic } },
      ],
    });

    fixture = TestBed.createComponent(HostComponent);
    pricing = fixture.debugElement.injector.get(SalePricingService);
    pricing.seed(config(4_000));
    pricing.setAmount(10);
    await fixture.whenStable();
  });

  const notice = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('.rate-notice');

  const amounts = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('.rate-notice-amounts');

  const notices = (): SaleRateNoticeComponent =>
    fixture.debugElement.children[0].componentInstance as SaleRateNoticeComponent;

  it('says nothing while the rate has not moved', () => {
    expect(notice()).toBeNull();
    expect(haptic).not.toHaveBeenCalled();
  });

  it('appears, with a buzz, when it moves', async () => {
    pricing.seed(config(4_040));
    await fixture.whenStable();

    expect(notice()).not.toBeNull();
    expect(haptic).toHaveBeenCalledWith('warning');
  });

  /** Ten USDT at ₴40.00 is ₴400; at ₴40.40 it is ₴404 — the figures moved too. */
  it('names the figures when the move reached them', async () => {
    pricing.seed(config(4_040));
    await fixture.whenStable();

    expect(notices().amountsMoved()).toBe(true);
    expect(amounts()).not.toBeNull();
  });

  /** A kopeck on the rate is ten on this total, which stays ₴400 — only the rate is news. */
  it('names only the rate when the figures stayed put', async () => {
    pricing.seed(config(4_001));
    await fixture.whenStable();

    expect(notice()).not.toBeNull();
    expect(notices().amountsMoved()).toBe(false);
    expect(amounts()).toBeNull();
  });

  it('carries whatever the form projects into it', async () => {
    pricing.seed(config(4_040));
    await fixture.whenStable();

    expect(notice()?.querySelector('.projected')).not.toBeNull();
  });

  it('goes away when dismissed', async () => {
    pricing.seed(config(4_040));
    await fixture.whenStable();

    (notice()?.querySelector('.rate-notice-dismiss') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(notice()).toBeNull();
    expect(pricing.rateChange()).toBeNull();
  });
});
