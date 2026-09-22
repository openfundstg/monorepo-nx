import { ConflictException, NotFoundException } from '@nestjs/common'
import { ERROR, TmaSaleStatus } from '@transacto/contracts'
import { SaleCancelService } from './sale-cancel.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { OrderStatus, type OrderDbService } from 'src/modules/repositories/order-db'
import type { SaleTerminalService } from './sale-terminal.service'
import type { SaleProgressService } from './sale-progress.service'
import type { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import type { BalanceLedgerService } from './balance-ledger.service'

const TELEGRAM_ID = 885140
const CARD_ID = 100

/** 150 USDT staked against a ₴7 118 target at ₴46.52 — the live figures. */
const FROZEN_CENTS = 15_000
const RATE = 4_652

const storedOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: '4W3QASK2',
  telegramId: TELEGRAM_ID,
  status: TmaSaleStatus.AWAITING_FIAT,
  fiatAmount: 711_800,
  frozenUsdt: FROZEN_CENTS,
  receivedAmount: 0,
  exchangeRate: RATE,
  cardId: CARD_ID,
  traderId: 346,
  transactoTerminalId: 23_892,
  ...overrides,
})

const order = (status: OrderStatus) => ({ status })

const MINUTES_AGO = (minutes: number) => new Date(Date.now() - minutes * 60_000)

/**
 * The same sale with ₴60 left of ₴960 — under the ₴300 floor — and an operator
 * transferring it, which is the one state that refuses a stop outright.
 *
 * The two moments are relative to now rather than fixed, because what is being
 * measured is how long ago they were: a pinned date passes this suite on the
 * day it is written and silently stops being a claim afterwards.
 *
 * `TRANSACTO_MIN_ORDER_KOPECKS` is pinned in the suite below so the figures
 * say what they measure.
 */
const heldByATransfer = (overrides: Record<string, unknown> = {}) =>
  storedOrder({
    fiatAmount: 96_000,
    receivedAmount: 90_000,
    tailReachedAt: MINUTES_AGO(10),
    tailAnnouncedAt: MINUTES_AGO(10),
    tailClaimedAt: MINUTES_AGO(10),
    ...overrides,
  })

describe('SaleCancelService', () => {
  let db: {
    findById: jest.Mock
    cancelIfOpen: jest.Mock
    appendEvent: jest.Mock
    markClosing: jest.Mock
  }
  let users: {
    findByTelegramId: jest.Mock
    commitFrozenBalance: jest.Mock
  }
  /** Refunding goes through the book, so the movement leaves a row behind. */
  let ledger: { refund: jest.Mock }
  let orders: { findUnsettledByCard: jest.Mock }
  let terminals: { disable: jest.Mock; stopRouting: jest.Mock }
  let gateway: { emitSaleStatusChange: jest.Mock; emitBalanceUpdated: jest.Mock }
  let service: SaleCancelService

  const originalMinOrder = process.env.TRANSACTO_MIN_ORDER_KOPECKS

  afterEach(() => {
    if (originalMinOrder === undefined) delete process.env.TRANSACTO_MIN_ORDER_KOPECKS
    else process.env.TRANSACTO_MIN_ORDER_KOPECKS = originalMinOrder
  })

  beforeEach(() => {
    // ₴300, the shipped default — pinned so the tail figures above measure
    // what they say they do.
    process.env.TRANSACTO_MIN_ORDER_KOPECKS = '30000'

    db = {
      findById: jest.fn().mockResolvedValue(storedOrder()),
      cancelIfOpen: jest
        .fn()
        .mockResolvedValue(storedOrder({ status: TmaSaleStatus.CANCELLED })),
      appendEvent: jest.fn().mockResolvedValue(storedOrder()),
      markClosing: jest
        .fn()
        .mockResolvedValue(storedOrder({ status: TmaSaleStatus.CLOSING })),
    }
    users = {
      findByTelegramId: jest.fn().mockResolvedValue({ balance: 35_000 }),
      commitFrozenBalance: jest.fn().mockResolvedValue(undefined),
    }
    ledger = { refund: jest.fn().mockResolvedValue(undefined) }
    orders = { findUnsettledByCard: jest.fn().mockResolvedValue([]) }
    terminals = {
      disable: jest.fn().mockResolvedValue(undefined),
      stopRouting: jest.fn().mockResolvedValue(undefined),
    }
    gateway = { emitSaleStatusChange: jest.fn(), emitBalanceUpdated: jest.fn() }

    service = new SaleCancelService(
      db as unknown as TmaSaleDbService,
      users as unknown as TmaUserDbService,
      orders as unknown as OrderDbService,
      terminals as unknown as SaleTerminalService,
      { emit: jest.fn().mockResolvedValue(undefined) } as unknown as SaleProgressService,
      gateway as unknown as TmaGateway,
      ledger as unknown as BalanceLedgerService,
    )
  })

  describe('an untouched order', () => {
    it('refunds the whole stake', async () => {
      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result).toMatchObject({
        status: TmaSaleStatus.CANCELLED,
        refunded: FROZEN_CENTS,
        consumed: 0,
      })
      expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, FROZEN_CENTS, 'order-1')
      expect(users.commitFrozenBalance).not.toHaveBeenCalled()
    })

    it('takes the terminal down as well', async () => {
      await service.cancel('order-1', TELEGRAM_ID)

      // What disabling actually does is `SaleTerminalService`'s own
      // spec; all this path owes is asking for it, on this order.
      expect(terminals.disable).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: CARD_ID, traderId: 346 }),
        'Cancelled',
      )
    })
  })

  describe('an order that has already taken money', () => {
    /**
     * The hryvnia already in the jar is the user's — it is in their own bank.
     * Refunding the USDT that paid for it too would let anyone collect fiat for
     * free by cancelling one order at a time.
     */
    it('keeps back the USDT the received hryvnia paid for', async () => {
      db.findById.mockResolvedValue(storedOrder({ receivedAmount: 8_700 })) // ₴87

      const result = await service.cancel('order-1', TELEGRAM_ID)

      // 8 700 / 4 652 * 100 = 187 cents = 1.87 USDT
      expect(result.consumed).toBe(187)
      expect(result.refunded).toBe(FROZEN_CENTS - 187)
      expect(users.commitFrozenBalance).toHaveBeenCalledWith(TELEGRAM_ID, 187)
      expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, FROZEN_CENTS - 187, 'order-1')
    })

    it('always splits the stake exactly, never creating or losing cents', async () => {
      for (const received of [0, 1, 8_700, 355_900, 711_800]) {
        db.findById.mockResolvedValue(storedOrder({ receivedAmount: received }))

        const { refunded, consumed } = await service.cancel('order-1', TELEGRAM_ID)

        expect(refunded + consumed).toBe(FROZEN_CENTS)
        expect(refunded).toBeGreaterThanOrEqual(0)
      }
    })

    /** A jar reporting more than the order was for must not owe the user money. */
    it('never refunds a negative amount', async () => {
      db.findById.mockResolvedValue(storedOrder({ receivedAmount: 99_999_999 }))

      const { refunded, consumed } = await service.cancel('order-1', TELEGRAM_ID)

      expect(refunded).toBe(0)
      expect(consumed).toBe(FROZEN_CENTS)
    })
  })

  /**
   * The reported bug. `receivedAmount` counts only money matched to a settled
   * Transacto order, and the matcher cannot always attribute what lands in the
   * jar — an unrecognised or ambiguous deposit, or a payment with no order
   * behind it. Reading it directly refunded the whole stake to a user who was
   * sitting on the hryvnia.
   */
  describe('money in the jar that no order accounts for', () => {
    it('keeps back the USDT that jar growth paid for', async () => {
      // ₴87 in the jar, none of it matched to an order.
      db.findById.mockResolvedValue(
        storedOrder({ receivedAmount: 0, openingJarBalance: 0, jarBalance: 8_700 }),
      )

      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result.consumed).toBe(187)
      expect(result.refunded).toBe(FROZEN_CENTS - 187)
    })

    /**
     * A jar the user already had money in. That hryvnia was theirs before the
     * order existed, so it may not be charged for — only the growth counts.
     */
    it('charges only the growth, never a balance the jar started with', async () => {
      db.findById.mockResolvedValue(
        storedOrder({ receivedAmount: 0, openingJarBalance: 50_000, jarBalance: 58_700 }),
      )

      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result.consumed).toBe(187)
      expect(result.refunded).toBe(FROZEN_CENTS - 187)
    })

    /** An unknown baseline may not become a charge. */
    it('ignores the jar entirely when it was never scraped before', async () => {
      db.findById.mockResolvedValue(
        storedOrder({ receivedAmount: 0, openingJarBalance: null, jarBalance: 8_700 }),
      )

      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result.consumed).toBe(0)
      expect(result.refunded).toBe(FROZEN_CENTS)
    })

    /** The two measures are routes to the same figure; the larger is the truth. */
    it('takes matched orders when they exceed the jar growth', async () => {
      db.findById.mockResolvedValue(
        storedOrder({ receivedAmount: 8_700, openingJarBalance: 0, jarBalance: 1_000 }),
      )

      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result.consumed).toBe(187)
    })

    /** A jar the user drained mid-order must not produce a negative charge. */
    it('never charges a negative amount when the jar shrank', async () => {
      db.findById.mockResolvedValue(
        storedOrder({ receivedAmount: 0, openingJarBalance: 10_000, jarBalance: 0 }),
      )

      const result = await service.cancel('order-1', TELEGRAM_ID)

      expect(result.consumed).toBe(0)
      expect(result.refunded).toBe(FROZEN_CENTS)
    })
  })

  describe('what blocks stopping early', () => {
    /**
     * The rule that matters, and the reason winding down exists at all.
     * Releasing the stake while a payer can still complete would hand the user
     * their USDT *and* the hryvnia that arrives afterwards.
     */
    it.each([OrderStatus.PENDING, OrderStatus.PAUSED, OrderStatus.APPEAL])(
      'refunds nothing yet while an order is %s',
      async (status) => {
        orders.findUnsettledByCard.mockResolvedValue([order(status)])

        const result = await service.cancel('order-1', TELEGRAM_ID)

        expect(result.status).toBe(TmaSaleStatus.CLOSING)
        expect(result.refunded).toBe(0)
        // Nothing moved: not the ending, not the ledger.
        expect(db.cancelIfOpen).not.toHaveBeenCalled()
        expect(ledger.refund).not.toHaveBeenCalled()
        expect(users.commitFrozenBalance).not.toHaveBeenCalled()
      },
    )

    /**
     * The terminal is stood down for *routing* only. Switching it off would
     * stop the scrape, and a payer holding one of those outstanding orders can
     * still pay — into a jar nobody would then be watching.
     */
    it('stops routing without taking the terminal out of service', async () => {
      orders.findUnsettledByCard.mockResolvedValue([order(OrderStatus.PENDING)])

      await service.cancel('order-1', TELEGRAM_ID)

      expect(terminals.stopRouting).toHaveBeenCalled()
      expect(terminals.disable).not.toHaveBeenCalled()
    })

    it('marks the order as closing exactly once', async () => {
      orders.findUnsettledByCard.mockResolvedValue([order(OrderStatus.PENDING)])

      await service.cancel('order-1', TELEGRAM_ID)

      expect(db.markClosing).toHaveBeenCalledWith('order-1')
    })

    /** A second tap must not stand the terminal down twice. */
    it('refuses a second stop once the flip is lost to a race', async () => {
      orders.findUnsettledByCard.mockResolvedValue([order(OrderStatus.PENDING)])
      db.markClosing.mockResolvedValue(null)

      await expect(service.cancel('order-1', TELEGRAM_ID)).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(terminals.stopRouting).not.toHaveBeenCalled()
    })

    it.each([
      TmaSaleStatus.COMPLETED,
      TmaSaleStatus.CANCELLED,
      TmaSaleStatus.FAILED,
      TmaSaleStatus.BLOCKED,
    ])('refuses an order that is already %s', async (status) => {
      db.findById.mockResolvedValue(storedOrder({ status }))

      await expect(service.cancel('order-1', TELEGRAM_ID)).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(ledger.refund).not.toHaveBeenCalled()
    })

    /** Two taps arriving together must produce one refund, not two. */
    it('refunds once when the status flip is lost to a race', async () => {
      db.cancelIfOpen.mockResolvedValue(null)

      await expect(service.cancel('order-1', TELEGRAM_ID)).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(ledger.refund).not.toHaveBeenCalled()
    })

    /**
     * The one stop this product refuses outright — everywhere else an
     * outstanding payment decides how a sale ends, never whether its owner may
     * ask. Here an operator is sending hryvnia to a card nothing watches.
     */
    it('refuses while an operator is transferring the tail', async () => {
      db.findById.mockResolvedValue(heldByATransfer())

      await expect(service.cancel('order-1', TELEGRAM_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_IN_TRANSFER,
      })
      expect(ledger.refund).not.toHaveBeenCalled()
      expect(db.markClosing).not.toHaveBeenCalled()
    })

    it('will not stop somebody else order', async () => {
      db.findById.mockResolvedValue(storedOrder({ telegramId: 999 }))

      await expect(service.cancel('order-1', TELEGRAM_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })
  })

  describe('canCancel', () => {
    it.each([
      TmaSaleStatus.CREATED,
      TmaSaleStatus.TERMINAL_READY,
      TmaSaleStatus.AWAITING_FIAT,
    ])('is true for an open order: %s', (status) => {
      expect(service.canCancel(storedOrder({ status }) as never)).toBe(true)
    })

    /**
     * The one thing that takes the button away. Somebody is at that moment
     * sending hryvnia to a card nothing watches, and a sale that ended in
     * between would take a real transfer into a finished order.
     */
    it('is false while an operator is transferring the tail', () => {
      expect(service.canCancel(heldByATransfer() as never)).toBe(false)
    })

    /**
     * **And it does not expire.** Whether the transfer was really made is a
     * question for a person, and a timer would answer it in the seller's favour
     * by default — handing back USDT for money that may well have landed. The
     * way out is an operator giving the tail back.
     */
    it('is false however long ago the transfer was taken on', () => {
      const old = MINUTES_AGO(60 * 24 * 7)

      expect(
        service.canCancel(
          heldByATransfer({ tailAnnouncedAt: old, tailClaimedAt: old }) as never,
        ),
      ).toBe(false)
    })

    it('is true again once an operator gave the tail back', () => {
      expect(service.canCancel(heldByATransfer({ tailWaivedAt: new Date() }) as never)).toBe(
        true,
      )
    })

    /** Asking is not the same as somebody going to their banking app. */
    it('is true while the alert is unanswered', () => {
      expect(service.canCancel(heldByATransfer({ tailClaimedAt: null }) as never)).toBe(true)
    })

    /**
     * Outstanding orders no longer decide *whether* a stop may be asked for,
     * only how it happens — so the button stays live.
     */
    it('stays true while an order is unsettled', () => {
      orders.findUnsettledByCard.mockResolvedValue([order(OrderStatus.APPEAL)])

      expect(service.canCancel(storedOrder() as never)).toBe(true)
    })

    /** An order already winding down offers no second button. */
    it.each([
      TmaSaleStatus.CLOSING,
      TmaSaleStatus.COMPLETED,
      TmaSaleStatus.CANCELLED,
      TmaSaleStatus.BLOCKED,
    ])('is false for %s', (status) => {
      expect(service.canCancel(storedOrder({ status }) as never)).toBe(false)
    })
  })

  /**
   * The refund is already in the ledger by the time the terminal is torn down,
   * so a failure there must not cost the user money they are owed. The real
   * teardown swallows its own errors, but the ordering is what guarantees this
   * — so the refund is asserted against a teardown that does throw.
   */
  it('still refunds when the terminal cannot be disabled', async () => {
    terminals.disable.mockRejectedValue(new Error('502'))

    await service.cancel('order-1', TELEGRAM_ID).catch(() => undefined)

    expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, FROZEN_CENTS, 'order-1')
  })
})
