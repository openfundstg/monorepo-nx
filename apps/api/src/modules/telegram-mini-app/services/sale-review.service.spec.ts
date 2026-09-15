import { ConflictException } from '@nestjs/common'
import { SaleEventType, TmaSaleStatus } from '@transacto/contracts'
import { Types } from 'mongoose'
import { SaleReviewService } from './sale-review.service'
import type { SaleCancelService } from './sale-cancel.service'
import type { SaleProgressService } from './sale-progress.service'
import type { SaleTerminalService } from './sale-terminal.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'

const BLOCKED_ORDER = {
  _id: new Types.ObjectId(),
  publicId: '4W3QASK2',
  telegramId: 414131219,
  status: TmaSaleStatus.BLOCKED,
  frozenUsdt: 15_000,
  exchangeRate: 4000,
  receivedAmount: 8_700,
  cardId: 4242,
  traderId: 7
} as unknown as Parameters<SaleReviewService['resume']>[0]

describe('SaleReviewService', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const db = {
      resumeIfBlocked: jest.fn().mockResolvedValue(BLOCKED_ORDER),
      cancelIfBlocked: jest.fn().mockResolvedValue(BLOCKED_ORDER),
      appendEvent: jest.fn().mockResolvedValue(BLOCKED_ORDER),
      findById: jest.fn().mockResolvedValue(BLOCKED_ORDER),
      ...overrides
    }
    const cancel = {
      settleClosed: jest.fn().mockResolvedValue({ refunded: 12_825, consumed: 2_175 })
    }
    const terminal = { enable: jest.fn().mockResolvedValue(undefined) }
    const progress = { emit: jest.fn().mockResolvedValue(undefined) }
    const gateway = { emitSaleStatusChange: jest.fn() }

    return {
      db,
      cancel,
      terminal,
      progress,
      gateway,
      service: new SaleReviewService(
        db as unknown as TmaSaleDbService,
        cancel as unknown as SaleCancelService,
        terminal as unknown as SaleTerminalService,
        progress as unknown as SaleProgressService,
        gateway as unknown as TmaGateway
      )
    }
  }

  describe('resume', () => {
    it('flips the status before touching the terminal', async () => {
      // The flip is the idempotency gate. Bringing a terminal up first would
      // mean two operators pressing at once brought two up.
      const { db, terminal, service } = build()
      await service.resume(BLOCKED_ORDER)

      expect(db.resumeIfBlocked).toHaveBeenCalledWith(BLOCKED_ORDER._id.toString())
      expect(db.resumeIfBlocked.mock.invocationCallOrder[0]).toBeLessThan(
        terminal.enable.mock.invocationCallOrder[0]
      )
    })

    it('refuses an order that is no longer blocked', async () => {
      const { terminal, service } = build({ resumeIfBlocked: jest.fn().mockResolvedValue(null) })

      await expect(service.resume(BLOCKED_ORDER)).rejects.toBeInstanceOf(ConflictException)
      expect(terminal.enable).not.toHaveBeenCalled()
    })

    it('tells the user their order is live again', async () => {
      const { gateway, db, service } = build()
      await service.resume(BLOCKED_ORDER)

      expect(gateway.emitSaleStatusChange).toHaveBeenCalledWith(
        BLOCKED_ORDER.telegramId,
        BLOCKED_ORDER._id.toString(),
        TmaSaleStatus.AWAITING_FIAT
      )
      // Its own timeline entry, not `TERMINAL_CREATED` — the terminal was not
      // created, a person lifted a block.
      expect(db.appendEvent).toHaveBeenCalledWith(
        BLOCKED_ORDER._id.toString(),
        expect.objectContaining({ type: SaleEventType.RESUMED_BY_ADMIN })
      )
    })

    it('moves no money', async () => {
      const { cancel, service } = build()
      await service.resume(BLOCKED_ORDER)

      // The order has not ended, so the stake stays frozen.
      expect(cancel.settleClosed).not.toHaveBeenCalled()
    })
  })

  describe('release', () => {
    it('closes the order before settling it', async () => {
      const { db, cancel, service } = build()
      await service.release(BLOCKED_ORDER)

      expect(db.cancelIfBlocked).toHaveBeenCalledWith(BLOCKED_ORDER._id.toString())
      expect(db.cancelIfBlocked.mock.invocationCallOrder[0]).toBeLessThan(
        cancel.settleClosed.mock.invocationCallOrder[0]
      )
    })

    it('refuses an order that is no longer blocked, without paying anything', async () => {
      const { cancel, service } = build({ cancelIfBlocked: jest.fn().mockResolvedValue(null) })

      await expect(service.release(BLOCKED_ORDER)).rejects.toBeInstanceOf(ConflictException)
      expect(cancel.settleClosed).not.toHaveBeenCalled()
    })

    it('settles with the computed figure when no override is given', async () => {
      const { cancel, service } = build()
      await service.release(BLOCKED_ORDER)

      expect(cancel.settleClosed).toHaveBeenCalledWith(
        BLOCKED_ORDER,
        SaleEventType.RELEASED_BY_ADMIN,
        undefined
      )
    })

    it("passes the operator's own figure straight through", async () => {
      const { cancel, service } = build()
      await service.release(BLOCKED_ORDER, 15_000)

      expect(cancel.settleClosed).toHaveBeenCalledWith(
        BLOCKED_ORDER,
        SaleEventType.RELEASED_BY_ADMIN,
        15_000
      )
    })

    /**
     * Zero is a legitimate outcome — an order whose jar took the whole stake —
     * and must not be read as "no override given".
     */
    it('treats a zero refund as a figure, not as an absent one', async () => {
      const { cancel, service } = build()
      await service.release(BLOCKED_ORDER, 0)

      expect(cancel.settleClosed).toHaveBeenCalledWith(
        BLOCKED_ORDER,
        SaleEventType.RELEASED_BY_ADMIN,
        0
      )
    })
  })
})
