import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  ERROR,
  priceSale,
  priceStake,
  SaleEventType,
  SaleRemainderPolicy,
  sellRate,
  TerminalHistoryAlertType,
  TmaSaleStatus,
} from '@transacto/contracts'
import { SaleFacadeService } from './sale-facade.service'
import { JarSaleDestinationService } from './jar-sale-destination.service'
import type { SaleBlockService } from './sale-block.service'
import type { BalanceLedgerService } from './balance-ledger.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TerminalBroadcastService } from 'src/modules/terminal'
import type { TmaServiceTraderService } from './tma-service-trader.service'
import type { SaleProgressService } from './sale-progress.service'
import type { ReferralService } from './referral.service'
import type { DropLinkResolverService } from './drop-link-resolver.service'
import type { SaleTerminalService } from './sale-terminal.service'
import type { ExchangeRateService } from './exchange-rate.service'
import type { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import type Redis from 'ioredis'
import type { EventEmitter2 } from '@nestjs/event-emitter'

const TELEGRAM_ID = 885140
const TRADER_ID = 346

const storedOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'Z38SL69F',
  telegramId: TELEGRAM_ID,
  fiatAmount: 404_000,
  frozenUsdt: 10_000,
  receivedAmount: 404_000,
  status: TmaSaleStatus.AWAITING_FIAT,
  events: [],
  ...overrides,
})

/** What the market service answers with, in kopecks per USDT. */
const MARKET = 4652

/**
 * The rate everything in this file actually deals in — the sell rate.
 *
 * Submissions quote it, orders store it, and the facade derives it from
 * {@link MARKET} exactly once. Written as `sellRate(MARKET)` rather than as a
 * literal so the spec cannot drift from the spread it is testing against.
 */
const RATE = sellRate(MARKET)

/** Only PrivatBank is open for new sales, and it names its own card. */
const PRIVAT_LINK = 'https://next.privat24.ua/money-transfer/share/abc'

/** The card PrivatBank reports for that envelope — and so the card orders pay into. */
const DROP_CARD = '4874100000003205'

describe('SaleFacadeService', () => {
  let db: {
    findById: jest.Mock
    completeIfOpen: jest.Mock
    appendEvent: jest.Mock
    create: jest.Mock
    linkTerminal: jest.Mock
    updateStatus: jest.Mock
    countSlotsHeldByTelegramId: jest.Mock
  }
  let users: {
    findByTelegramId: jest.Mock
    commitFrozenBalance: jest.Mock
    incrementTurnover: jest.Mock
  }
  /** The one door onto the balance: it moves the money and books why. */
  let ledger: { freeze: jest.Mock; refund: jest.Mock }
  let gateway: {
    emitSaleStatusChange: jest.Mock
    emitBalanceUpdated: jest.Mock
  }
  let progress: { emit: jest.Mock }
  let referrals: { creditForSale: jest.Mock }
  let dropLinks: { resolve: jest.Mock }
  let terminals: { disable: jest.Mock; stopRouting: jest.Mock }
  let transacto: { createCredential: jest.Mock }
  let rates: { getRate: jest.Mock }
  let emitter: { emit: jest.Mock; emitAsync: jest.Mock }
  /** The create lock. `set` answering 'OK' is an uncontended acquire. */
  let redis: { set: jest.Mock; del: jest.Mock }
  let facade: SaleFacadeService

  beforeEach(() => {
    db = {
      findById: jest.fn().mockResolvedValue(storedOrder()),
      completeIfOpen: jest
        .fn()
        .mockResolvedValue(storedOrder({ status: TmaSaleStatus.COMPLETED })),
      appendEvent: jest
        .fn()
        .mockResolvedValue(storedOrder({ status: TmaSaleStatus.COMPLETED })),
      create: jest.fn(),
      linkTerminal: jest.fn(),
      updateStatus: jest.fn(),
      countSlotsHeldByTelegramId: jest.fn().mockResolvedValue(0),
    }
    redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) }
    users = {
      findByTelegramId: jest.fn().mockResolvedValue({
        balance: 50_000,
        frozenBalance: 10_000,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman',
      }),
      commitFrozenBalance: jest.fn().mockResolvedValue(undefined),
      incrementTurnover: jest.fn().mockResolvedValue(0),
    }
    ledger = {
      freeze: jest.fn().mockResolvedValue({ balance: 40_000, frozenBalance: 20_000 }),
      refund: jest.fn().mockResolvedValue(undefined),
    }
    gateway = { emitSaleStatusChange: jest.fn(), emitBalanceUpdated: jest.fn() }
    progress = { emit: jest.fn().mockResolvedValue(undefined) }
    referrals = { creditForSale: jest.fn().mockResolvedValue(undefined) }
    // Pass-through by default: link resolution has its own spec, and every
    // test here starts from a link that needs none.
    dropLinks = {
      // The whole `ResolveDropLinkRes`, not a convenient subset: the facade
      // reads `cardNumber` to refuse a link and a card that belong to different
      // people, and a stub missing the field would silently skip that check.
      resolve: jest.fn(async (_bank: unknown, link: string) => ({
        link,
        resolved: false,
        goal: null,
        // PrivatBank always names the card, and the facade now takes the bank's
        // answer as the account. A stub returning null would be a link the
        // facade must refuse, not a happy path.
        cardNumber: DROP_CARD,
        cardNumberMask: null,
        ownerName: null,
      })),
    }
    terminals = {
      disable: jest.fn().mockResolvedValue(undefined),
      stopRouting: jest.fn().mockResolvedValue(undefined),
    }
    transacto = {
      createCredential: jest.fn().mockResolvedValue({ card_id: 100, terminal_id: 23_892 }),
    }
    // The live market, stubbed at the same figure the old env var carried, so
    // every amount asserted below still reads as ₴46.52 per USDT.
    rates = { getRate: jest.fn().mockResolvedValue(MARKET) }
    emitter = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) }

    // Never exercised here — the ledger guard has its own file — but the
    // constructor takes it, and `undefined` in a positional list is how the
    // next reordering goes unnoticed.
    const blockService = { block: jest.fn(async () => true) }

    facade = new SaleFacadeService(
      db as unknown as TmaSaleDbService,
      users as unknown as TmaUserDbService,
      transacto as unknown as TransactoApiService,
      {
        upsert: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as TerminalDbService,
      { announceEnabled: jest.fn().mockResolvedValue(undefined) } as unknown as TerminalBroadcastService,
      {
        resolve: jest.fn().mockResolvedValue({ traderId: TRADER_ID, apiToken: 't' }),
      } as unknown as TmaServiceTraderService,
      progress as unknown as SaleProgressService,
      referrals as unknown as ReferralService,
      terminals as unknown as SaleTerminalService,
      rates as unknown as ExchangeRateService,
      gateway as unknown as TmaGateway,
      emitter as unknown as EventEmitter2,
      redis as unknown as Redis,
      ledger as unknown as BalanceLedgerService,
      blockService as unknown as SaleBlockService,
      // The real jar strategy over the same drop-link double this file has
      // always used. Every assertion below about the receiver name, the card
      // the bank names and the mask it publishes is now testing that class
      // through the facade, which is where those decisions moved — a stub here
      // would leave all of them passing against nothing.
      [new JarSaleDestinationService(dropLinks as unknown as DropLinkResolverService)],
    )
  })

  describe('completeSale', () => {
    it('commits the frozen USDT and credits turnover exactly once', async () => {
      const completed = await facade.completeSale('order-1')

      expect(completed).toBe(true)
      expect(users.commitFrozenBalance).toHaveBeenCalledWith(TELEGRAM_ID, 10_000)
      // Turnover is a UAH figure, not a USDT one — mixing them here would
      // inflate every user's trust level by a factor of the exchange rate.
      expect(users.incrementTurnover).toHaveBeenCalledWith(TELEGRAM_ID, 404_000)
    })

    /**
     * The trader's own history feed is the record of what happened to a
     * terminal, and a Mini App terminal's story simply stopped: the last order
     * matched, then nothing, which reads the same as a scraper that died.
     */
    describe("the entry on the terminal's history", () => {
      it('announces the completion on the terminal channel', async () => {
        await facade.completeSale('order-1')

        expect(emitter.emitAsync).toHaveBeenCalledWith(
          'terminal.state_changed',
          expect.objectContaining({
            context: expect.objectContaining({
              alerts: [
                expect.objectContaining({
                  type: TerminalHistoryAlertType.SALE_COMPLETED,
                }),
              ],
            }),
          }),
        )
      })

      it('carries what the terminal actually took in, and its target', async () => {
        await facade.completeSale('order-1')

        const [, payload] = emitter.emitAsync.mock.calls[0]
        expect(payload.context.alerts[0].details).toMatchObject({
          publicId: 'Z38SL69F',
          amount: 404_000,
          target: 404_000,
          refundedUsdt: 0,
        })
      })

      /**
       * Before the terminal is stood down, and awaited, so the entry describes
       * the jar as it was at the moment the order closed.
       *
       * This used to guard something sharper: the teardown cleared the
       * terminal's Redis keys, and the history writer reads the jar's balance
       * from exactly those, so a fire-and-forget emit filed the closing entry
       * against a balance of zero. Completion no longer tears anything down —
       * `stopRouting` leaves the keys alone until the jar is closed — so the
       * race is gone, but the order is still the one that makes sense.
       */
      it('lands before the terminal stops routing', async () => {
        const order: string[] = []
        emitter.emitAsync.mockImplementation(async () => {
          order.push('history')
          return []
        })
        terminals.stopRouting.mockImplementation(async () => {
          order.push('stopRouting')
        })

        await facade.completeSale('order-1')

        expect(order).toEqual(['history', 'stopRouting'])
      })

      it('says nothing when the order was already closed', async () => {
        db.completeIfOpen.mockResolvedValue(null)

        await facade.completeSale('order-1')

        expect(emitter.emitAsync).not.toHaveBeenCalled()
      })
    })

    it('records a COMPLETED timeline entry carrying the amount', async () => {
      await facade.completeSale('order-1')

      expect(db.appendEvent).toHaveBeenCalledWith(
        'order-1',
        expect.objectContaining({ type: SaleEventType.COMPLETED, amount: 404_000 }),
      )
    })

    it('announces the new status, the balance and a progress snapshot', async () => {
      await facade.completeSale('order-1')

      expect(gateway.emitSaleStatusChange).toHaveBeenCalledWith(
        TELEGRAM_ID,
        'order-1',
        TmaSaleStatus.COMPLETED,
      )
      expect(gateway.emitBalanceUpdated).toHaveBeenCalledWith(TELEGRAM_ID, 50_000)
      expect(progress.emit).toHaveBeenCalledTimes(1)
    })

    /**
     * The worked example the feature was specified with, scaled to this
     * fixture's ₴46.52 rate: an order created with REFUND_TO_BALANCE that
     * closes on a tail no payment could ever have covered.
     *
     * ₴4 040 target, ₴3 800 delivered, ₴240 left. At ₴46.52 per USDT that is
     * 516 cents back to the spendable balance, and the rest of the stake stays
     * spent — it bought the ₴3 800 that did arrive.
     */
    describe('an order that refunds its unfillable tail', () => {
      const refunding = (over: Record<string, unknown> = {}) =>
        storedOrder({
          remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
          exchangeRate: RATE,
          receivedAmount: 380_000,
          jarBalance: 380_000,
          openingJarBalance: 0,
          ...over,
        })

      beforeEach(() => {
        db.findById.mockResolvedValue(refunding())
        db.completeIfOpen.mockResolvedValue(
          refunding({ status: TmaSaleStatus.COMPLETED }),
        )
        db.appendEvent.mockResolvedValue(refunding({ status: TmaSaleStatus.COMPLETED }))
      })

      it('returns the tail to the spendable balance and commits the rest', async () => {
        await facade.completeSale('order-1')

        // The order names itself on the refund: the book has to be able to say
        // which order gave this money back.
        expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, 506, 'order-1')
        expect(users.commitFrozenBalance).toHaveBeenCalledWith(TELEGRAM_ID, 10_000 - 506)
      })

      /**
       * Turnover drives the trust ladder. Crediting the full target would raise
       * a user's limits on hryvnia that nobody ever paid.
       */
      it('credits turnover on what actually arrived, not on the target', async () => {
        await facade.completeSale('order-1')

        expect(users.incrementTurnover).toHaveBeenCalledWith(TELEGRAM_ID, 380_000)
      })

      it('pays the referrer on the same settled figure', async () => {
        await facade.completeSale('order-1')

        expect(referrals.creditForSale).toHaveBeenCalledWith(
          expect.objectContaining({ telegramId: TELEGRAM_ID }),
          380_000,
        )
      })

      /**
       * The turnover cap this used to assert is gone with the teardown. It
       * existed to stop a payer being routed into a jar whose order had already
       * been paid out, by leaving no headroom above what was settled;
       * `enable_orders: 0` says the same thing outright and does not depend on
       * getting the arithmetic right.
       */
      it('stops routing rather than capping what is left', async () => {
        await facade.completeSale('order-1')

        expect(terminals.stopRouting).toHaveBeenCalledWith(expect.anything(), 'Completed')
        expect(terminals.disable).not.toHaveBeenCalled()
      })

      /** The refund is written by the same update that closes the order. */
      it('records the refund on the order itself', async () => {
        await facade.completeSale('order-1')

        expect(db.completeIfOpen).toHaveBeenCalledWith('order-1', { usdt: 506, fiat: 24_000 })
      })

      /**
       * The tail came back, and that is *what allowed* the order to close — so
       * it goes on the timeline first.
       */
      it('puts the refund on the timeline before the completion', async () => {
        await facade.completeSale('order-1')

        const types = db.appendEvent.mock.calls.map(([, event]) => event.type)
        expect(types).toEqual([
          SaleEventType.REMAINDER_REFUNDED,
          SaleEventType.COMPLETED,
        ])
      })

      /** USDT cents, like STOPPED_BY_USER — what comes back is USDT. */
      it('carries the refunded USDT on the refund entry', async () => {
        await facade.completeSale('order-1')

        expect(db.appendEvent).toHaveBeenCalledWith(
          'order-1',
          expect.objectContaining({
            type: SaleEventType.REMAINDER_REFUNDED,
            amount: 506,
          }),
        )
      })

      /**
       * A jar that reached its target has no tail, whatever policy the order
       * carries — the two are not alternatives.
       */
      it('refunds nothing when the target arrived in full after all', async () => {
        db.findById.mockResolvedValue(
          refunding({ receivedAmount: 404_000, jarBalance: 404_000 }),
        )

        await facade.completeSale('order-1')

        expect(ledger.refund).not.toHaveBeenCalled()
        expect(users.commitFrozenBalance).toHaveBeenCalledWith(TELEGRAM_ID, 10_000)
        expect(users.incrementTurnover).toHaveBeenCalledWith(TELEGRAM_ID, 404_000)
      })
    })

    /**
     * The whole reason completion goes through an atomic guarded update. Two
     * payments matching in the same scrape both reach this method; paying out
     * twice would double-count turnover and commit frozen balance the user
     * does not have.
     */
    it('pays out nothing when the order was already closed', async () => {
      db.completeIfOpen.mockResolvedValue(null)

      const completed = await facade.completeSale('order-1')

      expect(completed).toBe(false)
      expect(users.commitFrozenBalance).not.toHaveBeenCalled()
      expect(users.incrementTurnover).not.toHaveBeenCalled()
      expect(gateway.emitSaleStatusChange).not.toHaveBeenCalled()
      // The referral cut rides on the same guard as everything else: a second
      // payment match must not pay the referrer a second time.
      expect(referrals.creditForSale).not.toHaveBeenCalled()
    })

    it('pays the referrer once, from the completed order', async () => {
      await facade.completeSale('order-1')

      expect(referrals.creditForSale).toHaveBeenCalledTimes(1)
      // The settled figure rides alongside the order. On a full fill it is the
      // target; on one that closed by refunding an unfillable tail it is less,
      // and paying a referrer a cut of hryvnia nobody paid would invent money.
      expect(referrals.creditForSale).toHaveBeenCalledWith(
        expect.objectContaining({ telegramId: TELEGRAM_ID, fiatAmount: 404_000 }),
        404_000,
      )
    })

    /**
     * Routing off, but **not** torn down. The order is over; the jar is not.
     *
     * A jar left open keeps taking money after its order has finished, and a
     * payer who started late lands hryvnia in it minutes after the order
     * expired — money nothing matches, which comes back as an appeal we eat.
     * Only the bank reporting the jar closed retires the terminal, and that is
     * also what gives the user their next sale slot back.
     */
    it('stops routing without retiring the terminal', async () => {
      await facade.completeSale('order-1')

      expect(terminals.stopRouting).toHaveBeenCalledWith(
        expect.objectContaining({ telegramId: TELEGRAM_ID }),
        'Completed',
      )
      expect(terminals.disable).not.toHaveBeenCalled()
    })

    it('leaves the terminal alone when the order was already closed', async () => {
      db.completeIfOpen.mockResolvedValue(null)

      await facade.completeSale('order-1')

      expect(terminals.disable).not.toHaveBeenCalled()
    })

    it('rejects an unknown order rather than silently doing nothing', async () => {
      db.findById.mockResolvedValue(null)

      await expect(facade.completeSale('nope')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('getSellRate', () => {
    /**
     * The one rate this module quotes. The market is fetched once and turned
     * into it here, so nothing downstream — not the form, not the order, not a
     * settlement — ever sees a market figure it could price with.
     */
    it('quotes the market marked up, never the market itself', async () => {
      rates.getRate.mockResolvedValue(4_711)

      const quoted = await facade.getSellRate()

      expect(quoted).toBe(sellRate(4_711))
      expect(quoted).toBeGreaterThan(4_711)
    })

    it('refuses to quote when the market cannot be reached', async () => {
      rates.getRate.mockRejectedValue(new ServiceUnavailableException())

      await expect(facade.getSellRate()).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    /** Nothing may be frozen or written against a price we could not fetch. */
    it('strands nothing when the rate is unavailable mid-creation', async () => {
      rates.getRate.mockRejectedValue(new ServiceUnavailableException())
      users.findByTelegramId.mockResolvedValue({ balance: 1_000_000, frozenBalance: 0, totalTurnover: 0 })
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: DROP_CARD,
        ownerName: null,
      })

      await expect(
        facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException)

      expect(ledger.freeze).not.toHaveBeenCalled()
      expect(db.create).not.toHaveBeenCalled()
    })
  })

  /**
   * A trust level now rations parallelism and nothing else. It used to cap the
   * size of one order, which bounded nothing — the stake already does that —
   * while a user running ten small orders at once went unnoticed.
   */
  describe('the parallel-order allowance', () => {
    const create = () =>
      facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE })

    const withTurnover = (totalTurnover: number) => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman',
      })
    }

    beforeEach(() => {
      withTurnover(0)
      ledger.freeze.mockResolvedValue({ balance: 900_000, frozenBalance: 100_000 })
      db.create.mockResolvedValue({ _id: { toString: () => 'order-2' }, publicId: 'AAAA1111' })
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: DROP_CARD,
        ownerName: null,
      })
    })

    /** NEWBIE: one at a time. */
    it('refuses a second order at the first level', async () => {
      db.countSlotsHeldByTelegramId.mockResolvedValue(1)

      await expect(create()).rejects.toBeInstanceOf(BadRequestException)
    })

    it('allows the first order at the first level', async () => {
      db.countSlotsHeldByTelegramId.mockResolvedValue(0)

      await expect(create()).resolves.toBeDefined()
    })

    /** EXPERIENCED: three. PRO: five. */
    it.each([
      ['EXPERIENCED', 100_000 * 100, 2, true],
      ['EXPERIENCED', 100_000 * 100, 3, false],
      ['PRO', 500_000 * 100, 4, true],
      ['PRO', 500_000 * 100, 5, false],
    ])('at %s with %i running, allowed: %s', async (_level, turnover, held, allowed) => {
      withTurnover(turnover as number)
      db.countSlotsHeldByTelegramId.mockResolvedValue(held)

      if (allowed) await expect(create()).resolves.toBeDefined()
      else await expect(create()).rejects.toBeInstanceOf(BadRequestException)
    })

    /**
     * Nothing may be taken from a user who is being refused. Freezing first and
     * checking after would strand the stake of every rejected order.
     */
    it('freezes nothing and writes nothing when the allowance is spent', async () => {
      db.countSlotsHeldByTelegramId.mockResolvedValue(1)

      await expect(create()).rejects.toThrow()

      expect(ledger.freeze).not.toHaveBeenCalled()
      expect(db.create).not.toHaveBeenCalled()
    })

    describe('the create lock', () => {
      /**
       * Count-then-insert is a read-then-write, and two requests in the same
       * instant would both read a free slot. At NEWBIE that is the difference
       * between a limit and a suggestion.
       */
      it('is taken before the count and released after the insert', async () => {
        await create()

        expect(redis.set).toHaveBeenCalledWith(
          `tma:sale:create:lock:${TELEGRAM_ID}`,
          '1',
          'PX',
          expect.any(Number),
          'NX',
        )
        expect(redis.del).toHaveBeenCalledWith(`tma:sale:create:lock:${TELEGRAM_ID}`)
      })

      it('refuses a create while another is already in flight', async () => {
        redis.set.mockResolvedValue(null)

        await expect(create()).rejects.toBeInstanceOf(ConflictException)
        expect(db.countSlotsHeldByTelegramId).not.toHaveBeenCalled()
        expect(ledger.freeze).not.toHaveBeenCalled()
      })

      /** A lock left behind by a refusal would bar the user for its whole TTL. */
      it('is released even when the allowance refuses the order', async () => {
        db.countSlotsHeldByTelegramId.mockResolvedValue(1)

        await expect(create()).rejects.toThrow()

        expect(redis.del).toHaveBeenCalledWith(`tma:sale:create:lock:${TELEGRAM_ID}`)
      })

      /**
     * The failure this was written for: a `bankType` the schema did not know
     * left a user with 142 USDT frozen against an order that does not exist,
     * and nothing in the product could hand it back.
     */
    it('gives the stake back when the order cannot be written', async () => {
      db.create.mockRejectedValue(new Error('validation failed'))

      await expect(create()).rejects.toThrow()

      expect(ledger.freeze).toHaveBeenCalled()
      expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, expect.any(Number))
    })

    /** The original failure is what the caller has to see, not a second one. */
    it('reports the insert failure even when giving the stake back fails too', async () => {
      db.create.mockRejectedValue(new Error('validation failed'))
      ledger.refund.mockRejectedValue(new Error('mongo is down'))

      await expect(create()).rejects.toThrow('validation failed')
    })

    it('is released when the insert itself fails', async () => {
        db.create.mockRejectedValue(new Error('mongo is down'))

        await expect(create()).rejects.toThrow()

        expect(redis.del).toHaveBeenCalledWith(`tma:sale:create:lock:${TELEGRAM_ID}`)
      })

      /**
       * Held across two Mongo round trips and nothing else: Transacto's
       * terminal provisioning takes seconds, and holding the lock across it
       * would make one slow terminal block the user's next order.
       */
      it('is released before Transacto is called', async () => {
        transacto.createCredential.mockImplementation(() => {
          expect(redis.del).toHaveBeenCalled()
          return Promise.resolve({ card_id: 1, terminal_id: 2 })
        })

        await create()

        expect(transacto.createCredential).toHaveBeenCalled()
      })
    })
  })

  describe('creating the terminal', () => {
    beforeEach(() => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover: 0,
        // The profile fields matter here: they are the fallback for the
        // receiver name when the bank does not disclose an account holder.
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman',
      })
      ledger.freeze.mockResolvedValue({ balance: 900_000, frozenBalance: 100_000 })
      db.create.mockResolvedValue({ _id: { toString: () => 'order-2' }, publicId: 'AAAA1111' })
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: DROP_CARD,
        ownerName: null,
      })
    })

    /**
     * `enable_orders`, spelled exactly as `credentials_update` spells it. It
     * was previously sent as `enabled_orders`, which Transacto ignores — so
     * every terminal the Mini App created came up unable to take a single
     * order, and the user watched an empty jar until their order expired.
     */
    it('asks Transacto for a terminal that is live and taking orders', async () => {
      await facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE })

      expect(transacto.createCredential).toHaveBeenCalledWith(
        't',
        expect.objectContaining({ enabled: 1, enable_orders: 1 }),
      )
      expect(transacto.createCredential.mock.calls[0][1]).not.toHaveProperty('enabled_orders')
    })

    /**
     * `name` is the receiver a payer is shown, not a slot for our identifiers.
     * It used to be `TMA-<telegramId>`, which gave a payer a reason to abandon
     * the transfer rather than trust it.
     */
    describe('the receiver name', () => {
      const create = () =>
        facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE })

      it('is the account holder when the bank names one', async () => {
        dropLinks.resolve.mockResolvedValue({
          link: PRIVAT_LINK,
          resolved: false,
          goal: null,
          cardNumber: DROP_CARD,
          ownerName: 'Петренко І.',
        })

        await create()

        expect(transacto.createCredential).toHaveBeenCalledWith(
          't',
          expect.objectContaining({ name: 'Петренко І.' }),
        )
      })

      /** Monobank and PUMB disclose no owner; the profile is all there is. */
      it('falls back to the Telegram profile when it does not', async () => {
        await create()

        expect(transacto.createCredential).toHaveBeenCalledWith(
          't',
          expect.objectContaining({ name: 'Роман Петренко' }),
        )
      })

      it('never sends our own identifier as the receiver', async () => {
        await create()

        expect(transacto.createCredential.mock.calls[0][1].name).not.toContain(
          String(TELEGRAM_ID),
        )
      })

      /**
       * Stored as well as sent, so support can answer "what name did the payer
       * see?" without going to ask Transacto.
       */
      it('is recorded on the order', async () => {
        await create()

        expect(db.create).toHaveBeenCalledWith(
          expect.objectContaining({ receiverName: 'Роман Петренко' }),
        )
      })

      /**
       * The correlation the old identifier provided is not lost: the terminal
       * name carries the order's public id, which resolves to the user.
       */
      it('still names the order in the terminal name', async () => {
        await create()

        expect(transacto.createCredential.mock.calls[0][1].terminal_name).toContain('TMA-')
      })
    })
  })

  /**
   * PrivatBank's envelope record names the card it pays into, so a link and a
   * card number that belong to different people can be refused here — before
   * anything is frozen. They used to be accepted as an unrelated pair, and the
   * mismatch only surfaced three expired orders later as an `ORDERS_EXPIRED`
   * block, with the stake already frozen and nothing explaining why.
   */
  /**
   * The same one-hryvnia tolerance the running-order check uses. The two must
   * agree: a creation check stricter than compliance would refuse orders that
   * would have run fine, and a looser one would accept orders blocked on their
   * first scrape.
   */
  /**
   * The market moves while a form is being filled. Every figure the user was
   * shown — the rate, the hryvnia total, the USDT it stakes — was worked out at
   * the rate they quote, and the sale snapshots all three.
   */
  describe('a quote the market has moved out from under', () => {
    const submit = (quotedRate: number) =>
      facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: quotedRate })

    it('accepts a quote at the live rate', async () => {
      await submit(RATE).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalled()
    })

    /**
     * **The bug this replaced.** A drift too small to move the target was
     * waved through and the stake re-derived at the new rate without a word —
     * a seller who typed ten USDT on a form left open for a minute found a
     * 9.98 sale. The form follows the rate now and says when it moves, so a
     * quote a kopeck out is one the screen never showed.
     */
    it.each([
      ['a kopeck higher', RATE + 1],
      ['a kopeck lower', RATE - 1],
      ['far higher', RATE + 300],
      ['far lower', RATE - 300],
    ])('refuses a quote at a rate %s than the live one', async (_label, quoted) => {
      await expect(submit(quoted)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ERROR.SALE.RATE_CHANGED.code })
      })
    })

    /** Refused before anything is frozen — that is the point of checking here. */
    it.each([RATE - 1, RATE - 300])('freezes nothing at a stale rate of %p', async (quoted) => {
      await submit(quoted).catch(() => undefined)

      expect(ledger.freeze).not.toHaveBeenCalled()
    })
  })

  /**
   * **What the seller asked for: "if I type 10 USDT, it is 10 USDT".** A typed
   * amount arrives as the stake, to the cent, beside its price rounded to the
   * nearest hryvnia, and is frozen exactly as sent. Deriving it from the total
   * instead — as every sale was priced before — sold a different amount from
   * the one typed more often than not.
   */
  describe('a stake sent with its price', () => {
    const submit = (stakeCents: number, fiatAmount: number, quotedRate = RATE) =>
      facade.createSale(TELEGRAM_ID, {
        fiatAmount,
        stakeCents,
        bankType: 'PRIVAT' as never,
        dropLink: PRIVAT_LINK,
        cardNumber: DROP_CARD,
        quotedRate
      })

    it('freezes exactly the stake sent', async () => {
      // Ten USDT at ₴47.46 is ₴474.60, so ₴475 — which priced back the old way
      // is 10.01 USDT, not the ten typed.
      const { targetKopecks } = priceStake(1_000, RATE)
      expect(priceSale(targetKopecks, RATE).requiredUsdtCents).not.toBe(1_000)

      await submit(1_000, targetKopecks).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalledWith(TELEGRAM_ID, 1_000)
      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({ frozenUsdt: 1_000, fiatAmount: targetKopecks, exchangeRate: RATE })
      )
    })

    /** The other direction, a jar's goal and what it costs, passes the same rule. */
    it('accepts the stake a jar’s goal costs', async () => {
      const goal = priceSale(100_000, RATE)

      await submit(goal.requiredUsdtCents, goal.targetKopecks).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalledWith(TELEGRAM_ID, goal.requiredUsdtCents)
    })

    /**
     * A pair `priceStake` could not have produced is refused, not repriced: the
     * total is what a jar owner was told to type, and substituting another in
     * silence is the thing this whole path exists to stop.
     */
    it.each([
      ['a hryvnia over', 100],
      ['a hryvnia under', -100]
    ])('refuses a total %s the stake’s price', async (_label, offset) => {
      const { targetKopecks } = priceStake(1_000, RATE)

      await expect(submit(1_000, targetKopecks + offset)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ERROR.SALE.QUOTE_MISMATCH.code })
      })
      expect(ledger.freeze).not.toHaveBeenCalled()
    })

    /** A race with the market is reported as one, not as a mismatch it causes. */
    it('reports a stale rate as a moved rate', async () => {
      const { targetKopecks } = priceStake(1_000, RATE + 1)

      await expect(submit(1_000, targetKopecks, RATE + 1)).rejects.toMatchObject({
        response: expect.objectContaining({ code: ERROR.SALE.RATE_CHANGED.code })
      })
    })

    /** A client that predates the field keeps getting exactly what it always got. */
    it('derives the stake from the total when none is sent', async () => {
      await facade
        .createSale(TELEGRAM_ID, {
          fiatAmount: 100_000,
          bankType: 'PRIVAT' as never,
          dropLink: PRIVAT_LINK,
          cardNumber: DROP_CARD,
          quotedRate: RATE
        })
        .catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalledWith(
        TELEGRAM_ID,
        priceSale(100_000, RATE).requiredUsdtCents
      )
    })

    /** The balance check is on the stake as sent — a whole balance is sellable. */
    it('sells a whole balance that is not whole USDT', async () => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_002,
        frozenBalance: 0,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman'
      })

      await submit(1_002, priceStake(1_002, RATE).targetKopecks).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalledWith(TELEGRAM_ID, 1_002)
    })
  })

  describe('the jar target at creation', () => {
    const withGoal = (goal: number | null) => {
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal,
        cardNumber: DROP_CARD,
        ownerName: null,
      })
    }

    /** 100 USDT at the stubbed rate — whatever it comes to. */
    const create = (fiatAmount: number) =>
      facade.createSale(TELEGRAM_ID, { fiatAmount: fiatAmount, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE })

    it.each([
      ['a hryvnia high', 100_100],
      ['a hryvnia low', 99_900],
      ['exact', 100_000],
    ])('accepts a jar target that is %s', async (_label, goal) => {
      withGoal(goal)

      await create(100_000).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalled()
    })

    /**
     * The allowance is a percent of the order with a hryvnia as its floor, so
     * on a ₴1 000 target ₴2 is a rounding and ₴20 is a different jar. The same
     * rule the compliance check applies while the order runs — one function,
     * both ends.
     */
    it('accepts a jar target two hryvnia out on a thousand-hryvnia order', async () => {
      withGoal(100_200)

      await create(100_000).catch(() => undefined)

      expect(ledger.freeze).toHaveBeenCalled()
    })

    it('still refuses a jar target well past one percent', async () => {
      withGoal(102_500)

      await expect(create(100_000)).rejects.toBeInstanceOf(BadRequestException)
      expect(ledger.freeze).not.toHaveBeenCalled()
    })
  })

  describe('the card the order pays into', () => {
    const ENVELOPE_CARD = '5168750000003407'

    beforeEach(() => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover: 0,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman',
      })
      ledger.freeze.mockResolvedValue({ balance: 900_000, frozenBalance: 100_000 })
      db.create.mockResolvedValue({ _id: { toString: () => 'order-2' }, publicId: 'AAAA1111' })
    })


    const withDropCard = (cardNumber: string | null) => {
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber,
        ownerName: 'Петренко І.',
      })
    }

    const create = (typedCard: string, bank = 'PRIVAT') =>
      facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: bank as never, dropLink: PRIVAT_LINK, cardNumber: typedCard, quotedRate: RATE })

    /**
     * The bank's answer *is* the account, not something a typed number is
     * compared against. Comparing and then using the client's value would leave
     * the account resting on the comparison; this leaves it resting on the bank.
     */
    it('pays into the card the bank named, not the one submitted', async () => {
      withDropCard(ENVELOPE_CARD)

      await create('4874100000003205')

      expect(transacto.createCredential).toHaveBeenCalledWith(
        't',
        expect.objectContaining({ cred: ENVELOPE_CARD }),
      )
    })

    /**
     * The form no longer lets this field be edited for such a bank, so a
     * difference means a stale or tampered client — which changes nothing,
     * because the submitted value was never going to be used.
     */
    it('creates the order anyway when the submitted card differs', async () => {
      withDropCard(ENVELOPE_CARD)

      await expect(create('4874100000003205')).resolves.toBeDefined()
    })

    it('pays into it whatever spacing the client used', async () => {
      withDropCard(ENVELOPE_CARD)

      await create('5168 7500 0000 3407')

      expect(transacto.createCredential).toHaveBeenCalledWith(
        't',
        expect.objectContaining({ cred: ENVELOPE_CARD }),
      )
    })

    /**
     * PrivatBank is supposed to name the card, so a link where it did not is a
     * link we cannot verify. There is nothing to fall back to: accepting the
     * typed number would put an unverified account into the system through the
     * one route built to make that impossible.
     */
    it('refuses a disclosing bank that named no card', async () => {
      withDropCard(null)

      await expect(create('4874100000003205')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('freezes nothing when the bank named no card', async () => {
      withDropCard(null)

      await create('4874100000003205').catch(() => undefined)

      expect(ledger.freeze).not.toHaveBeenCalled()
    })

    it('records that the bank verified the card', async () => {
      withDropCard(ENVELOPE_CARD)

      await create(ENVELOPE_CARD)

      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({ cardVerifiedByBank: true }),
      )
    })
  })

  /**
   * Creation only. Orders already running on a bank that is switched off keep
   * being scraped and settled — switching one off must never strand money that
   * is already in flight.
   */
  describe('banks that are switched off', () => {
    beforeEach(() => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover: 0,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman',
      })
      ledger.freeze.mockResolvedValue({ balance: 900_000, frozenBalance: 100_000 })
      db.create.mockResolvedValue({ _id: { toString: () => 'order-2' }, publicId: 'AAAA1111' })
    })

    const createOn = (bank: string) =>
      facade.createSale(TELEGRAM_ID, { fiatAmount: 100_000, bankType: bank as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE })

    it('refuses a new order on MONO', async () => {
      await expect(createOn('MONO')).rejects.toBeInstanceOf(BadRequestException)
    })

    /** Refused before the link is even resolved, let alone anything frozen. */
    it('touches nothing at all for MONO', async () => {
      await createOn('MONO').catch(() => undefined)

      expect(dropLinks.resolve).not.toHaveBeenCalled()
      expect(ledger.freeze).not.toHaveBeenCalled()
      expect(db.create).not.toHaveBeenCalled()
    })

    /**
     * PUMB is back on. It was switched off because a wrong card could not be
     * caught until three orders had expired against it — and its moneybox
     * record publishes the card masked, which closes exactly that hole.
     */
    it('accepts PUMB again', async () => {
      await expect(createOn('PUMB')).resolves.toBeDefined()
    })

    /**
     * The safeguard that earned PUMB its place back. A mask cannot be paid
     * into, so the card stays the user's — but one disagreeing with the digits
     * PUMB does publish cannot be the right card, and is refused here rather
     * than three expired orders later with the stake frozen throughout.
     */
    it('refuses a PUMB card that cannot be behind the published mask', async () => {
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: null,
        cardNumberMask: '53552800****0000',
        ownerName: 'Іван П.',
      })

      await expect(createOn('PUMB')).rejects.toMatchObject({
        response: ERROR.SALE.CARD_MASK_MISMATCH,
      })
      expect(ledger.freeze).not.toHaveBeenCalled()
    })

    /**
     * And accepts the one that fits — as the *user's* card, not the bank's.
     * `cardVerifiedByBank: false` is the whole distinction from PrivatBank: a
     * mask is not an account, so the order still rests on what was typed, and
     * the dead-order fraud rule that guards exactly that stays on.
     */
    it('accepts a PUMB card that fits the mask, as the user’s own card', async () => {
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: null,
        cardNumberMask: `${DROP_CARD.slice(0, 8)}****${DROP_CARD.slice(-4)}`,
        ownerName: 'Іван П.',
      })

      await expect(createOn('PUMB')).resolves.toBeDefined()
      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bankType: 'PUMB',
          cardVerifiedByBank: false,
          // PUMB names its owner now, so the terminal a payer sees carries a
          // real receiver rather than a fallback.
          receiverName: 'Іван П.'
        })
      )
    })

    it('still accepts PrivatBank', async () => {
      await expect(createOn('PRIVAT')).resolves.toBeDefined()
    })
  })

  /**
   * **What a tail may be ended with, and who decides.**
   *
   * `isRemainderPolicyAvailable` is one function in the contract, read both by
   * the create form — which greys the row out — and here. The two would drift
   * the moment either kept its own list, and the shape that drift takes is a
   * picker offering an ending this refuses, which reads to a user as the app
   * being broken rather than as a choice not being available.
   */
  describe('the ending chosen for a tail', () => {
    beforeEach(() => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover: 0,
        firstName: 'Роман',
        lastName: 'Петренко',
        username: 'roman'
      })
      ledger.freeze.mockResolvedValue({ balance: 900_000, frozenBalance: 100_000 })
      db.create.mockResolvedValue({ _id: { toString: () => 'order-3' }, publicId: 'BBBB2222' })
    })

    const createWith = (remainderPolicy?: SaleRemainderPolicy) =>
      facade.createSale(TELEGRAM_ID, {
        fiatAmount: 100_000,
        bankType: 'PRIVAT' as never,
        dropLink: PRIVAT_LINK,
        cardNumber: DROP_CARD,
        quotedRate: RATE,
        remainderPolicy
      })

    /**
     * Nothing watches a seller's jar-less card, so waiting for a tail to be paid
     * in by hand is an ending only a card sale can be given. A jar sale asking
     * for it is a client old enough to still offer the row.
     */
    it('refuses a jar sale that asks to wait for the tail', async () => {
      await expect(createWith(SaleRemainderPolicy.WAIT_FOR_TOP_UP)).rejects.toMatchObject({
        response: ERROR.SALE.REMAINDER_POLICY_UNAVAILABLE
      })
    })

    /** Refused before a single cent is frozen. */
    it('freezes nothing when the ending is refused', async () => {
      await createWith(SaleRemainderPolicy.WAIT_FOR_TOP_UP).catch(() => undefined)

      expect(ledger.freeze).not.toHaveBeenCalled()
      expect(db.create).not.toHaveBeenCalled()
    })

    it('takes the ending every method can give', async () => {
      await createWith(SaleRemainderPolicy.REFUND_TO_BALANCE)

      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({ remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE })
      )
    })

    /**
     * **A named nothing is no longer read as "wait".** The old fallback was
     * `WAIT_FOR_TOP_UP` for every method — the behaviour from before the choice
     * existed. It cannot be that any more: on a jar it is the one ending this
     * service refuses, so defaulting to it would refuse every client that names
     * no policy at all.
     */
    it('reads an unstated ending as the recommended one', async () => {
      await createWith(undefined)

      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({ remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE })
      )
    })
  })

  describe('the minimum order', () => {
    beforeEach(() => {
      users.findByTelegramId.mockResolvedValue({
        balance: 1_000_000,
        frozenBalance: 0,
        totalTurnover: 0,
      })
      dropLinks.resolve.mockResolvedValue({
        link: PRIVAT_LINK,
        resolved: false,
        goal: null,
        cardNumber: DROP_CARD,
        ownerName: null,
      })
    })

    /** 9 USDT at ₴46.52 plus 2% — under the floor however it is dressed up. */
    it('refuses an order that stakes less than the minimum', async () => {
      const target = Math.round(9 * 4652 * 1.02 / 100) * 100

      await expect(
        facade.createSale(TELEGRAM_ID, { fiatAmount: target, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE }),
      ).rejects.toBeInstanceOf(BadRequestException)

      // Nothing was frozen and no order was written.
      expect(ledger.freeze).not.toHaveBeenCalled()
      expect(db.create).not.toHaveBeenCalled()
    })

    /**
     * The floor is on the stake, not the total. The total carries the profit,
     * so measuring it would admit an order staking under the minimum that
     * merely *adds up* to more.
     */
    it('measures the floor on the stake rather than the total', async () => {
      // A total just above 10 USDT-worth of hryvnia, whose funded leg is below.
      const target = Math.round(10 * 4652 / 100) * 100

      await expect(
        facade.createSale(TELEGRAM_ID, { fiatAmount: target, bankType: 'PRIVAT' as never, dropLink: PRIVAT_LINK, cardNumber: DROP_CARD, quotedRate: RATE }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(ledger.freeze).not.toHaveBeenCalled()
    })

    it('accepts an order exactly at the minimum', async () => {
      db.create.mockResolvedValue({ _id: { toString: () => 'order-2' }, publicId: 'AAAA1111' })
      const target = Math.round(10 * 4652 * 1.02 / 100) * 100

      await facade
        .createSale(TELEGRAM_ID, {
          fiatAmount: target,
          bankType: 'PRIVAT' as never,
          dropLink: PRIVAT_LINK,
          cardNumber: DROP_CARD,
          quotedRate: RATE,
        })
        .catch(() => undefined) // the Transacto leg is not stubbed; the freeze is what matters

      expect(ledger.freeze).toHaveBeenCalled()
      const [, staked] = ledger.freeze.mock.calls[0]
      expect(staked).toBeGreaterThanOrEqual(1_000)
    })
  })
})
