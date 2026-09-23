import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  SaleCardOrderState,
  SaleEventType,
  SaleMethod,
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
import { StatementBlockReason } from '../../enums/statement-block-reason.enum';
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
 * The entry that corrects an earlier one.
 *
 * A seller answered "₴298 arrived" days ago and their row has said ₴298 ever
 * since; a statement then showed ₴300. Moving the total without saying so would
 * leave them with a sale that adds up and a payment that does not — so both
 * figures go on the entry, and the sentence names the document that did it.
 */
describe('SaleStatusComponent timeline', () => {
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

  it('carries both figures on a statement correction', () => {
    component.progress.set({
      events: [
        {
          type: SaleEventType.STATEMENT_CORRECTED,
          amount: 30_000,
          declaredAmount: 29_800,
          orderId: 7,
          at: 1_780_000_000_000,
        },
      ],
    } as Partial<SaleProgress> as SaleProgress);

    expect(component.timeline()[0]).toMatchObject({
      key: 'SALE_EVENT.STATEMENT_CORRECTED',
      params: { amount: '300,00', declared: '298,00' },
    });
  });

  /** Every other entry carries it unread rather than sometimes. */
  it('leaves it at zero where nothing was corrected', () => {
    component.progress.set({
      events: [{ type: SaleEventType.PAYMENT_MATCHED, amount: 30_000, at: 1 }],
    } as Partial<SaleProgress> as SaleProgress);

    expect(component.timeline()[0].params.declared).toBe('0,00');
  });
});

/**
 * The last stretch, and how much of it the seller is allowed to notice.
 *
 * **They should not be able to tell it apart from a payer's.** That it is
 * transferred by hand rather than routed is a fact about our plumbing, so the
 * screen draws it as one more payment to confirm — and draws nothing at all
 * until somebody has undertaken to send it, because until then nothing is on
 * its way and the sale simply has not filled yet.
 */
describe('SaleStatusComponent last payment', () => {
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

  it('draws it once an operator has taken it on', () => {
    on({ saleMethod: SaleMethod.CARD, tail: { amount: 6_000, claimed: true } });

    expect(component.lastPayment()).toEqual({ amount: 6_000, claimed: true });
  });

  /** Nothing is on its way, so there is nothing to confirm and nothing to say. */
  it('draws nothing while nobody has', () => {
    on({ saleMethod: SaleMethod.CARD, tail: { amount: 6_000, claimed: false } });

    expect(component.lastPayment()).toBeNull();
  });

  /**
   * A jar's last stretch arrives as a balance the scraper reads: the seller
   * does nothing and sees nothing, and a button here would credit the same
   * hryvnia twice.
   */
  it('draws nothing on a jar sale, taken on or not', () => {
    on({ saleMethod: SaleMethod.JAR, tail: { amount: 6_000, claimed: true } });

    expect(component.lastPayment()).toBeNull();
  });

  it('draws nothing where there is no tail at all', () => {
    on({ saleMethod: SaleMethod.CARD });

    expect(component.lastPayment()).toBeNull();
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
      tail: { amount: 6_000, claimed: false },
    });

    expect(component.stopHintKey()).toBe('sale.stop_hint');
  });
});

/**
 * When the page tells a seller their sale has stopped, and why.
 *
 * **An upload box is a demand whether or not it was meant as one**, and a
 * statement is wanted in three situations of which only two hold anything up.
 * The third — a small shortfall on a payment that executed anyway — keeps
 * filling the sale, and the box sat there looking like the reason it was not.
 * So the block is drawn for the two that stop something, and each says which.
 */
describe('SaleStatusComponent statement block', () => {
  let component: SaleStatusComponent;

  const cardOrder = (over: Partial<SaleCardOrder> = {}): SaleCardOrder =>
    ({
      orderId: 1,
      amount: 30_000,
      state: SaleCardOrderState.CONFIRMED,
      arrivedAt: '2026-09-23T10:00:30.000Z',
      confirmDeadlineAt: '2026-09-23T10:05:30.000Z',
      answeredAt: '2026-09-23T10:02:48.000Z',
      statements: [],
      ...over,
    }) as SaleCardOrder;

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
    component.progress.set({ saleMethod: SaleMethod.CARD, ...progress } as SaleProgress);
  };

  /**
   * **The case this was built for.** ₴5 declared short on a payment that was
   * executed anyway: payers keep coming, the bar keeps moving, and the document
   * is wanted at the end. Nothing is stopped, so nothing is asked for.
   */
  it('asks for nothing while the sale is still filling', () => {
    on({
      statementRequired: true,
      tail: null,
      cardOrders: [cardOrder({ declaredAmount: 29_500 })],
    });

    expect(component.statementBlock()).toBeNull();
  });

  /** A disputed payment stops routing, so there is nothing else to wait for. */
  it('says routing has stopped while a payment is disputed', () => {
    const disputed = cardOrder({ orderId: 2, state: SaleCardOrderState.DISPUTED });

    on({ statementRequired: false, tail: null, cardOrders: [disputed] });

    expect(component.statementBlock()).toEqual({
      order: disputed,
      reason: StatementBlockReason.ROUTING_STOPPED,
    });
  });

  /**
   * A plain denial carries no declared figure, so `statementRequired` is false
   * and the sale is nonetheless completely stuck. Gating the block on that flag
   * alone would leave the one seller who most needs the explanation without it.
   */
  it('says so on a denial that declared no figure at all', () => {
    on({
      statementRequired: false,
      cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })],
    });

    expect(component.statementBlock()?.reason).toBe(StatementBlockReason.ROUTING_STOPPED);
  });

  /**
   * The quietest stoppage there is: the gap is under the order floor, so
   * nothing more can be routed, and the remainder waits on the document.
   */
  it('says the remainder is held once the sale is in its tail', () => {
    const claimed = cardOrder({ declaredAmount: 29_500 });

    on({
      statementRequired: true,
      tail: { amount: 15_900, claimed: false },
      cardOrders: [claimed],
    });

    expect(component.statementBlock()).toEqual({
      order: claimed,
      reason: StatementBlockReason.TAIL_HELD,
    });
  });

  /**
   * A dispute outranks a held tail: it is the earlier stoppage and the one with
   * a payment attached, and settling it may fill the sale outright — at which
   * point there is no tail left to explain.
   */
  it('names the dispute when a sale is in both states at once', () => {
    on({
      statementRequired: true,
      tail: { amount: 15_900, claimed: false },
      cardOrders: [
        cardOrder({ declaredAmount: 29_500 }),
        cardOrder({ orderId: 2, state: SaleCardOrderState.DISPUTED }),
      ],
    });

    expect(component.statementBlock()?.reason).toBe(StatementBlockReason.ROUTING_STOPPED);
  });

  /** A tail nobody has claimed against is not a reason to ask for anything. */
  it('asks for nothing in a tail with no claim behind it', () => {
    on({
      statementRequired: false,
      tail: { amount: 15_900, claimed: false },
      cardOrders: [cardOrder()],
    });

    expect(component.statementBlock()).toBeNull();
  });

  /** The document is filed against the newest claim — see `shortfallOrder`. */
  it('files a held tail against the most recent claim', () => {
    on({
      statementRequired: true,
      tail: { amount: 15_900, claimed: false },
      cardOrders: [
        cardOrder({ orderId: 1, declaredAmount: 29_500 }),
        cardOrder({ orderId: 2, declaredAmount: 10_100 }),
      ],
    });

    expect(component.statementBlock()?.order.orderId).toBe(2);
  });
});
