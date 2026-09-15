import { Logger } from '@nestjs/common'
import { TmaFiatDepositStatus, TmaFiatReceiptRejection } from '@transacto/contracts'
import { FiatDepositReconcileService } from './fiat-deposit-reconcile.service'
import { TransactoPayoutStatus } from 'src/shared/interfaces/transacto-panel.interface'
import { panelCheckRow, panelPayoutRow } from 'src/modules/transacto/testing'
import {
  fiatDepositRecord,
  fiatReceiptRecord,
  TEST_PAYOUT_ID
} from 'src/modules/telegram-mini-app/testing'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import type { FiatDepositReceiptService } from './fiat-deposit-receipt.service'
import type { FiatDepositSettlementService } from './fiat-deposit-settlement.service'
import type { EventEmitter2 } from '@nestjs/event-emitter'
import type Redis from 'ioredis'

const MINUTE_MS = 60 * 1000
const HOUR_AGO = new Date(Date.now() - 60 * MINUTE_MS)

/** Past the ninety-minute cap, so the empty ones are due to be given back. */
const TWO_HOURS_AGO = new Date(Date.now() - 120 * MINUTE_MS)

/** Past the thirty-minute alert but inside the cap — held, and announced. */
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * MINUTE_MS)

/** Everything here has already run out of time; the sweep is what is under test. */
const overdue = (overrides = {}) =>
  fiatDepositRecord({ payDeadlineAt: HOUR_AGO, holdUntilAt: HOUR_AGO, createdAt: HOUR_AGO, ...overrides })

const historyRow = (status: TransactoPayoutStatus) => panelPayoutRow({ status })

describe('FiatDepositReconcileService', () => {
  let db: {
    findHeld: jest.Mock
    findDueForRelease: jest.Mock
    findReviewsOlderThan: jest.Mock
    setCoveredFromUpstream: jest.Mock
    markReceiptRejected: jest.Mock
  }
  let panelPayouts: {
    getPayoutHistory: jest.Mock
    getCheckParseStatus: jest.Mock
    getChecks: jest.Mock
  }
  /**
   * Completing, releasing and reviewing belong to the settlement service and
   * are tested there. What this file owns is the *decision* — which of the
   * three a top-up gets, and when — so those three are doubles here.
   */
  let settlement: { complete: jest.Mock; release: jest.Mock; review: jest.Mock }
  let settle: jest.Mock
  /** Announcing a stuck top-up belongs to the support module; here it is a double. */
  let eventEmitter: { emit: jest.Mock }
  /** The five-minute throttle. `'OK'` is Redis saying "you are the one to speak". */
  let redis: { set: jest.Mock }
  let service: FiatDepositReconcileService

  beforeEach(() => {
    db = {
      // One read serves the whole tick: held is live plus the reviews, and the
      // service narrows it with `isFiatDepositPayable` rather than asking twice.
      findHeld: jest.fn().mockResolvedValue([]),
      findDueForRelease: jest.fn().mockResolvedValue([]),
      findReviewsOlderThan: jest.fn().mockResolvedValue([]),
      setCoveredFromUpstream: jest.fn().mockResolvedValue(null),
      markReceiptRejected: jest.fn().mockResolvedValue(fiatDepositRecord())
    }
    panelPayouts = {
      getPayoutHistory: jest.fn().mockResolvedValue({ rows: [], unreadable: 0 }),
      getCheckParseStatus: jest.fn().mockResolvedValue({ status: 'parsing' }),
      getChecks: jest.fn().mockResolvedValue({ rows: [], unreadable: 0 })
    }
    settlement = {
      complete: jest.fn().mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.COMPLETED })),
      release: jest.fn().mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.EXPIRED })),
      review: jest.fn().mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW }))
    }
    settle = jest.fn().mockResolvedValue(undefined)
    eventEmitter = { emit: jest.fn() }
    redis = { set: jest.fn().mockResolvedValue('OK') }

    service = new FiatDepositReconcileService(
      db as unknown as TmaFiatDepositDbService,
      panelPayouts as unknown as TransactoPanelPayoutsApiService,
      { settle } as unknown as FiatDepositReceiptService,
      settlement as unknown as FiatDepositSettlementService,
      eventEmitter as unknown as EventEmitter2,
      redis as unknown as Redis
    )
  })

  /** Most of the night there is nothing running; it should cost nothing. */
  it('does not talk to the panel when nothing is held', async () => {
    await service.reconcile()

    expect(panelPayouts.getPayoutHistory).not.toHaveBeenCalled()
  })

  describe('what Transacto’s history decides', () => {
    beforeEach(() => {
      db.findHeld.mockResolvedValue([fiatDepositRecord()])
      panelPayouts.getPayoutHistory.mockResolvedValue({
        rows: [historyRow(TransactoPayoutStatus.COMPLETED)],
        unreadable: 0
      })
    })

    /** A top-up settles on their word, never on our arithmetic. */
    it('completes a top-up whose payout they report executed', async () => {
      await service.reconcile()

      expect(settlement.complete).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: TEST_PAYOUT_ID })
      )
    })

    /**
     * Refused upstream while we hold receipts against it: nobody can be
     * credited and nothing can be released, so a person has to look.
     */
    it('sends a refused payout to an operator, and neither pays nor releases it', async () => {
      panelPayouts.getPayoutHistory.mockResolvedValue({
        rows: [historyRow(TransactoPayoutStatus.FAILED)],
        unreadable: 0
      })

      await service.reconcile()

      expect(settlement.review).toHaveBeenCalled()
      expect(settlement.complete).not.toHaveBeenCalled()
      expect(settlement.release).not.toHaveBeenCalled()
    })

    it('leaves a payout still in flight alone', async () => {
      panelPayouts.getPayoutHistory.mockResolvedValue({ rows: [], unreadable: 0 })

      await service.reconcile()

      expect(settlement.complete).not.toHaveBeenCalled()
      expect(settlement.review).not.toHaveBeenCalled()
    })

    /**
     * The case this pass was widened for, and it is not hypothetical.
     *
     * Our own verification refused a genuine receipt, the top-up went to an
     * operator, and the user took the same receipt to support — who checked it
     * themselves and uploaded it through Transacto's panel. The payout was paid
     * and closed upstream while our row still said REVIEW, and nothing looked:
     * the user was credited three hours later, by a person pressing a button.
     */
    it('credits a review whose payout was settled in the panel', async () => {
      const underReview = fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })
      db.findHeld.mockResolvedValue([underReview])

      await service.reconcile()

      expect(settlement.complete).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: TEST_PAYOUT_ID })
      )
    })

    /** …and the panel is read for it, with nothing live to trigger the pass. */
    it('reads the history with nothing live, so long as something is held', async () => {
      db.findHeld.mockResolvedValue([fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })])

      await service.reconcile()

      expect(panelPayouts.getPayoutHistory).toHaveBeenCalled()
    })

    /**
     * Ordering, and it is the thing that keeps the two review passes from
     * disagreeing. Both re-query Mongo, so a row this pass has just completed
     * is no longer a review by the time the release sweep looks for one — but
     * only because this runs first. Reverse them and a payout Transacto had
     * already executed could be handed back to the book.
     */
    it('settles before either pass can consider giving the payout back', async () => {
      db.findHeld.mockResolvedValue([fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })])
      db.findReviewsOlderThan.mockResolvedValue([fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })])

      await service.reconcile()

      expect(settlement.complete.mock.invocationCallOrder[0]).toBeLessThan(
        panelPayouts.getChecks.mock.invocationCallOrder[0]
      )
    })

    /**
     * A review is already where a refusal sends a top-up, and this pass sees the
     * same refusal every thirty seconds for as long as one is held.
     *
     * The escalation is therefore reported on the *transition*, which is what
     * `review` answering with a row means — `markForReview` is guarded on the
     * live statuses, so a top-up already under review matches nothing and the
     * answer is `null`. The double says so, because a double that always
     * returned a row would be modelling a write that cannot happen.
     */
    it('escalates a refused payout once, not once a pass', async () => {
      settlement.review.mockResolvedValue(null)
      db.findHeld.mockResolvedValue([fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW })])
      panelPayouts.getPayoutHistory.mockResolvedValue({
        rows: [historyRow(TransactoPayoutStatus.FAILED)],
        unreadable: 0
      })

      const escalated = jest.spyOn(Logger.prototype, 'error').mockImplementation()

      try {
        await service.reconcile()

        expect(escalated).not.toHaveBeenCalled()
        expect(settlement.complete).not.toHaveBeenCalled()
      } finally {
        escalated.mockRestore()
      }
    })
  })

  describe('holds that ran out', () => {
    it('gives back a payout nobody paid into', async () => {
      db.findHeld.mockResolvedValue([overdue()])
      db.findDueForRelease.mockResolvedValue([overdue()])

      await service.reconcile()

      expect(settlement.release).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: TEST_PAYOUT_ID }),
        TmaFiatDepositStatus.EXPIRED
      )
    })

    /**
     * The rule with somebody's money behind it: a payout that has been paid
     * into is never handed to another trader, however long the clock has run.
     */
    it('refuses to give back one that has money in it, and calls for a person', async () => {
      const partial = overdue({ coveredUah: 30_000, status: TmaFiatDepositStatus.PARTIALLY_PAID })
      db.findHeld.mockResolvedValue([partial])
      db.findDueForRelease.mockResolvedValue([partial])

      await service.reconcile()

      expect(settlement.release).not.toHaveBeenCalled()
      expect(settlement.review).toHaveBeenCalledWith(
        expect.objectContaining({ coveredUah: 30_000 })
      )
    })

    /** A receipt still being recognised may yet cover it; the next pass decides. */
    it('waits while a receipt is still being recognised', async () => {
      const parsing = overdue({ receipts: [fiatReceiptRecord({ uploadedAt: HOUR_AGO })] })
      db.findHeld.mockResolvedValue([parsing])
      db.findDueForRelease.mockResolvedValue([parsing])
      panelPayouts.getCheckParseStatus.mockResolvedValue({ status: 'parsing' })

      await service.reconcile()

      expect(settlement.release).not.toHaveBeenCalled()
      expect(settlement.review).not.toHaveBeenCalled()
    })
  })

  describe('receipts nobody waited for', () => {
    it('collects a verdict that arrived after the request had gone', async () => {
      const pending = fiatDepositRecord({ receipts: [fiatReceiptRecord({ uploadedAt: HOUR_AGO })] as never })
      db.findHeld.mockResolvedValue([pending])
      panelPayouts.getCheckParseStatus.mockResolvedValue({ status: 'preview' })

      await service.reconcile()

      expect(settle).toHaveBeenCalledWith(pending, expect.anything(), { status: 'preview' })
    })

    /** No job id means the upload itself failed — there is nothing to poll. */
    it('closes a receipt that never reached recognition', async () => {
      db.findHeld.mockResolvedValue([fiatDepositRecord({ receipts: [fiatReceiptRecord({ uploadedAt: HOUR_AGO, upstreamJobId: null })] as never })])

      await service.reconcile()

      expect(db.markReceiptRejected).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        TmaFiatReceiptRejection.PARSE_FAILED
      )
      expect(panelPayouts.getCheckParseStatus).not.toHaveBeenCalled()
    })

    /**
     * A receipt wedged in PARSING blocks the user's next upload, which is the
     * real harm once recognition is clearly not coming back.
     */
    it('gives up on recognition that never finished, freeing the slot', async () => {
      db.findHeld.mockResolvedValue([fiatDepositRecord({ receipts: [fiatReceiptRecord({ uploadedAt: HOUR_AGO })] as never })])

      await service.reconcile()

      expect(db.markReceiptRejected).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        TmaFiatReceiptRejection.TIMED_OUT
      )
    })

    /** A young receipt belongs to a request that is probably still waiting on it. */
    it('leaves a receipt uploaded a moment ago alone', async () => {
      db.findHeld.mockResolvedValue([
        fiatDepositRecord({ receipts: [fiatReceiptRecord()] as never })
      ])

      await service.reconcile()

      expect(panelPayouts.getCheckParseStatus).not.toHaveBeenCalled()
      expect(db.markReceiptRejected).not.toHaveBeenCalled()
    })
  })

  /**
   * A top-up under review sat outside every pass here, so its payout stayed
   * ours until a person noticed. One was held seventeen hours; Transacto fines
   * the delay and raised a critical SLA breach on it.
   *
   * The rule is unchanged — a payout with money in it is never given back — but
   * it is now applied to a fresh answer from the panel instead of a tally that
   * stopped being maintained the moment the row was flagged.
   */
  describe('reviews nobody has paid into', () => {
    const underReview = (createdAt = TWO_HOURS_AGO) =>
      overdue({ status: TmaFiatDepositStatus.REVIEW, coveredUah: 0, createdAt })

    it('gives the payout back when the panel reports nothing paid in', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])

      await service.reconcile()

      expect(settlement.release).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: TEST_PAYOUT_ID }),
        TmaFiatDepositStatus.EXPIRED
      )
    })

    /**
     * The whole point of asking again. A transfer that landed after the review
     * began appears in the panel's checks table and never in our own tally, and
     * releasing on the tally would hand away money somebody actually sent.
     */
    it('keeps holding when the panel reports money against the payout', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])
      panelPayouts.getChecks.mockResolvedValue({
        rows: [panelCheckRow({ payout_id: TEST_PAYOUT_ID, amount: '700.00' })],
        unreadable: 0
      })

      await service.reconcile()

      expect(settlement.release).not.toHaveBeenCalled()
      // …and the operator stops seeing a stale zero.
      expect(db.setCoveredFromUpstream).toHaveBeenCalledWith(expect.any(String), 70_000)
    })

    it('sums every receipt attached to the same payout', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])
      panelPayouts.getChecks.mockResolvedValue({
        rows: [
          panelCheckRow({ payout_id: TEST_PAYOUT_ID, amount: '300.00' }),
          panelCheckRow({ payout_id: TEST_PAYOUT_ID, amount: '400.00' })
        ],
        unreadable: 0
      })

      await service.reconcile()

      expect(db.setCoveredFromUpstream).toHaveBeenCalledWith(expect.any(String), 70_000)
      expect(settlement.release).not.toHaveBeenCalled()
    })

    /** Another payout's receipts say nothing about this one. */
    it('ignores receipts belonging to a different payout', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])
      panelPayouts.getChecks.mockResolvedValue({
        rows: [panelCheckRow({ payout_id: TEST_PAYOUT_ID + 1, amount: '700.00' })],
        unreadable: 0
      })

      await service.reconcile()

      expect(settlement.release).toHaveBeenCalled()
    })

    /**
     * An unreadable table and an empty one look identical here, and the
     * difference is somebody's money. `panel-table.util` counts what it could
     * not parse precisely so this decision can refuse to be made.
     */
    it('releases nothing when the checks table would not parse', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])
      panelPayouts.getChecks.mockResolvedValue({ rows: [], unreadable: 3 })

      await service.reconcile()

      expect(settlement.release).not.toHaveBeenCalled()
    })

    /**
     * The user's slot is freed by the release, not by the review. Until then a
     * review holds it like any other unfinished top-up — which is what stops
     * one person accumulating held payouts.
     */
    it('frees the user by closing the top-up, not by flagging it', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview()])

      await service.reconcile()

      // `markReleased` is what clears both locks; the sweep reaches it only
      // through the settlement service, which is where that is tested.
      expect(settlement.release).toHaveBeenCalledWith(
        expect.anything(),
        TmaFiatDepositStatus.EXPIRED
      )
    })

    /** Ninety minutes is the cap, so an hour into it nothing is given back yet. */
    it('leaves an empty review alone before the cap', async () => {
      db.findReviewsOlderThan.mockResolvedValue([underReview(FORTY_MINUTES_AGO)])

      await service.reconcile()

      expect(settlement.release).not.toHaveBeenCalled()
    })

    /**
     * The case with no automatic ending. Handing back a payout somebody has
     * transferred to gives a stranger their money, so the cap does not apply —
     * what applies instead is that an operator is told, and told again.
     */
    describe('when money is already in the payout', () => {
      const paidInto = (createdAt = FORTY_MINUTES_AGO) =>
        overdue({ status: TmaFiatDepositStatus.REVIEW, coveredUah: 0, createdAt })

      const withMoney = () =>
        panelPayouts.getChecks.mockResolvedValue({
          rows: [panelCheckRow({ payout_id: TEST_PAYOUT_ID, amount: '700.00' })],
          unreadable: 0
        })

      it('never releases it, however long it has been held', async () => {
        db.findReviewsOlderThan.mockResolvedValue([paidInto(TWO_HOURS_AGO)])
        withMoney()

        await service.reconcile()

        expect(settlement.release).not.toHaveBeenCalled()
      })

      it('tells an operator, with the figures they need', async () => {
        db.findReviewsOlderThan.mockResolvedValue([paidInto()])
        withMoney()

        await service.reconcile()

        expect(eventEmitter.emit).toHaveBeenCalledWith(
          'tma.fiat_deposit_stuck',
          expect.objectContaining({ payoutId: TEST_PAYOUT_ID, coveredUah: 70_000 })
        )
      })

      /**
       * The reconciler runs every thirty seconds. Without the throttle the
       * group would get the same sentence twice a minute, which is how a
       * channel stops being read.
       */
      it('says nothing when it has spoken recently', async () => {
        db.findReviewsOlderThan.mockResolvedValue([paidInto()])
        withMoney()
        redis.set.mockResolvedValue(null)

        await service.reconcile()

        expect(eventEmitter.emit).not.toHaveBeenCalled()
        // …but the figure is still brought up to date on the record.
        expect(db.setCoveredFromUpstream).toHaveBeenCalled()
      })

      /** A Redis outage loses an alert rather than sending a flood of them. */
      it('says nothing when the throttle cannot be taken', async () => {
        db.findReviewsOlderThan.mockResolvedValue([paidInto()])
        withMoney()
        redis.set.mockRejectedValue(new Error('redis is down'))

        await service.reconcile()

        expect(eventEmitter.emit).not.toHaveBeenCalled()
      })
    })

    /** The panel is not asked at all when there is nothing due. */
    it('does not touch the panel when no review has run out', async () => {
      await service.reconcile()

      expect(panelPayouts.getChecks).not.toHaveBeenCalled()
    })

    /**
     * A review is by definition not live, so gating this pass on a live top-up
     * would gate it on the state it exists to clean up — which is how the
     * seventeen-hour hold happened at all.
     */
    it('runs even when no top-up is live', async () => {
      db.findHeld.mockResolvedValue([])
      db.findReviewsOlderThan.mockResolvedValue([underReview()])

      await service.reconcile()

      expect(settlement.release).toHaveBeenCalled()
    })
  })
})
