import { BalanceEntryKind, TmaFiatDepositStatus } from '@transacto/contracts'
import { FiatDepositSettlementService } from './fiat-deposit-settlement.service'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import type { BalanceLedgerService } from './balance-ledger.service'
import type { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import {
  fiatDepositRecord,
  TEST_CRYPTO_CENTS,
  TEST_PAYOUT_ID,
  TEST_TELEGRAM_ID
} from 'src/modules/telegram-mini-app/testing'


describe('FiatDepositSettlementService', () => {
  let db: { markCompleted: jest.Mock; markReleased: jest.Mock; markForReview: jest.Mock }
  let credit: jest.Mock
  let releasePayout: jest.Mock
  let emitBalanceUpdated: jest.Mock
  let emitFiatDepositStatusChange: jest.Mock
  let service: FiatDepositSettlementService

  beforeEach(() => {
    db = {
      markCompleted: jest
        .fn()
        .mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.COMPLETED })),
      markReleased: jest.fn().mockImplementation(async (_id, status) => fiatDepositRecord({ status })),
      markForReview: jest.fn().mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW }))
    }
    credit = jest.fn().mockResolvedValue(5000)
    releasePayout = jest.fn().mockResolvedValue({ status: 'ok' })
    emitBalanceUpdated = jest.fn()
    emitFiatDepositStatusChange = jest.fn()

    service = new FiatDepositSettlementService(
      db as unknown as TmaFiatDepositDbService,
      { releasePayout } as unknown as TransactoPanelPayoutsApiService,
      { emitBalanceUpdated, emitFiatDepositStatusChange } as unknown as TmaGateway,
      { credit } as unknown as BalanceLedgerService
    )
  })

  describe('completing', () => {
    it('credits the USDT frozen at reservation and tells the user', async () => {
      await service.complete(fiatDepositRecord())

      // Through the book, and once per top-up: the entry names the top-up it
      // came from, so a second pass over the same completed payout adds no
      // second line to the user's timeline.
      expect(credit).toHaveBeenCalledWith(
        TEST_TELEGRAM_ID,
        TEST_CRYPTO_CENTS,
        expect.objectContaining({ kind: BalanceEntryKind.FIAT_DEPOSIT, once: true })
      )
      expect(emitBalanceUpdated).toHaveBeenCalledWith(TEST_TELEGRAM_ID, 5000)
      expect(emitFiatDepositStatusChange).toHaveBeenCalledWith(
        TEST_TELEGRAM_ID,
        expect.objectContaining({ status: TmaFiatDepositStatus.COMPLETED })
      )
    })

    /**
     * The guard against paying twice for one transfer. The write is conditional
     * on the row still being live, and the credit hangs off whether it applied —
     * two callers seeing the same completed payout is entirely ordinary.
     */
    it('pays nobody when the top-up was already closed', async () => {
      db.markCompleted.mockResolvedValue(null)

      await expect(service.complete(fiatDepositRecord())).resolves.toBeNull()
      expect(credit).not.toHaveBeenCalled()
    })
  })

  describe('releasing', () => {
    it('gives the payout back before closing the row', async () => {
      const released = await service.release(fiatDepositRecord(), TmaFiatDepositStatus.CANCELLED)

      expect(releasePayout).toHaveBeenCalledWith(TEST_PAYOUT_ID)
      expect(released?.status).toBe(TmaFiatDepositStatus.CANCELLED)
    })

    /**
     * The order matters more than it looks. A row marked released while the
     * payout is still held upstream is a payout nothing is watching — the sweep
     * would not find it either, because it only looks at live rows.
     */
    it('leaves the row live when the panel will not take the payout back', async () => {
      releasePayout.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.release(fiatDepositRecord(), TmaFiatDepositStatus.EXPIRED)).resolves.toBeNull()
      expect(db.markReleased).not.toHaveBeenCalled()
    })
  })

  describe('reviewing', () => {
    /** Whatever else happens, the payout stays ours — money may already be in it. */
    it('stops the top-up without touching the payout', async () => {
      const flagged = await service.review(fiatDepositRecord({ coveredUah: 30_000 }))

      expect(releasePayout).not.toHaveBeenCalled()
      expect(flagged?.status).toBe(TmaFiatDepositStatus.REVIEW)
      expect(emitFiatDepositStatusChange).toHaveBeenCalled()
    })
  })
})
