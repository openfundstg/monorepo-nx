import { Logger } from '@nestjs/common'
import { SaleBlockReason } from '@transacto/contracts'
import { SaleFacadeService } from './sale-facade.service'

const ORDER_ID = '6aa058a2801ec11011b1c7d2'
const TERMINAL_ID = 28558

const order = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => ORDER_ID },
  publicId: '65ULLIOG',
  telegramId: 414131219,
  transactoTerminalId: TERMINAL_ID,
  receivedAmount: 187400,
  openingJarBalance: 0,
  frozenUsdt: 5356,
  ...overrides
})

/**
 * **Two records of the same money, compared before the stake is spent.**
 *
 * `receivedAmount` sums the orders that were credited; the terminal's baseline
 * tracks what the jar was observed to hold. They are equal by construction —
 * both advance only when money is accounted for — so a disagreement means
 * something was counted twice.
 *
 * On 2026-09-08 something was. Two orders confirmed in Transacto's panel left
 * their hryvnia outside the baseline, the jar page caught up in a single jump,
 * and fuzzy matching spent that same money again on two other orders. The sale
 * closed on 2480 UAH against a jar holding 1874, committing 53.13 USDT for
 * hryvnia nobody sent — and both figures were in the same document at the
 * moment it closed. Nothing looked.
 */
describe('SaleFacadeService — the ledger check before a completion', () => {
  let saleDbService: { findById: jest.Mock; completeIfOpen: jest.Mock }
  let blockService: { block: jest.Mock }
  let redis: { get: jest.Mock }
  let service: SaleFacadeService

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    saleDbService = {
      findById: jest.fn(async () => order()),
      // Stops the run right after the check: what these specs assert is
      // whether the check let it through, not what completing does.
      completeIfOpen: jest.fn(async () => null)
    }
    blockService = { block: jest.fn(async () => true) }
    redis = { get: jest.fn(async () => '187400') }

    const unused = {} as never

    service = new SaleFacadeService(
      saleDbService as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      redis as never,
      unused,
      blockService as never
    )
  })

  afterEach(() => jest.restoreAllMocks())

  const complete = () => service.completeSale(ORDER_ID)

  describe('when the two ledgers agree', () => {
    it('lets the completion through', async () => {
      await complete()

      expect(saleDbService.completeIfOpen).toHaveBeenCalled()
      expect(blockService.block).not.toHaveBeenCalled()
    })

    /**
     * A jar holding *more* than was credited is somebody overpaying, or a
     * deposit an operator resolved without an order. Neither takes anything
     * from the user, so neither is this check's business.
     */
    it('lets a jar holding more than was credited through', async () => {
      redis.get.mockResolvedValue('250000')

      await complete()

      expect(blockService.block).not.toHaveBeenCalled()
    })

    /** The jar may not have started empty; only its growth was ever ours. */
    it('counts only the growth since the order started', async () => {
      saleDbService.findById.mockResolvedValue(
        order({ receivedAmount: 100000, openingJarBalance: 87400 })
      )

      await complete()

      expect(blockService.block).not.toHaveBeenCalled()
    })
  })

  describe('when more was credited than the jar accounts for', () => {
    beforeEach(() => {
      saleDbService.findById.mockResolvedValue(order({ receivedAmount: 248000 }))
    })

    it('does not complete', async () => {
      await expect(complete()).resolves.toBe(false)
      expect(saleDbService.completeIfOpen).not.toHaveBeenCalled()
    })

    /** Blocking rather than failing: the stake stays frozen pending review. */
    it('blocks it for an operator, naming the discrepancy', async () => {
      await complete()

      expect(blockService.block).toHaveBeenCalledWith(
        expect.objectContaining({ publicId: '65ULLIOG' }),
        SaleBlockReason.LEDGER_MISMATCH,
        60600
      )
    })

    /** The exact shape of the incident: 2480 credited against a jar of 1874. */
    it('catches the 606 UAH that started this', async () => {
      await complete()

      const [, , gap] = blockService.block.mock.calls[0]

      expect(gap).toBe(60600)
    })
  })

  describe('when the jar cannot be checked', () => {
    /**
     * Fails open, deliberately. A baseline that cannot be read is not evidence
     * of anything, and refusing every completion on a Redis restart would
     * strand users' stakes over a backstop.
     */
    it('completes anyway when there is no baseline', async () => {
      redis.get.mockResolvedValue(null)

      await complete()

      expect(blockService.block).not.toHaveBeenCalled()
      expect(saleDbService.completeIfOpen).toHaveBeenCalled()
    })

    it('completes anyway when the order has no terminal', async () => {
      saleDbService.findById.mockResolvedValue(
        order({ transactoTerminalId: null, receivedAmount: 248000 })
      )

      await complete()

      expect(blockService.block).not.toHaveBeenCalled()
    })
  })
})
