import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { TmaSaleStatus } from '@transacto/contracts';
import type { TmaSale } from '@transacto/contracts';
import { SaleStatusComponent } from './sale-status.component';
import { SaleService } from '../../services/sale.service';
import { TmaService } from '../../../auth/services/tma.service';
import { WsService } from '../../../realtime/services/ws.service';
import { ClockService } from '../../../shared/services/clock.service';
import { MetaPixelService } from '../../../shared/services/meta-pixel.service';

/**
 * The "online" caption in the corner of a sale.
 *
 * It reads the **socket**, and the socket is up whenever the app is open — so a
 * sale that ended weeks ago sat under a green *онлайн*, which says something
 * true about the connection and something false about the sale. Conflating the
 * two is only worth it while there is something to be live for.
 */
describe('SaleStatusComponent live indicator', () => {
  let connected: ReturnType<typeof signal<boolean>>;
  let component: SaleStatusComponent;

  const build = (): SaleStatusComponent => {
    connected = signal(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTranslateService(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'sale-1' } } } },
        { provide: SaleService, useValue: {} },
        {
          provide: WsService,
          useValue: {
            connected,
            saleProgress: () => null,
            connectionEpoch: () => 0,
            connect: vi.fn(),
          },
        },
        {
          provide: TmaService,
          useValue: {
            hapticFeedback: vi.fn(),
            showBackButton: vi.fn(),
            hideBackButton: vi.fn(),
          },
        },
        { provide: ClockService, useValue: { now: () => Date.now() } },
        { provide: MetaPixelService, useValue: { trackConversion: vi.fn() } },
      ],
    });

    return TestBed.runInInjectionContext(() => new SaleStatusComponent());
  };

  /** Puts the page in the state it is in once both responses have landed. */
  const settledOn = (status: TmaSaleStatus): void => {
    component.order.set({ status } as TmaSale);
    component.loading.set(false);
  };

  beforeEach(() => {
    component = build();
  });

  it.each([
    TmaSaleStatus.CREATED,
    TmaSaleStatus.TERMINAL_READY,
    TmaSaleStatus.AWAITING_FIAT,
    TmaSaleStatus.CLOSING,
  ])('shows the indicator while the sale is still %s', (status) => {
    settledOn(status);

    expect(component.showsConnection()).toBe(true);
  });

  /** **The bug.** Nothing about a finished sale can change by itself. */
  it.each([TmaSaleStatus.COMPLETED, TmaSaleStatus.CANCELLED, TmaSaleStatus.FAILED])(
    'hides it once the sale is %s',
    (status) => {
      settledOn(status);

      expect(component.showsConnection()).toBe(false);
    },
  );

  /**
   * `currentStatus()` falls back to CREATED until both responses land, so
   * without the loading gate a finished sale would flash the indicator for one
   * frame and then drop it.
   */
  it('shows nothing while the page is still loading', () => {
    component.order.set({ status: TmaSaleStatus.COMPLETED } as TmaSale);

    expect(component.loading()).toBe(true);
    expect(component.showsConnection()).toBe(false);
  });

  /** It is still the connection it reports — a live sale offline says so. */
  it('leaves the offline case to the indicator itself', () => {
    settledOn(TmaSaleStatus.AWAITING_FIAT);
    connected.set(false);

    expect(component.showsConnection()).toBe(true);
  });
});
