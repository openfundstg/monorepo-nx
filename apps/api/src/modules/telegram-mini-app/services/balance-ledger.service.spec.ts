import { BalanceEntryKind } from '@transacto/contracts'
import { BalanceLedgerService } from './balance-ledger.service'
import type { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'

const TELEGRAM_ID = 592
const ORDER_ID = '68b0f2d1c0ffee0000000001'

describe('BalanceLedgerService', () => {
  let users: {
    creditBalance: jest.Mock
    freezeBalance: jest.Mock
    unfreezeBalance: jest.Mock
    transferReferralToBalance: jest.Mock
    adjustBalance: jest.Mock
  }
  let entries: { create: jest.Mock }
  let service: BalanceLedgerService

  beforeEach(() => {
    users = {
      creditBalance: jest.fn().mockResolvedValue(12_000),
      freezeBalance: jest.fn().mockResolvedValue({ balance: 2_000, frozenBalance: 10_000 }),
      unfreezeBalance: jest.fn().mockResolvedValue({ balance: 9_000, frozenBalance: 1_000 }),
      transferReferralToBalance: jest.fn().mockResolvedValue({ referralBalance: 0, balance: 5_100 }),
      adjustBalance: jest.fn().mockResolvedValue({ balance: 7_000, referralBalance: 300 })
    }
    entries = { create: jest.fn().mockResolvedValue({ _id: 'entry-1' }) }

    service = new BalanceLedgerService(
      users as unknown as TmaUserDbService,
      entries as unknown as TmaBalanceEntryDbService
    )
  })

  describe('crediting', () => {
    it('books the movement with the balance it produced', async () => {
      const balance = await service.credit(TELEGRAM_ID, 1_500, {
        kind: BalanceEntryKind.DEPOSIT,
        sourceId: 'deposit-1',
        once: true
      })

      expect(balance).toBe(12_000)
      expect(entries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramId: TELEGRAM_ID,
          kind: BalanceEntryKind.DEPOSIT,
          amountCents: 1_500,
          // Read off the write that moved the money, never fetched again — an
          // entry must not claim a balance nobody ever had.
          balanceAfter: 12_000
        })
      )
    })

    /**
     * `once` is the caller's claim that a repeat would be the same movement
     * arriving twice — a reconciler passing over a credited deposit again. The
     * key it becomes is what the unique index refuses.
     */
    it('turns `once` into a dedupe key naming the kind and the source', async () => {
      await service.credit(TELEGRAM_ID, 1_500, {
        kind: BalanceEntryKind.DEPOSIT,
        sourceId: 'deposit-1',
        once: true
      })

      expect(entries.create).toHaveBeenCalledWith(
        expect.objectContaining({ dedupeKey: `${BalanceEntryKind.DEPOSIT}:deposit-1` })
      )
    })

    /** Without the claim there is no key: two of these are two real movements. */
    it('books no dedupe key when the movement may legitimately repeat', async () => {
      await service.credit(TELEGRAM_ID, 1_500, {
        kind: BalanceEntryKind.FIAT_DEPOSIT,
        sourceId: 'top-up-1'
      })

      expect(entries.create).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: null }))
    })

    /**
     * The failure that matters. The balance has already moved by the time this
     * runs, and there is no transaction to roll it back with — so a book that
     * cannot be written is a logged hole in an explanation, not a refused
     * credit that leaves the user's money in limbo.
     */
    it('still reports the credit when the entry cannot be written', async () => {
      entries.create.mockRejectedValue(new Error('mongo is down'))

      await expect(
        service.credit(TELEGRAM_ID, 1_500, { kind: BalanceEntryKind.DEPOSIT })
      ).resolves.toBe(12_000)
    })

    /** A duplicate is the dedupe key doing its job, not a failure. */
    it('is untroubled by an entry that was already booked', async () => {
      entries.create.mockResolvedValue(null)

      await expect(
        service.credit(TELEGRAM_ID, 1_500, { kind: BalanceEntryKind.DEPOSIT, once: true })
      ).resolves.toBe(12_000)
    })

    /** Nothing is booked before the money has actually moved. */
    it('books nothing when the movement itself fails', async () => {
      users.creditBalance.mockRejectedValue(new Error('no such user'))

      await expect(
        service.credit(TELEGRAM_ID, 1_500, { kind: BalanceEntryKind.DEPOSIT })
      ).rejects.toThrow()
      expect(entries.create).not.toHaveBeenCalled()
    })
  })

  describe('a sale', () => {
    it('books the stake as a negative movement', async () => {
      await service.freeze(TELEGRAM_ID, 10_000)

      expect(entries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: BalanceEntryKind.SALE_STAKE,
          amountCents: -10_000,
          balanceAfter: 2_000,
          // No order exists yet: the stake is frozen first, so that an order is
          // never created against a balance that could not back it.
          sourceId: null
        })
      )
    })

    it('books a refund against the order that gave it back', async () => {
      await service.refund(TELEGRAM_ID, 4_000, ORDER_ID)

      expect(entries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: BalanceEntryKind.SALE_REFUND,
          amountCents: 4_000,
          balanceAfter: 9_000,
          sourceId: ORDER_ID,
          // Never deduped: a failed creation, a cancellation and an unfillable
          // tail are three different refunds one order can produce.
          dedupeKey: null
        })
      )
    })
  })

  describe('an operator’s correction', () => {
    it('books one that lands on the spendable balance', async () => {
      await service.adjust(TELEGRAM_ID, 'balance', -2_500)

      expect(entries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: BalanceEntryKind.ADMIN_ADJUSTMENT,
          amountCents: -2_500,
          balanceAfter: 7_000
        })
      )
    })

    /**
     * The referral pot is not this book's subject, and booking a movement of it
     * would put the sum out by exactly that amount — which is the one property
     * the collection exists to have.
     */
    it('books nothing for a correction to the referral pot', async () => {
      await service.adjust(TELEGRAM_ID, 'referralBalance', 2_500)

      expect(users.adjustBalance).toHaveBeenCalledWith(TELEGRAM_ID, 'referralBalance', 2_500)
      expect(entries.create).not.toHaveBeenCalled()
    })

    /** `null` means the guarded update matched nothing — no movement, no entry. */
    it('books nothing when the correction was refused', async () => {
      users.adjustBalance.mockResolvedValue(null)

      await expect(service.adjust(TELEGRAM_ID, 'balance', -2_500)).resolves.toBeNull()
      expect(entries.create).not.toHaveBeenCalled()
    })
  })

  /** The movement that had no record at all until this book existed. */
  it('books a referral transfer as an arrival on the balance', async () => {
    const balances = await service.transferReferral(TELEGRAM_ID, 2_100)

    expect(balances).toEqual({ referralBalance: 0, balance: 5_100 })
    expect(entries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: BalanceEntryKind.REFERRAL_TRANSFER,
        amountCents: 2_100,
        balanceAfter: 5_100
      })
    )
  })
})
