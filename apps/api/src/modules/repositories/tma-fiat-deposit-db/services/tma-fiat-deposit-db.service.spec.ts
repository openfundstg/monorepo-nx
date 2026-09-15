import {
  FIAT_DEPOSIT_HELD_STATUSES,
  TmaFiatDepositStatus
} from '@transacto/contracts'
import { TmaFiatDepositDbService } from './tma-fiat-deposit-db.service'
import type { Model } from 'mongoose'
import type { TmaFiatDepositDocument } from 'src/modules/repositories/tma-fiat-deposit-db/schemas'

const DEPOSIT_ID = '000000000000000000000001'

/**
 * The status filters, and only those.
 *
 * Everything else in this service is a plain query. What is worth pinning is
 * which statuses each write is allowed to match, because getting that wrong
 * does not fail — it matches no document, reports success to a caller that
 * cannot tell, and leaves the row where it was. That has now happened twice in
 * this collection, and both times the money was already committed upstream by
 * the time the write did nothing.
 */
describe('TmaFiatDepositDbService status guards', () => {
  let model: { findOneAndUpdate: jest.Mock; find: jest.Mock }
  let service: TmaFiatDepositDbService

  beforeEach(() => {
    model = {
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: async () => null }),
      find: jest.fn().mockReturnValue({ sort: () => ({ lean: async () => [] }) })
    }

    service = new TmaFiatDepositDbService(model as unknown as Model<TmaFiatDepositDocument>)
  })

  /**
   * **Held, not live.** `release` hands the payout back to Transacto *first*
   * and marks the row afterwards. When this guard was `LIVE` — which excludes
   * REVIEW — releasing a top-up under review gave the payout away upstream and
   * matched nothing here: the row stayed REVIEW, `findHeldPayoutIds` went on
   * counting a payout we no longer had, and that id could never be offered
   * again. The panel's RELEASE button did it every time.
   */
  describe('markReleased', () => {
    it('matches every status in which the payout is still ours', async () => {
      await service.markReleased(DEPOSIT_ID, TmaFiatDepositStatus.EXPIRED, new Date())

      const [filter] = model.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>]

      expect(filter.status).toEqual({ $in: FIAT_DEPOSIT_HELD_STATUSES })
    })

    it('accepts a top-up under review', async () => {
      await service.markReleased(DEPOSIT_ID, TmaFiatDepositStatus.EXPIRED, new Date())

      const [filter] = model.findOneAndUpdate.mock.calls[0] as [
        { status: { $in: TmaFiatDepositStatus[] } }
      ]

      expect(filter.status.$in).toContain(TmaFiatDepositStatus.REVIEW)
    })
  })

  /**
   * The other half of the same guard. REVIEW is the state whose entire purpose
   * is an operator choosing between completing and releasing, and with a `LIVE`
   * filter here the first of those two buttons matched nothing.
   *
   * It failed closed rather than open — `complete` writes here before it
   * credits — so nobody was paid twice. The cost was an operator pressing a
   * button that reported success and did nothing.
   */
  describe('markCompleted', () => {
    it('matches every status in which the payout is still ours', async () => {
      await service.markCompleted(DEPOSIT_ID, new Date())

      const [filter] = model.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>]

      expect(filter.status).toEqual({ $in: FIAT_DEPOSIT_HELD_STATUSES })
    })
  })

  /**
   * The user's slot stays taken while a review is open.
   *
   * Clearing it here freed the user to start another top-up while this one's
   * payout was still held — and one user reached two held payouts that way,
   * each on its own Transacto SLA clock.
   */
  describe('markForReview', () => {
    it('leaves the user’s slot taken', async () => {
      await service.markForReview(DEPOSIT_ID)

      const [, update] = model.findOneAndUpdate.mock.calls[0] as [unknown, { $set: Record<string, unknown> }]

      expect(update.$set).not.toHaveProperty('activeUserKey')
      expect(update.$set.status).toBe(TmaFiatDepositStatus.REVIEW)
    })
  })

  /**
   * The cap is on how long a Transacto payout may be held, and that clock
   * starts when the payout is taken — so it is measured from `createdAt`, the
   * one timestamp here that never moves. `updatedAt` shifts on every write,
   * including this sweep's own refresh of `coveredUah`.
   */
  describe('findReviewsOlderThan', () => {
    it('measures from the top-up’s own start', async () => {
      const cutoff = new Date()

      await service.findReviewsOlderThan(cutoff)

      const [filter] = model.find.mock.calls[0] as [Record<string, unknown>]

      expect(filter).toEqual({
        status: TmaFiatDepositStatus.REVIEW,
        createdAt: { $lte: cutoff }
      })
    })
  })

})
