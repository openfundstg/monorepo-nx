import { BadRequestException } from '@nestjs/common'
import { ERROR, SaleEventType, TmaSaleStatus } from '@transacto/contracts'
import { SaleReconcileService } from './sale-reconcile.service'
import type { BankScraperService } from 'src/modules/bank-scraper'
import type { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { SaleCancelService } from './sale-cancel.service'

const CARD_ID = 100
const TERMINAL_ID = 23715

const held = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'Z38SL69F',
  telegramId: 885140,
  cardId: CARD_ID,
  transactoTerminalId: TERMINAL_ID,
  status: TmaSaleStatus.COMPLETED,
  jarClosedAt: null,
  ...overrides,
})

/** What a bank answers with once the pot is gone. */
const jarClosed = () => new BadRequestException(ERROR.TERMINAL.INACTIVE)
const notServed = () => Object.assign(new Error('Request failed'), {
  isAxiosError: true,
  response: { status: 404 },
})

describe('SaleReconcileService', () => {
  let sales: { findHoldingSlots: jest.Mock; markJarClosedByCardId: jest.Mock }
  let terminals: { findOne: jest.Mock }
  let scraper: { scrape: jest.Mock }
  let cancel: { settle: jest.Mock }
  let service: SaleReconcileService

  beforeEach(() => {
    sales = {
      findHoldingSlots: jest.fn().mockResolvedValue([held()]),
      markJarClosedByCardId: jest.fn().mockResolvedValue(1),
    }
    // Retired under the old behaviour, which is the whole reported case.
    terminals = { findOne: jest.fn().mockResolvedValue({ enabled: false }) }
    scraper = { scrape: jest.fn().mockRejectedValue(jarClosed()) }
    cancel = { settle: jest.fn().mockResolvedValue(undefined) }

    service = new SaleReconcileService(
      sales as unknown as TmaSaleDbService,
      terminals as unknown as TerminalDbService,
      scraper as unknown as BankScraperService,
      cancel as unknown as SaleCancelService,
    )
  })

  /**
   * The reported bug. Two orders had been created against one jar; both ended
   * before the jar rule existed, so both terminals were already retired and
   * nothing was left to notice the jar being closed. The count read 2/1 and
   * could not come down, whatever the user did.
   */
  describe('an order whose terminal nobody is watching', () => {
    it('asks the bank itself', async () => {
      await service.reconcileHeldSlots()

      expect(scraper.scrape).toHaveBeenCalledWith(TERMINAL_ID)
    })

    it('releases the slot once the bank says the jar is closed', async () => {
      await service.reconcileHeldSlots()

      expect(sales.markJarClosedByCardId).toHaveBeenCalledWith(CARD_ID)
    })

    /** The bank no longer serving the target means the same thing. */
    it('accepts a 404 as the jar being gone', async () => {
      scraper.scrape.mockRejectedValue(notServed())

      await service.reconcileHeldSlots()

      expect(sales.markJarClosedByCardId).toHaveBeenCalled()
    })

    /**
     * The other half of the reported case. Holding a slot for a jar that is
     * genuinely still open is the rule working, not a bug — releasing it would
     * hand back the freedom the rule exists to withhold.
     */
    it('keeps holding the slot while the jar is still open', async () => {
      scraper.scrape.mockResolvedValue({ actualBalance: 1000, status: 'ACTIVE' })

      await service.reconcileHeldSlots()

      expect(sales.markJarClosedByCardId).not.toHaveBeenCalled()
      expect(cancel.settle).not.toHaveBeenCalled()
    })

    /**
     * A proxy, a timeout, a bank having a bad minute. Reading any of those as a
     * closed jar would release a slot — and refund a stake — on a blip.
     */
    it.each([
      ['a timeout', Object.assign(new Error('ETIMEDOUT'), { isAxiosError: true })],
      ['a 500', Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 500 } })],
      ['anything else', new Error('proxy exhausted')],
    ])('changes nothing on %s', async (_case, error) => {
      scraper.scrape.mockRejectedValue(error)

      await service.reconcileHeldSlots()

      expect(sales.markJarClosedByCardId).not.toHaveBeenCalled()
      expect(cancel.settle).not.toHaveBeenCalled()
    })
  })

  /**
   * A `cardId` does not identify a terminal on its own — every other path keys
   * one by `{ traderId, cardId }`, and the sale stores `traderId` for
   * exactly that reason. Reading the row by card alone could return a different
   * trader's terminal, and the `enabled` decision would then be about the wrong
   * jar entirely: probing one the loop is already on, or skipping one nobody is
   * watching.
   */
  it('looks the terminal up by the id that identifies it', async () => {
    await service.reconcileHeldSlots()

    expect(terminals.findOne).toHaveBeenCalledWith({ terminalId: TERMINAL_ID })
  })

  /** The scrape loop already has it; a second request would learn nothing new. */
  it('leaves a terminal that is still being scraped alone', async () => {
    terminals.findOne.mockResolvedValue({ enabled: true })

    await service.reconcileHeldSlots()

    expect(scraper.scrape).not.toHaveBeenCalled()
    expect(sales.markJarClosedByCardId).not.toHaveBeenCalled()
  })

  describe('an order that never got to end', () => {
    /**
     * A closed jar can receive nothing, so this order would have sat open with
     * the user's USDT frozen for good: no payment could arrive to complete it
     * and nothing existed to expire it.
     */
    it.each([
      TmaSaleStatus.CREATED,
      TmaSaleStatus.TERMINAL_READY,
      TmaSaleStatus.AWAITING_FIAT,
      TmaSaleStatus.CLOSING,
    ])('settles it and returns the stake: %s', async (status) => {
      sales.findHoldingSlots.mockResolvedValue([held({ status })])

      await service.reconcileHeldSlots()

      expect(cancel.settle).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: 'Z38SL69F' }),
        SaleEventType.JAR_CLOSED,
      )
    })

    /**
     * `JAR_CLOSED`, not `STOPPED_BY_USER`. Nobody stopped anything, and a
     * timeline saying otherwise tells the user they did something they did not.
     */
    it('does not claim the user stopped it', async () => {
      sales.findHoldingSlots.mockResolvedValue([
        held({ status: TmaSaleStatus.AWAITING_FIAT }),
      ])

      await service.reconcileHeldSlots()

      expect(cancel.settle.mock.calls[0][1]).not.toBe(SaleEventType.STOPPED_BY_USER)
    })

    /** An order that already ended has nothing left to move. */
    it.each([TmaSaleStatus.COMPLETED, TmaSaleStatus.CANCELLED])(
      'moves no money for one that is already %s',
      async (status) => {
        sales.findHoldingSlots.mockResolvedValue([held({ status })])

        await service.reconcileHeldSlots()

        expect(cancel.settle).not.toHaveBeenCalled()
        expect(sales.markJarClosedByCardId).toHaveBeenCalled()
      },
    )
  })

  describe('the sweep itself', () => {
    it('skips an order that never got a terminal', async () => {
      sales.findHoldingSlots.mockResolvedValue([
        held({ cardId: null, transactoTerminalId: null }),
      ])

      await service.reconcileHeldSlots()

      expect(scraper.scrape).not.toHaveBeenCalled()
    })

    it('carries on after one jar fails', async () => {
      sales.findHoldingSlots.mockResolvedValue([
        held({ publicId: 'FIRST' }),
        held({ publicId: 'SECOND' }),
      ])
      sales.markJarClosedByCardId.mockRejectedValueOnce(new Error('mongo is down'))

      await expect(service.reconcileHeldSlots()).resolves.toBeUndefined()

      expect(scraper.scrape).toHaveBeenCalledTimes(2)
    })

    it('survives its own query failing', async () => {
      sales.findHoldingSlots.mockRejectedValue(new Error('mongo is down'))

      await expect(service.reconcileHeldSlots()).resolves.toBeUndefined()
    })

    it('runs one pass at a time', async () => {
      let release: () => void = () => undefined
      sales.findHoldingSlots.mockImplementation(
        () => new Promise((resolve) => { release = () => resolve([]) }),
      )

      const first = service.reconcileHeldSlots()
      await service.reconcileHeldSlots()

      expect(sales.findHoldingSlots).toHaveBeenCalledTimes(1)

      release()
      await first
    })
  })
})
