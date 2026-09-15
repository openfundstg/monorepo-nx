import { Types } from 'mongoose'
import {
  AdminAuditAction,
  AdminBalanceOperation,
  AdminBalanceTarget,
  BalanceEntryKind,
  TmaDepositStatus,
  TmaFiatDepositStatus
} from '@transacto/contracts'
import { BackfillBalanceEntriesMigration } from './0001-backfill-balance-entries.migration'
import type { AdminAuditLogDbService } from 'src/modules/repositories/admin-db/services'
import type { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import type { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'

const TELEGRAM_ID = 592
const LONG_AGO = new Date('2026-02-01T00:00:00Z')
const ALSO_LONG_AGO = new Date('2026-03-01T00:00:00Z')
const SIGNED_UP = new Date('2026-01-01T00:00:00Z')

const id = (hex: string) => new Types.ObjectId(hex.padStart(24, '0'))

/** One page of rows, then nothing — what `findPage` does at the end of a walk. */
const onePage = <T>(items: T[]) => jest.fn().mockResolvedValue({ items, total: items.length })

describe('0001-backfill-balance-entries', () => {
  let entries: {
    backfill: jest.Mock
    sumForUser: jest.Mock
    findFirstLiveAt: jest.Mock
    deleteBackfilledBy: jest.Mock
  }
  let deposits: { findPage: jest.Mock }
  let fiatDeposits: { findPage: jest.Mock }
  let sales: { findPage: jest.Mock }
  let users: { findPage: jest.Mock }
  let audit: { findPage: jest.Mock }
  let migration: BackfillBalanceEntriesMigration

  /** Every row the migration wrote, in the order it wrote them. */
  const booked = () => entries.backfill.mock.calls.map(([entry]) => entry)

  beforeEach(() => {
    entries = {
      backfill: jest.fn().mockResolvedValue({ _id: id('1') }),
      sumForUser: jest.fn().mockResolvedValue(0),
      // The book is empty, so all of history is the migration's to reconstruct.
      findFirstLiveAt: jest.fn().mockResolvedValue(null),
      deleteBackfilledBy: jest.fn().mockResolvedValue(0)
    }
    deposits = { findPage: onePage([]) }
    fiatDeposits = { findPage: onePage([]) }
    sales = { findPage: onePage([]) }
    users = { findPage: onePage([]) }
    audit = { findPage: onePage([]) }

    migration = new BackfillBalanceEntriesMigration(
      entries as unknown as TmaBalanceEntryDbService,
      deposits as unknown as TmaDepositDbService,
      fiatDeposits as unknown as TmaFiatDepositDbService,
      sales as unknown as TmaSaleDbService,
      users as unknown as TmaUserDbService,
      audit as unknown as AdminAuditLogDbService
    )
  })

  describe('what it reconstructs', () => {
    it('books a credited deposit in cents, dated when it was verified', async () => {
      deposits.findPage = onePage([
        {
          _id: id('a1'),
          telegramId: TELEGRAM_ID,
          cryptoAmount: 30.5,
          status: TmaDepositStatus.COMPLETED,
          // Asked for a day earlier than it was paid: the money landed on the
          // second date, and that is the one the book records.
          createdAt: new Date('2026-01-31T00:00:00Z'),
          verifiedAt: LONG_AGO
        }
      ])

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({
          telegramId: TELEGRAM_ID,
          kind: BalanceEntryKind.DEPOSIT,
          amountCents: 3_050,
          createdAt: LONG_AGO,
          dedupeKey: `${BalanceEntryKind.DEPOSIT}:${id('a1').toString()}`,
          backfilledBy: '0001-backfill-balance-entries'
        })
      )
    })

    /** The figure frozen at reservation, not what the hryvnia is worth today. */
    it('books a completed top-up at the rate it was credited at', async () => {
      fiatDeposits.findPage = onePage([
        {
          _id: id('b2'),
          telegramId: TELEGRAM_ID,
          cryptoCents: 1_336,
          status: TmaFiatDepositStatus.COMPLETED,
          createdAt: SIGNED_UP,
          completedAt: ALSO_LONG_AGO
        }
      ])

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({
          kind: BalanceEntryKind.FIAT_DEPOSIT,
          amountCents: 1_336,
          createdAt: ALSO_LONG_AGO
        })
      )
    })

    it('books a sale as a negative stake and, where recorded, a refund', async () => {
      sales.findPage = onePage([
        {
          _id: id('c3'),
          telegramId: TELEGRAM_ID,
          frozenUsdt: 10_000,
          refundedRemainderUsdt: 516,
          createdAt: LONG_AGO,
          completedAt: ALSO_LONG_AGO
        }
      ])

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({
          kind: BalanceEntryKind.SALE_STAKE,
          amountCents: -10_000,
          createdAt: LONG_AGO
        })
      )
      expect(booked()).toContainEqual(
        expect.objectContaining({
          kind: BalanceEntryKind.SALE_REFUND,
          amountCents: 516,
          createdAt: ALSO_LONG_AGO
        })
      )
    })

    it('books no refund for an order that gave nothing back', async () => {
      sales.findPage = onePage([
        {
          _id: id('c4'),
          telegramId: TELEGRAM_ID,
          frozenUsdt: 10_000,
          refundedRemainderUsdt: 0,
          createdAt: LONG_AGO,
          completedAt: ALSO_LONG_AGO
        }
      ])

      await migration.up()

      expect(booked().map(({ kind }) => kind)).not.toContain(BalanceEntryKind.SALE_REFUND)
    })

    /**
     * The only reconstruction that recovers the balance it produced: the audit
     * row was written to explain itself to a person, so it carries `after`.
     */
    it('books an operator’s debit as a negative, with the balance it left', async () => {
      audit.findPage = onePage([
        {
          _id: id('d5'),
          action: AdminAuditAction.USER_BALANCE_ADJUSTED,
          targetId: String(TELEGRAM_ID),
          createdAt: LONG_AGO,
          metadata: {
            target: AdminBalanceTarget.BALANCE,
            operation: AdminBalanceOperation.DEBIT,
            amountCents: 2_500,
            before: 9_500,
            after: 7_000
          }
        }
      ])

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({
          kind: BalanceEntryKind.ADMIN_ADJUSTMENT,
          amountCents: -2_500,
          balanceAfter: 7_000
        })
      )
    })

    /** The referral pot is not what this book counts. */
    it('ignores a correction to the referral pot', async () => {
      audit.findPage = onePage([
        {
          _id: id('d6'),
          action: AdminAuditAction.USER_BALANCE_ADJUSTED,
          targetId: String(TELEGRAM_ID),
          createdAt: LONG_AGO,
          metadata: {
            target: AdminBalanceTarget.REFERRAL_BALANCE,
            operation: AdminBalanceOperation.CREDIT,
            amountCents: 2_500,
            after: 2_500
          }
        }
      ])

      await migration.up()

      expect(booked()).toEqual([])
    })
  })

  /**
   * The line that keeps a movement from being counted twice: everything the
   * product itself booked is off limits, and it booked everything from its
   * first entry onwards.
   */
  describe('the moment the book started', () => {
    beforeEach(() => {
      entries.findFirstLiveAt.mockResolvedValue(ALSO_LONG_AGO)
    })

    it('reconstructs a movement from before it', async () => {
      deposits.findPage = onePage([
        { _id: id('a7'), telegramId: TELEGRAM_ID, cryptoAmount: 10, verifiedAt: LONG_AGO, createdAt: LONG_AGO }
      ])

      await migration.up()

      expect(booked().map(({ kind }) => kind)).toContain(BalanceEntryKind.DEPOSIT)
    })

    it('leaves a movement from after it alone — the product already booked that one', async () => {
      deposits.findPage = onePage([
        {
          _id: id('a8'),
          telegramId: TELEGRAM_ID,
          cryptoAmount: 10,
          verifiedAt: new Date('2026-04-01T00:00:00Z'),
          createdAt: LONG_AGO
        }
      ])

      await migration.up()

      expect(booked()).toEqual([])
    })
  })

  describe('the balance brought forward', () => {
    beforeEach(() => {
      users.findPage = onePage([{ telegramId: TELEGRAM_ID, balance: 5_000, createdAt: SIGNED_UP }])
    })

    /**
     * Referral transfers left no trace and cancelled orders never recorded
     * their refund, so a reconstruction is always short by something. The
     * difference goes in as one line, dated at the account, and from then on
     * the sum of a user's entries is their balance.
     */
    it('books whatever the reconstruction could not explain', async () => {
      entries.sumForUser.mockResolvedValue(2_700)

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({
          kind: BalanceEntryKind.OPENING_BALANCE,
          amountCents: 2_300,
          createdAt: SIGNED_UP,
          dedupeKey: `${BalanceEntryKind.OPENING_BALANCE}:${TELEGRAM_ID}`
        })
      )
    })

    it('books nothing for a user the reconstruction explains exactly', async () => {
      entries.sumForUser.mockResolvedValue(5_000)

      await migration.up()

      expect(booked()).toEqual([])
    })

    it('books a negative one when the reconstruction overshot', async () => {
      entries.sumForUser.mockResolvedValue(6_000)

      await migration.up()

      expect(booked()).toContainEqual(
        expect.objectContaining({ kind: BalanceEntryKind.OPENING_BALANCE, amountCents: -1_000 })
      )
    })

    /** Last, always: it is the difference between the balance and everything else. */
    it('is booked after every reconstructed movement', async () => {
      deposits.findPage = onePage([
        { _id: id('a9'), telegramId: TELEGRAM_ID, cryptoAmount: 10, verifiedAt: LONG_AGO, createdAt: LONG_AGO }
      ])
      entries.sumForUser.mockResolvedValue(1_000)

      await migration.up()

      expect(booked().map(({ kind }) => kind)).toEqual([
        BalanceEntryKind.DEPOSIT,
        BalanceEntryKind.OPENING_BALANCE
      ])
    })
  })

  /** Its own rows and nothing else — which is what `backfilledBy` is for. */
  it('reverses by deleting only what it wrote', async () => {
    entries.deleteBackfilledBy.mockResolvedValue(12)

    await expect(migration.down()).resolves.toContain('12')
    expect(entries.deleteBackfilledBy).toHaveBeenCalledWith('0001-backfill-balance-entries')
  })
})
