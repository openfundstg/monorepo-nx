import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import { ERROR, TmaFiatDepositStatus } from '@transacto/contracts'
import { FiatDepositFacadeService } from './fiat-deposit-facade.service'
import { panelPayoutRow } from 'src/modules/transacto/testing'
import {
  fiatDepositRecord,
  TEST_AMOUNT_UAH,
  TEST_CRYPTO_CENTS,
  TEST_RATE_KOPECKS,
  TEST_TELEGRAM_ID
} from 'src/modules/telegram-mini-app/testing'
import { NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH } from 'src/shared/constants'
import type { ExchangeRateService } from 'src/modules/exchange-rate/services'
import type { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { FiatDepositSettlementService } from './fiat-deposit-settlement.service'
import type { TransactoPanelPayoutsApiService } from 'src/modules/transacto/services/transacto-panel-payouts.api.service'
import type { FiatDepositBookService } from './fiat-deposit-book.service'
import { FiatDepositCeilingService } from './fiat-deposit-ceiling.service'
import type { FiatDepositWatchService } from './fiat-deposit-watch.service'

const duplicateKeyOn = (field: string) =>
  Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { [field]: 1 } })

describe('FiatDepositFacadeService', () => {
  let book: { readOffer: jest.Mock; findCandidates: jest.Mock }
  let panelPayouts: { assignPayout: jest.Mock; releasePayout: jest.Mock }
  let db: {
    findActiveByTelegramId: jest.Mock
    findById: jest.Mock
    findByTelegramId: jest.Mock
    hasCompleted: jest.Mock
    create: jest.Mock
  }
  let settlement: { announce: jest.Mock; release: jest.Mock; review: jest.Mock }
  let depositDb: { hasCredited: jest.Mock }
  let watches: { getFor: jest.Mock }
  let service: FiatDepositFacadeService

  /** What the book is offering on this test, as a readable book. */
  const offering = (amountsUah: number[]): void => {
    book.readOffer.mockResolvedValue({ amountsUah, available: true })
  }

  /** The new-account ceiling, read off the constant rather than retyped. */
  const NEW_ACCOUNT_CEILING = NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH

  beforeEach(() => {
    book = {
      readOffer: jest.fn().mockResolvedValue({ amountsUah: [TEST_AMOUNT_UAH], available: true }),
      findCandidates: jest.fn().mockResolvedValue([panelPayoutRow()])
    }
    panelPayouts = {
      assignPayout: jest.fn().mockResolvedValue({ status: 'ok' }),
      releasePayout: jest.fn().mockResolvedValue({ status: 'ok' })
    }
    db = {
      findActiveByTelegramId: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(fiatDepositRecord()),
      findByTelegramId: jest.fn().mockResolvedValue([]),
      hasCompleted: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockImplementation(async (data) => fiatDepositRecord(data)),
    }
    settlement = {
      announce: jest.fn(),
      release: jest
        .fn()
        .mockImplementation(async (_record, status) => fiatDepositRecord({ status })),
      review: jest
        .fn()
        .mockImplementation(async () => fiatDepositRecord({ status: TmaFiatDepositStatus.REVIEW }))
    }

    // Nothing credited by either method, which is the capped case and the one
    // every new account arrives in.
    depositDb = {
      hasCredited: jest.fn().mockResolvedValue(false)
    }

    watches = { getFor: jest.fn().mockResolvedValue(null) }

    service = new FiatDepositFacadeService(
      book as unknown as FiatDepositBookService,
      panelPayouts as unknown as TransactoPanelPayoutsApiService,
      db as unknown as TmaFiatDepositDbService,
      // The real ceiling service over the two doubles, rather than a third
      // double: the rule it holds is the one these tests are about, and a
      // stubbed answer would let the offer and the refusal disagree about it.
      new FiatDepositCeilingService(
        depositDb as unknown as TmaDepositDbService,
        db as unknown as TmaFiatDepositDbService
      ),
      watches as unknown as FiatDepositWatchService,
      {
        getBuyRate: async () => TEST_RATE_KOPECKS
      } as unknown as ExchangeRateService,
      settlement as unknown as FiatDepositSettlementService
    )
  })

  describe('the offer', () => {
    it('prices each amount at the current rate', async () => {
      const { options, exchangeRate } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(exchangeRate).toBe(TEST_RATE_KOPECKS)
      // ₴600 at 44.91 is 13.36 USDT, rounded down — never up.
      expect(options).toEqual([{ amountUah: TEST_AMOUNT_UAH, cryptoCents: TEST_CRYPTO_CENTS }])
    })

    /**
     * The floor exists because a transfer's fixed cost outweighs the amount
     * below it, which is as true of hryvnia as of a chain transfer. Showing an
     * amount and then refusing it would be worse than not showing it.
     */
    it('drops amounts that would credit less than the product floor', async () => {
      offering([30_000, TEST_AMOUNT_UAH])

      const { options } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(options.map(({ amountUah }) => amountUah)).toEqual([TEST_AMOUNT_UAH])
    })

    /**
     * The ceiling is on the *offer*, not only on the refusal: a new user shown
     * a ₴12 000 button that answers 400 has been told nothing they can act on.
     */
    it('hides amounts above the ceiling a new account is allowed', async () => {
      offering([TEST_AMOUNT_UAH, NEW_ACCOUNT_CEILING + 100])

      const { options, maxAmountUah } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(options.map(({ amountUah }) => amountUah)).toEqual([TEST_AMOUNT_UAH])
      // Reported so the screen can say why the list stops, rather than leaving
      // a short list and a busy night looking identical.
      expect(maxAmountUah).toBe(NEW_ACCOUNT_CEILING)
    })

    /** The ceiling itself is offered — it is the last amount they may take, not the first they may not. */
    it('offers the ceiling amount itself', async () => {
      offering([NEW_ACCOUNT_CEILING])

      const { options } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(options.map(({ amountUah }) => amountUah)).toEqual([NEW_ACCOUNT_CEILING])
    })

    /**
     * One credited crypto deposit is the whole condition. Turnover is not
     * consulted: an account that has moved its own money through the product
     * once is not what the ceiling protects against, whether it has traded
     * since or not.
     */
    it('caps nothing once a crypto deposit has been credited', async () => {
      depositDb.hasCredited.mockResolvedValue(true)
      offering([TEST_AMOUNT_UAH, NEW_ACCOUNT_CEILING * 10])

      const { options, maxAmountUah } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(options).toHaveLength(2)
      expect(maxAmountUah).toBeNull()
    })

    /** A hryvnia top-up is the same evidence: money of theirs, settled. */
    it('caps nothing once a hryvnia top-up has completed', async () => {
      db.hasCompleted.mockResolvedValue(true)
      offering([TEST_AMOUNT_UAH, NEW_ACCOUNT_CEILING * 10])

      const { options, maxAmountUah } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(options).toHaveLength(2)
      expect(maxAmountUah).toBeNull()
    })

    it('points a user who already has one back at it', async () => {
      const active = fiatDepositRecord()
      db.findActiveByTelegramId.mockResolvedValue(active)

      const { activeDepositId } = await service.getOptions(TEST_TELEGRAM_ID)

      expect(activeDepositId).toBe(active._id.toString())
    })
  })

  describe('reserving', () => {
    it('takes the payout and freezes the rate onto the top-up', async () => {
      const reserved = await service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)

      expect(panelPayouts.assignPayout).toHaveBeenCalledWith(100_990)
      expect(db.create).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 100_990, exchangeRate: TEST_RATE_KOPECKS, cryptoCents: TEST_CRYPTO_CENTS })
      )
      expect(reserved.recipientCard).toBe('4400000000005551')
    })

    /** The card is the whole point of reserving: until then it is nobody's. */
    it('tells the user their screen', async () => {
      await service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)

      expect(settlement.announce).toHaveBeenCalledWith(
        expect.objectContaining({ status: TmaFiatDepositStatus.RESERVED })
      )
    })

    /**
     * The offer is a courtesy and this is the rule. A screen drawn before the
     * ceiling existed — or one built by hand — still asks for the amount.
     */
    it('refuses an amount above the ceiling even when nothing filtered it out', async () => {
      await expect(
        service.reserve(TEST_TELEGRAM_ID, NEW_ACCOUNT_CEILING + 100)
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: ERROR.FIAT_DEPOSIT.ABOVE_FIRST_DEPOSIT_LIMIT.code })
      })

      // And nothing was taken out of the book on the way to refusing.
      expect(panelPayouts.assignPayout).not.toHaveBeenCalled()
    })

    /** The mirror of the refusal: one settled deposit and the ceiling is gone. */
    it('takes an amount above the ceiling once a deposit has been credited', async () => {
      depositDb.hasCredited.mockResolvedValue(true)

      await service.reserve(TEST_TELEGRAM_ID, NEW_ACCOUNT_CEILING + 100)

      expect(panelPayouts.assignPayout).toHaveBeenCalledWith(100_990)
    })

    it('answers a ceiling refusal as a bad request, not a conflict', async () => {
      await expect(service.reserve(TEST_TELEGRAM_ID, NEW_ACCOUNT_CEILING + 100)).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('refuses a second live top-up for one user', async () => {
      db.findActiveByTelegramId.mockResolvedValue(fiatDepositRecord())

      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.ALREADY_ACTIVE
      })
      expect(panelPayouts.assignPayout).not.toHaveBeenCalled()
    })

    /** Losing a race is ordinary: this book is shared with every other trader. */
    it('moves on to the next payout when one is taken from under it', async () => {
      book.findCandidates.mockResolvedValue([panelPayoutRow({ id: 1 }), panelPayoutRow({ id: 2 })])
      panelPayouts.assignPayout
        .mockResolvedValueOnce({ status: 'error', message: 'вже призначено' })
        .mockResolvedValueOnce({ status: 'ok' })

      await service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)

      expect(db.create).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 2 }))
    })

    it('gives up rather than taking a fourth payout', async () => {
      book.findCandidates.mockResolvedValue([1, 2, 3, 4].map((id) => panelPayoutRow({ id })))
      panelPayouts.assignPayout.mockResolvedValue({ status: 'error' })

      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(panelPayouts.assignPayout).toHaveBeenCalledTimes(3)
    })

    /**
     * The failure that matters most. A payout assigned to us with no document
     * behind it is held in a stranger's name, invisible to every user and every
     * timer — so it goes back immediately, before the error is reported.
     */
    it('hands the payout straight back when it cannot be recorded', async () => {
      db.create.mockRejectedValue(duplicateKeyOn('activeUserKey'))

      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.ALREADY_ACTIVE
      })
      expect(panelPayouts.releasePayout).toHaveBeenCalledWith(100_990)
    })

    /** Two indexes can refuse the insert, and they are not the same news. */
    it('reports a payout already held here as an unavailable amount', async () => {
      db.create.mockRejectedValue(duplicateKeyOn('activePayoutId'))

      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE
      })
    })

    it('tells an unreachable book apart from an empty one', async () => {
      book.findCandidates.mockRejectedValue(new Error('ECONNRESET'))

      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )

      book.findCandidates.mockResolvedValue([])
      await expect(service.reserve(TEST_TELEGRAM_ID, TEST_AMOUNT_UAH)).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.AMOUNT_UNAVAILABLE
      })
    })
  })

  /**
   * The way out of the one state the product cannot resolve on its own: the
   * window closed, no receipt will be taken, and the user says they paid.
   */
  describe('appealing', () => {
    it('hands the top-up to an operator without giving the payout back', async () => {
      const appealed = await service.appeal(TEST_TELEGRAM_ID, fiatDepositRecord()._id.toString())

      expect(settlement.review).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 100_990 })
      )
      expect(settlement.release).not.toHaveBeenCalled()
      expect(appealed.status).toBe(TmaFiatDepositStatus.REVIEW)
    })

    /** Nothing left to review: an expired top-up gave its payout back long ago. */
    it('refuses one that is no longer live', async () => {
      db.findById.mockResolvedValue(fiatDepositRecord({ status: TmaFiatDepositStatus.EXPIRED }))

      await expect(service.appeal(TEST_TELEGRAM_ID, 'x')).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.NOT_PAYABLE
      })
      expect(settlement.review).not.toHaveBeenCalled()
    })

    it('refuses to touch somebody else’s top-up', async () => {
      db.findById.mockResolvedValue(fiatDepositRecord({ telegramId: 1 }))

      await expect(service.appeal(TEST_TELEGRAM_ID, 'x')).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.NOT_OWNED
      })
    })
  })

  describe('cancelling', () => {
    /**
     * Delegated, not repeated. Releasing a payout and closing the row is one
     * operation with one owner — the reconciler and an operator ask for the
     * same thing, and a second implementation would be a second settlement
     * path for the same money.
     */
    it('closes the top-up through the settlement service', async () => {
      const cancelled = await service.cancel(TEST_TELEGRAM_ID, fiatDepositRecord()._id.toString())

      expect(settlement.release).toHaveBeenCalledWith(
        expect.objectContaining({ payoutId: 100_990 }),
        TmaFiatDepositStatus.CANCELLED
      )
      expect(cancelled.status).toBe(TmaFiatDepositStatus.CANCELLED)
      // A closed top-up shows no card: an old screen must not still be payable.
      expect(cancelled.recipientCard).toBeNull()
    })

    /**
     * The money has already left their card. Releasing the payout then hands a
     * stranger the rest of a transfer that is half made — that case belongs to
     * an operator, and the hold expiry routes it to one.
     */
    it('refuses once anything has been paid into it', async () => {
      db.findById.mockResolvedValue(fiatDepositRecord({ coveredUah: 30_000 }))

      await expect(service.cancel(TEST_TELEGRAM_ID, 'x')).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.NOT_PAYABLE
      })
      expect(settlement.release).not.toHaveBeenCalled()
    })

    it('refuses to touch somebody else’s top-up', async () => {
      db.findById.mockResolvedValue(fiatDepositRecord({ telegramId: 1 }))

      await expect(service.cancel(TEST_TELEGRAM_ID, 'x')).rejects.toMatchObject({
        response: ERROR.FIAT_DEPOSIT.NOT_OWNED
      })
    })
  })
})
