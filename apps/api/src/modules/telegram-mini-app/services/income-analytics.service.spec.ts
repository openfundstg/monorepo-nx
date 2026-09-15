import { Types } from 'mongoose'
import { BalanceEntryKind, SaleRemainderPolicy, TmaSaleStatus } from '@transacto/contracts'
import { IncomeAnalyticsService } from './income-analytics.service'
import type { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const TELEGRAM_ID = 414131219
const TOP_UP_ID = new Types.ObjectId()

const at = (minute: number): Date => new Date(Date.UTC(2026, 8, 1, 12, minute))

/** 100 USDT credited by a hryvnia top-up. */
const fiatEntry = (overrides = {}) => ({
  kind: BalanceEntryKind.FIAT_DEPOSIT,
  amountCents: 10_000,
  sourceId: TOP_UP_ID,
  createdAt: at(0),
  ...overrides
})

/** 100 USDT the user sent in themselves. */
const cryptoEntry = (overrides = {}) => ({
  kind: BalanceEntryKind.DEPOSIT,
  amountCents: 10_000,
  sourceId: new Types.ObjectId(),
  createdAt: at(0),
  ...overrides
})

/** ₴4 600 paid for the 100 USDT above. */
const paidForTopUp = () => new Map([[TOP_UP_ID.toString(), 460_000]])

/**
 * A ₴4 700 order at 47.00 that filled and closed.
 *
 * `refundedRemainderUsdt` is absent on purpose, because that is how production
 * looks: `completeIfOpen` writes it and `cancelIfOpen` does not, so a fixture
 * that supplied one for a cancellation would be testing a document shape the
 * product never produces.
 */
const completed = (overrides = {}) => ({
  status: TmaSaleStatus.COMPLETED,
  frozenUsdt: 10_000,
  exchangeRate: 4_700,
  fiatAmount: 470_000,
  receivedAmount: 470_000,
  jarBalance: 470_000,
  openingJarBalance: 0,
  remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
  createdAt: at(10),
  ...overrides
})

/** The same order, stopped by its user. */
const cancelled = (overrides = {}) =>
  completed({ status: TmaSaleStatus.CANCELLED, ...overrides })

/**
 * Which documents the two halves of the answer are built from, and why it is
 * not the obvious pair.
 *
 * Arrivals come from the balance book because only the book is complete —
 * referral transfers and operators' corrections add USDT and write no deposit.
 * Disposals come from the orders because a stake is a reservation, not a sale:
 * what actually left is what `saleDisposal` says left, which is a
 * different computation for each of the two endings and readable off neither
 * document.
 */
describe('IncomeAnalyticsService', () => {
  let balanceEntryDb: { findAcquisitions: jest.Mock }
  let fiatDepositDb: { amountPaidByCompletedTopUp: jest.Mock }
  let saleDb: { findSettledByTelegramId: jest.Mock }
  let service: IncomeAnalyticsService

  const income = () => service.forUser(TELEGRAM_ID)

  beforeEach(() => {
    balanceEntryDb = { findAcquisitions: jest.fn().mockResolvedValue([]) }
    fiatDepositDb = { amountPaidByCompletedTopUp: jest.fn().mockResolvedValue(new Map()) }
    saleDb = { findSettledByTelegramId: jest.fn().mockResolvedValue([]) }

    service = new IncomeAnalyticsService(
      balanceEntryDb as unknown as TmaBalanceEntryDbService,
      fiatDepositDb as unknown as TmaFiatDepositDbService,
      saleDb as unknown as TmaSaleDbService
    )
  })

  it('has nothing to report before the first sale', async () => {
    await expect(income()).resolves.toMatchObject({
      fromFiat: { soldUsdtCents: 0, profitUah: 0 },
      fromOwnUsdt: { soldUsdtCents: 0 }
    })
  })

  it('prices a hryvnia-funded sale from what the user actually transferred', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(paidForTopUp())
    saleDb.findSettledByTelegramId.mockResolvedValue([completed()])

    await expect(income()).resolves.toMatchObject({
      fromFiat: { soldUsdtCents: 10_000, spentUah: 460_000, receivedUah: 470_000, profitUah: 10_000 }
    })
  })

  /**
   * The valuation *is* recorded on a crypto deposit, and is deliberately not
   * read: it says what that USDT was worth at our own buy rate, which is a
   * useful thing for an operator and a dishonest thing to call somebody's
   * purchase price.
   */
  it('claims no cost for USDT the user brought in themselves', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([cryptoEntry()])
    saleDb.findSettledByTelegramId.mockResolvedValue([completed()])

    const result = await income()

    expect(result.fromOwnUsdt).toMatchObject({ soldUsdtCents: 10_000, receivedUah: 470_000 })
    expect(result.fromFiat.profitUah).toBe(0)
  })

  /** …and the top-up collection is not even asked when no lot could use it. */
  it('does not read the top-ups of a user who has never made one', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([cryptoEntry()])

    await income()

    expect(fiatDepositDb.amountPaidByCompletedTopUp).not.toHaveBeenCalled()
  })

  /**
   * The bug this file was rewritten for.
   *
   * `refundedRemainderUsdt` is written by `completeIfOpen` and by nothing else,
   * so on a cancelled order it reads its default of zero. Deriving the sold
   * amount as `frozenUsdt - refundedRemainderUsdt` therefore counted the whole
   * stake — and a user who stopped an order nobody had paid into was shown
   * their entire stake sold for ₴0, a fabricated total loss.
   */
  it('reports no sale for an order stopped before anybody paid', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(paidForTopUp())
    saleDb.findSettledByTelegramId.mockResolvedValue([
      cancelled({ receivedAmount: 0, jarBalance: 0, openingJarBalance: 0 })
    ])

    await expect(income()).resolves.toMatchObject({
      fromFiat: { soldUsdtCents: 0, profitUah: 0 },
      fromOwnUsdt: { soldUsdtCents: 0 }
    })
  })

  /**
   * A user who stopped an order after part of it was paid keeps that hryvnia
   * and is charged the USDT that bought it. That is a sale, and the figures are
   * the settlement's own — 50 USDT consumed for the ₴2 350 delivered.
   */
  it('counts what a stopped order had already delivered', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(paidForTopUp())
    saleDb.findSettledByTelegramId.mockResolvedValue([
      cancelled({ receivedAmount: 235_000, jarBalance: 235_000, openingJarBalance: 0 })
    ])

    await expect(income()).resolves.toMatchObject({
      fromFiat: { soldUsdtCents: 5_000, spentUah: 230_000, receivedUah: 235_000, profitUah: 5_000 }
    })
  })

  /**
   * Hryvnia can reach a jar with no settled order to attribute it to, and
   * `saleDeliveredFiat` takes the greater of the two measures. Reading
   * `receivedAmount` alone would understate what the user actually got and
   * report a smaller profit than the refund path charged them for.
   */
  it('counts hryvnia the jar holds that no order accounts for', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(paidForTopUp())
    saleDb.findSettledByTelegramId.mockResolvedValue([
      cancelled({ receivedAmount: 0, jarBalance: 235_000, openingJarBalance: 0 })
    ])

    await expect(income()).resolves.toMatchObject({
      fromFiat: { soldUsdtCents: 5_000, receivedUah: 235_000 }
    })
  })

  /** Money that was in the jar before the order started is not this order's. */
  it('ignores hryvnia the jar already held when the order began', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(paidForTopUp())
    saleDb.findSettledByTelegramId.mockResolvedValue([
      cancelled({ receivedAmount: 0, jarBalance: 235_000, openingJarBalance: 235_000 })
    ])

    await expect(income()).resolves.toMatchObject({ fromFiat: { soldUsdtCents: 0 } })
  })

  /**
   * A `FIAT_DEPOSIT` entry whose top-up cannot be resolved is not priced as
   * free — it is priced as unknown, which puts it in the bucket that claims no
   * profit rather than in the one that would report the whole sale as gain.
   */
  it('does not treat an unresolvable top-up as a free lot', async () => {
    balanceEntryDb.findAcquisitions.mockResolvedValue([fiatEntry()])
    fiatDepositDb.amountPaidByCompletedTopUp.mockResolvedValue(new Map())
    saleDb.findSettledByTelegramId.mockResolvedValue([completed()])

    const result = await income()

    expect(result.fromFiat.profitUah).toBe(0)
    expect(result.fromOwnUsdt.soldUsdtCents).toBe(10_000)
  })

  /**
   * Which orders count is the repository's question, not this service's — the
   * grouping lives beside the other three in the sale repository, so
   * there is one place to remember the next terminal status in.
   */
  it('asks the repository for the orders that settled, rather than filtering them here', async () => {
    await income()

    expect(saleDb.findSettledByTelegramId).toHaveBeenCalledWith(TELEGRAM_ID)
  })
})
