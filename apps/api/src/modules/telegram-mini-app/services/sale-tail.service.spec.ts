import { ConflictException, NotFoundException } from '@nestjs/common'
import { ERROR, SaleEventType, SaleEvidence, SaleMethod, TmaSaleStatus } from '@transacto/contracts'
import { SaleTailService } from './sale-tail.service'
import type { SaleCardOrderService } from './sale-card-order.service'
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
  tailConfirmedAt: null,
  tailWaivedAt: null,
  ...overrides
})

/**
 * The two endings a waiting tail can have, and the seller's part in each.
 *
 * **Neither of them settles anything itself.** Both write one figure and then
 * ask `reconsiderFunding` what it means, so a tail closes through the same
 * rules as every other hryvnia here — which is what these assertions are
 * mostly about.
 */
describe('SaleTailService', () => {
  let db: Record<string, jest.Mock>
  let cardOrders: Record<string, jest.Mock>
  let service: SaleTailService

  const originalMinOrder = process.env.TRANSACTO_MIN_ORDER_KOPECKS

  beforeEach(() => {
    // ₴300, the shipped default — pinned so these tests say what they measure.
    process.env.TRANSACTO_MIN_ORDER_KOPECKS = '30000'

    db = {
      findById: jest.fn(async () => sale()),
      creditTail: jest.fn(async () => sale({ receivedAmount: 96_000, tailConfirmedAt: new Date() })),
      markTailWaived: jest.fn(async () => sale({ tailWaivedAt: new Date() })),
      appendEvent: jest.fn(async () => sale())
    }
    cardOrders = { reconsiderFunding: jest.fn(async (moved: unknown) => moved) }

    service = new SaleTailService(
      db as unknown as TmaSaleDbService,
      cardOrders as unknown as SaleCardOrderService
    )
  })

  afterEach(() => {
    if (originalMinOrder === undefined) delete process.env.TRANSACTO_MIN_ORDER_KOPECKS
    else process.env.TRANSACTO_MIN_ORDER_KOPECKS = originalMinOrder
  })

  describe('the seller says the transfer arrived', () => {
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
    it('releases it only for an announcement older than the wait', async () => {
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
     * The clock runs from the moment an operator was told, so a tail nobody has
     * been asked about has no clock running at all — which is what a seller
     * whose tail is still held for a statement of their own meets.
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
