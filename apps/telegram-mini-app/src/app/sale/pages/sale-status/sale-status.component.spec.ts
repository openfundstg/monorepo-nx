import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  SaleCardOrderState,
  SaleStatementRejection,
  SaleStatementStatus,
  TmaSaleStatus,
} from '@transacto/contracts';
import type {
  SaleCardOrder,
  SaleProgress,
  SaleStatement,
  TmaSale,
} from '@transacto/contracts';
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

/**
 * Which refusal the seller is shown, when they have sent more than one document.
 *
 * **The bug:** every attempt was rendered, so an order settled by an accepted
 * statement carried the *earlier* refused one's reason underneath its verdict —
 * "the statement confirmed no money arrived", and directly below, in red, "this
 * statement's period does not cover the payment". Two answers to one question,
 * and the stale one was the one that looked urgent.
 */
describe('SaleStatusComponent statement refusals', () => {
  let component: SaleStatusComponent;

  const attempt = (rejection: SaleStatementRejection | null): SaleStatement => ({
    id: `s-${rejection ?? 'ok'}`,
    status: rejection === null ? SaleStatementStatus.ACCEPTED : SaleStatementStatus.REJECTED,
    rejection,
    uploadedAt: '2026-09-18T19:44:46.000Z',
    periodFrom: null,
    periodTo: null,
  });

  const order = (...statements: SaleStatement[]): SaleCardOrder => ({
    orderId: 1,
    amount: 30_300,
    state: SaleCardOrderState.DISPUTED,
    arrivedAt: '2026-09-18T19:00:00.000Z',
    confirmDeadlineAt: '2026-09-18T19:05:00.000Z',
    answeredAt: '2026-09-18T19:05:00.000Z',
    statements,
  });

  beforeEach(() => {
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
            connected: signal(true),
            saleProgress: () => null,
            connectionEpoch: () => 0,
            connect: vi.fn(),
          },
        },
        {
          provide: TmaService,
          useValue: { hapticFeedback: vi.fn(), showBackButton: vi.fn(), hideBackButton: vi.fn() },
        },
        { provide: ClockService, useValue: { now: () => Date.now() } },
        { provide: MetaPixelService, useValue: { trackConversion: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new SaleStatusComponent());
  });

  it('says nothing when no statement has been sent', () => {
    expect(component.latestRejection(order())).toBeNull();
  });

  it('shows why the last attempt was refused', () => {
    expect(
      component.latestRejection(order(attempt(SaleStatementRejection.PERIOD_TOO_SHORT))),
    ).toBe(SaleStatementRejection.PERIOD_TOO_SHORT);
  });

  /** **The bug.** An accepted statement carries no rejection, so it answers by itself. */
  it('drops an earlier refusal once a later statement was accepted', () => {
    const cardOrder = order(attempt(SaleStatementRejection.PERIOD_TOO_SHORT), attempt(null));

    expect(component.latestRejection(cardOrder)).toBeNull();
  });

  /** Several failures in a row describe several documents; only the last still exists. */
  it('shows only the most recent of two refusals', () => {
    const cardOrder = order(
      attempt(SaleStatementRejection.PERIOD_TOO_SHORT),
      attempt(SaleStatementRejection.WRONG_ACCOUNT),
    );

    expect(component.latestRejection(cardOrder)).toBe(SaleStatementRejection.WRONG_ACCOUNT);
  });
});

/**
 * Which end of the payment list the newest payment is at.
 *
 * The server stores them as they arrived, which is what the lookups want and
 * the opposite of what a reader wants: the payment being asked about is the
 * newest, and it sat at the bottom under a growing pile of settled ones — while
 * the timeline directly beside it reads newest first.
 */
describe('SaleStatusComponent payment order', () => {
  let component: SaleStatusComponent;

  const cardOrder = (orderId: number): SaleCardOrder =>
    ({ orderId, statements: [] }) as unknown as SaleCardOrder;

  beforeEach(() => {
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
            connected: signal(true),
            saleProgress: () =>
              ({
                saleId: 'sale-1',
                updatedAt: 1,
                cardOrders: [cardOrder(1), cardOrder(2), cardOrder(3)],
              }) as unknown as SaleProgress,
            connectionEpoch: () => 0,
            connect: vi.fn(),
          },
        },
        {
          provide: TmaService,
          useValue: { hapticFeedback: vi.fn(), showBackButton: vi.fn(), hideBackButton: vi.fn() },
        },
        { provide: ClockService, useValue: { now: () => Date.now() } },
        { provide: MetaPixelService, useValue: { trackConversion: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new SaleStatusComponent());
  });

  it('reads newest first on screen', () => {
    expect(component.cardOrdersNewestFirst().map((order) => order.orderId)).toEqual([3, 2, 1]);
  });

  /** The lookups mean "the one open order" and must not depend on which end. */
  it('leaves the stored order alone for everything else', () => {
    expect(component.cardOrders().map((order) => order.orderId)).toEqual([1, 2, 3]);
  });
});

/**
 * What the stop card promises, and why it cannot always promise a refund.
 *
 * **The button stays and the promise changes.** `sale.stop_hint` quotes a
 * refund, and under either of these that figure is wrong or premature: a payer
 * mid-transfer can still reduce it, and a statement can still correct it. So
 * the hint names what is being waited on rather than a number nobody can stand
 * behind yet.
 *
 * A tail is not one of them, deliberately — while one is being transferred the
 * whole card is gone, and while nobody has taken it on, stopping settles on the
 * spot exactly as the ordinary hint says.
 */
describe('SaleStatusComponent stop hint', () => {
  let component: SaleStatusComponent;

  beforeEach(() => {
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
            connected: signal(true),
            saleProgress: () => null,
            connectionEpoch: () => 0,
            connect: vi.fn(),
          },
        },
        {
          provide: TmaService,
          useValue: { hapticFeedback: vi.fn(), showBackButton: vi.fn(), hideBackButton: vi.fn() },
        },
        { provide: ClockService, useValue: { now: () => Date.now() } },
        { provide: MetaPixelService, useValue: { trackConversion: vi.fn() } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new SaleStatusComponent());
  });

  const on = (progress: Partial<SaleProgress>): void => {
    component.progress.set(progress as SaleProgress);
  };

  it('quotes the refund while nothing is being waited on', () => {
    on({ pendingAmount: 0 });

    expect(component.stopHintKey()).toBe('sale.stop_hint');
  });

  it('says a payment is still on its way', () => {
    on({ pendingAmount: 30_000 });

    expect(component.stopHintKey()).toBe('sale.stop_hint_winding_down');
  });

  it('says a statement is what is being waited on', () => {
    on({ pendingAmount: 0, statementRequired: true });

    expect(component.stopHintKey()).toBe('sale.stop_hint_statement');
  });

  /**
   * A card the seller can still see is a card whose stop settles on the spot:
   * the snapshot takes the button away for the one state that does not, so this
   * must not start describing it again.
   */
  it('still quotes the refund while a tail is waiting to be taken on', () => {
    on({
      pendingAmount: 0,
      tail: {
        amount: 6_000,
        announced: true,
        claimed: false,
        releasableAt: Date.now() + 60_000,
        releasable: false,
      },
    });

    expect(component.stopHintKey()).toBe('sale.stop_hint');
  });
});
