import { ConflictException, NotFoundException } from '@nestjs/common'
import { ERROR, SaleEventType, SaleEvidence, SaleMethod, TmaSaleStatus } from '@transacto/contracts'
import { SaleTailService } from './sale-tail.service'
import type { SaleCardOrderService } from './sale-card-order.service'
import type { SaleProgressService } from './sale-progress.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TELEGRAM_ID = 885_140
const SALE_ID = '68e1f2a3b4c5d6e7f8a9b0c1'

/** ₴960 target, ₴900 in, so ₴60 left — under the ₴300 floor pinned below. */
const sale = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => SALE_ID },
  publicId: 'XT8GFXJJ',
  telegramId: TELEGRAM_ID,
  saleMethod: SaleMethod.CARD,
  status: TmaSaleStatus.AWAITING_FIAT,
  fiatAmount: 96_000,
  receivedAmount: 90_000,
  jarBalance: null,
  openingJarBalance: null,
  tailReachedAt: new Date('2026-09-21T10:00:00Z'),
  tailAnnouncedAt: new Date('2026-09-21T10:00:00Z'),
  tailClaimedAt: new Date('2026-09-21T10:00:00Z'),
  tailConfirmedAt: null,
  tailWaivedAt: null,
  ...overrides
})

/** The same sale before anybody answered its alert — what a claim arrives at. */
const unclaimed = (overrides: Record<string, unknown> = {}) =>
  sale({ tailClaimedAt: null, ...overrides })

/**
 * The three things that can happen to a waiting tail: an operator takes it on,
 * the seller says it arrived, the seller stops waiting.
 *
 * **None of them settles anything itself.** Each writes one figure and then
 * asks `reconsiderFunding` what it means, so a tail closes through the same
 * rules as every other hryvnia here — which is what these assertions are
 * mostly about.
 */
describe('SaleTailService', () => {
  let db: Record<string, jest.Mock>
  let cardOrders: Record<string, jest.Mock>
  let progress: Record<string, jest.Mock>
  let service: SaleTailService

  const originalMinOrder = process.env.TRANSACTO_MIN_ORDER_KOPECKS

  beforeEach(() => {
    // ₴300, the shipped default — pinned so these tests say what they measure.
    process.env.TRANSACTO_MIN_ORDER_KOPECKS = '30000'

    db = {
      findById: jest.fn(async () => sale()),
      creditTail: jest.fn(async () => sale({ receivedAmount: 96_000, tailConfirmedAt: new Date() })),
      markTailWaived: jest.fn(async () => sale({ tailWaivedAt: new Date() })),
      markTailClaimed: jest.fn(async () => sale({ tailClaimedAt: new Date() })),
      appendEvent: jest.fn(async () => sale())
    }
    cardOrders = { reconsiderFunding: jest.fn(async (moved: unknown) => moved) }
    progress = { emit: jest.fn(async () => undefined) }

    // Every dependency, passed. A service built with two of three compiles and
    // runs — `tsconfig.app.json` excludes specs — and the third then throws
    // inside a path a listener swallows, which is a suite that stays green
    // while the feature is broken. It has happened here before.
    service = new SaleTailService(
      db as unknown as TmaSaleDbService,
      cardOrders as unknown as SaleCardOrderService,
      progress as unknown as SaleProgressService
    )
  })

  afterEach(() => {
    if (originalMinOrder === undefined) delete process.env.TRANSACTO_MIN_ORDER_KOPECKS
    else process.env.TRANSACTO_MIN_ORDER_KOPECKS = originalMinOrder
  })

  describe('an operator takes the transfer on', () => {
    beforeEach(() => {
      db.findById.mockResolvedValue(unclaimed())
    })

    /** The gate is the filter's; this only asks for it. */
    it('stamps the sale and says it took it', async () => {
      await expect(service.claim(SALE_ID)).resolves.toBe(true)

      expect(db.markTailClaimed).toHaveBeenCalledWith(SALE_ID)
    })

    /**
     * No money moved, so there is nothing to reconsider — what changed is what
     * the screen may draw and whether the stop button exists, and that travels
     * as a snapshot.
     */
    it('pushes the seller a snapshot and settles nothing', async () => {
      await service.claim(SALE_ID)

      expect(progress.emit).toHaveBeenCalledWith(
        expect.objectContaining({ tailClaimedAt: expect.any(Date) })
      )
      expect(cardOrders.reconsiderFunding).not.toHaveBeenCalled()
    })

    /** Two operators reading the same alert. Ordinary, and said differently. */
    it('answers false when somebody already took it', async () => {
      db.findById.mockResolvedValue(sale({ tailClaimedAt: new Date('2026-09-21T11:00:00Z') }))
      db.markTailClaimed.mockResolvedValue(null)

      await expect(service.claim(SALE_ID)).resolves.toBe(false)
      expect(progress.emit).not.toHaveBeenCalled()
    })

    /**
     * The filter also refuses a sale that has closed, and that refusal has to
     * reach the chat: an operator told "accepted" would transfer hryvnia into a
     * finished order.
     */
    it('refuses a sale the filter would not take', async () => {
      // Winding down: open enough to have a tail, not open enough to take one.
      db.findById.mockResolvedValue(unclaimed({ status: TmaSaleStatus.CLOSING }))
      db.markTailClaimed.mockResolvedValue(null)

      await expect(service.claim(SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_NOT_WAITING
      })
    })

    it('refuses a sale that is no longer in its tail', async () => {
      db.findById.mockResolvedValue(unclaimed({ receivedAmount: 50_000 }))

      await expect(service.claim(SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_NOT_WAITING
      })
      expect(db.markTailClaimed).not.toHaveBeenCalled()
    })

    /** It is answered by an operator, so there is no seller to prove. */
    it('needs no owner, but still needs a sale', async () => {
      db.findById.mockResolvedValue(null)

      await expect(service.claim(SALE_ID)).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('the seller says the transfer arrived', () => {
    /**
     * Nobody has been sent to their banking app, so nothing can have landed.
     * An operator who transfers without claiming it first has skipped the step
     * that tells this seller an order exists.
     */
    it('refuses before an operator has taken it on', async () => {
      db.findById.mockResolvedValue(sale({ tailClaimedAt: null }))

      await expect(service.confirm(TELEGRAM_ID, SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_NOT_CLAIMED
      })
      expect(db.creditTail).not.toHaveBeenCalled()
    })

    it('credits the gap it read, and nothing a request could name', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID)

      expect(db.creditTail).toHaveBeenCalledWith(SALE_ID, 6_000)
    })

    /** Booked as the seller's own word, which is all a card sale ever has. */
    it('records it as the seller’s claim', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID)

      expect(db.appendEvent).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({
          type: SaleEventType.PAYMENT_MATCHED,
          amount: 6_000,
          evidence: SaleEvidence.SELLER
        })
      )
    })

    /** The settlement rules decide what the new figure means — not this. */
    it('hands the credited sale to the settlement rules', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID)

      expect(cardOrders.reconsiderFunding).toHaveBeenCalledWith(
        expect.objectContaining({ receivedAmount: 96_000 })
      )
    })

    /** Two taps, or the bot and the screen at once. Credited once. */
    it('is a no-op once somebody has already confirmed it', async () => {
      db.creditTail.mockResolvedValue(null)

      await service.confirm(TELEGRAM_ID, SALE_ID)

      expect(db.appendEvent).not.toHaveBeenCalled()
      expect(cardOrders.reconsiderFunding).not.toHaveBeenCalled()
    })

    /**
     * A jar sale's tail is seen rather than reported: the scraper reads the
     * balance, so offering a button there would credit the same hryvnia twice.
     */
    it('refuses a jar sale', async () => {
      db.findById.mockResolvedValue(sale({ saleMethod: SaleMethod.JAR }))

      await expect(service.confirm(TELEGRAM_ID, SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE_CARD.NOT_A_CARD_SALE
      })
      expect(db.creditTail).not.toHaveBeenCalled()
    })

    /**
     * Re-read on the call rather than trusted from the snapshot the screen was
     * drawn with: a payment can land in between, and then there is no tail.
     */
    it('refuses a sale that is no longer in its tail', async () => {
      db.findById.mockResolvedValue(sale({ receivedAmount: 50_000 }))

      await expect(service.confirm(TELEGRAM_ID, SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_NOT_WAITING
      })
    })

    /** The same 404 for "not yours" as for "not there". */
    it.each([
      ['a sale that does not exist', null],
      ['somebody else’s sale', sale({ telegramId: 1 })]
    ])('refuses %s', async (_, found) => {
      db.findById.mockResolvedValue(found)

      await expect(service.confirm(TELEGRAM_ID, SALE_ID)).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('the seller stops waiting', () => {
    /**
     * The whole rule travels into the filter rather than being decided here and
     * written there, so a request that raced the clock is refused by the
     * database and not by a comparison made a moment earlier.
     */
    it('releases it only once both moments are older than the wait', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-21T13:00:00Z'))
      try {
        await service.release(TELEGRAM_ID, SALE_ID)
      } finally {
        jest.useRealTimers()
      }

      expect(db.markTailWaived).toHaveBeenCalledWith(
        SALE_ID,
        new Date('2026-09-21T10:00:00Z')
      )
    })

    it('hands the released sale to the settlement rules', async () => {
      await service.release(TELEGRAM_ID, SALE_ID)

      expect(cardOrders.reconsiderFunding).toHaveBeenCalledWith(
        expect.objectContaining({ tailWaivedAt: expect.any(Date) })
      )
    })

    /** Available to a jar sale too: its seller can be left waiting just as long. */
    it('does not refuse a jar sale', async () => {
      db.findById.mockResolvedValue(sale({ saleMethod: SaleMethod.JAR }))

      await expect(service.release(TELEGRAM_ID, SALE_ID)).resolves.toBeDefined()
    })

    /**
     * The clock runs from the later of being told and being taken on, so a tail
     * nobody has been asked about has no clock running at all — which is what a
     * seller whose tail is still held for a statement of their own meets, and
     * an operator who takes one on late restarts it.
     */
    it('refuses while the wait has not run out', async () => {
      db.markTailWaived.mockResolvedValue(null)

      await expect(service.release(TELEGRAM_ID, SALE_ID)).rejects.toMatchObject({
        response: ERROR.SALE.TAIL_NOT_RELEASABLE
      })
    })

    it('is a no-op once somebody has already released it', async () => {
      db.findById.mockResolvedValue(sale({ tailWaivedAt: new Date('2026-09-21T13:00:00Z') }))
      db.markTailWaived.mockResolvedValue(null)

      await expect(service.release(TELEGRAM_ID, SALE_ID)).resolves.toBeDefined()
      expect(cardOrders.reconsiderFunding).not.toHaveBeenCalled()
    })

    it('refuses a sale that is no longer in its tail', async () => {
      db.findById.mockResolvedValue(sale({ receivedAmount: 50_000 }))

      await expect(service.release(TELEGRAM_ID, SALE_ID)).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(db.markTailWaived).not.toHaveBeenCalled()
    })
  })
})
