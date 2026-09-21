import { Types } from 'mongoose'
import {
  FiatDepositWatchMode,
  TmaFiatDepositStatus,
  TmaFiatReceiptStatus
} from '@transacto/contracts'
import type {
  TmaFiatDepositReceiptRecord,
  TmaFiatDepositRecord
} from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import type { TmaFiatDepositWatchRecord } from 'src/modules/repositories/tma-fiat-deposit-watch-db/interfaces'

/**
 * A stored fiat top-up, for the four specs that need one.
 *
 * They had a copy each — twenty-five lines of the same object, which is exactly
 * how two specs end up disagreeing about what a top-up looks like and one of
 * them starts passing for the wrong reason. The defaults describe the ordinary
 * case: reserved, nothing paid, ₴600 at 44.91.
 *
 * It lives beside the module rather than in `shared/testing` because it names
 * this domain's own types, and `shared/` never imports a module.
 */
export const TEST_TELEGRAM_ID = 592
export const TEST_PAYOUT_ID = 100_990
/** ₴600 at 44.91 UAH/USDT, rounded down. */
export const TEST_CRYPTO_CENTS = 1336
export const TEST_RATE_KOPECKS = 4491
export const TEST_AMOUNT_UAH = 60_000

export const fiatReceiptRecord = (
  overrides: Partial<TmaFiatDepositReceiptRecord> = {}
): TmaFiatDepositReceiptRecord => ({
  _id: new Types.ObjectId(),
  status: TmaFiatReceiptStatus.PARSING,
  rejection: null,
  amountUah: null,
  upstreamJobId: 2242,
  checkUrl: null,
  // The ordinary case: the recipient was compared with the payout's card.
  recipientChecked: true,
  // Nothing proved it and nothing archived it — the state a receipt is in for
  // the moment between being pushed and being judged, which is where most
  // specs want it.
  bank: null,
  storedName: null,
  sizeBytes: null,
  purgedAt: null,
  uploadedAt: new Date(),
  ...overrides
})

/** Comfortably longer than any test takes, and shorter than a real window. */
const FIXTURE_WINDOW_MS = 5 * 60 * 1000

export const fiatDepositRecord = (
  overrides: Partial<TmaFiatDepositRecord> = {}
): TmaFiatDepositRecord => ({
  _id: new Types.ObjectId(),
  telegramId: TEST_TELEGRAM_ID,
  payoutId: TEST_PAYOUT_ID,
  amountUah: TEST_AMOUNT_UAH,
  cryptoCents: TEST_CRYPTO_CENTS,
  exchangeRate: TEST_RATE_KOPECKS,
  recipientCard: '4400000000005551',
  status: TmaFiatDepositStatus.RESERVED,
  receipts: [],
  coveredUah: 0,
  // Both in the future, because the default is a *live* top-up: a receipt is
  // refused once the deadline passes, and a fixture stamped `new Date()` was
  // one tick from being closed by the time a test used it.
  payDeadlineAt: new Date(Date.now() + FIXTURE_WINDOW_MS),
  holdUntilAt: new Date(Date.now() + 2 * FIXTURE_WINDOW_MS),
  completedAt: null,
  releasedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  activeUserKey: TEST_TELEGRAM_ID,
  activePayoutId: TEST_PAYOUT_ID,
  ...overrides
})

/**
 * A stored request to be told about an amount.
 *
 * Defaults to the ordinary case: a standing request over ₴500–₴3 000 that has
 * never fired. Written as a builder for the same reason as the top-up above —
 * three specs need one, and three hand-made copies is three chances for one of
 * them to describe a document production never writes.
 */
export const fiatDepositWatchRecord = (
  overrides: Partial<TmaFiatDepositWatchRecord> = {}
): TmaFiatDepositWatchRecord => ({
  _id: new Types.ObjectId(),
  telegramId: TEST_TELEGRAM_ID,
  minAmountUah: 50_000,
  maxAmountUah: 300_000,
  mode: FiatDepositWatchMode.ALWAYS,
  lastNotifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
})
