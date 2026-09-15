import {
  ERROR,
  isFiatDepositPayable,
  type FiatDepositWatch,
  type TmaFiatDeposit
} from '@transacto/contracts'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { TmaFiatDepositRecord } from 'src/modules/repositories/tma-fiat-deposit-db/interfaces'
import type { TmaFiatDepositWatchRecord } from 'src/modules/repositories/tma-fiat-deposit-watch-db/interfaces'

/**
 * A stored top-up as the Mini App sees it.
 *
 * Two things are deliberately not a straight copy of the row. The recipient
 * card is dropped the moment the top-up stops being payable — an old screen
 * left open must not still show a card to transfer to. And receipts are mapped
 * one by one rather than spread, so a field added to the schema for an
 * operator's benefit does not reach a user's phone by default.
 */
export const toFiatDepositContract = (record: TmaFiatDepositRecord): TmaFiatDeposit => ({
  id: record._id.toString(),
  status: record.status,
  amountUah: record.amountUah,
  cryptoCents: record.cryptoCents,
  exchangeRate: record.exchangeRate,
  recipientCard: isFiatDepositPayable(record.status) ? record.recipientCard : null,
  coveredUah: record.coveredUah,
  payDeadlineAt: record.payDeadlineAt.toISOString(),
  receipts: record.receipts.map((receipt) => ({
    id: receipt._id.toString(),
    status: receipt.status,
    rejection: receipt.rejection,
    amountUah: receipt.amountUah,
    uploadedAt: receipt.uploadedAt.toISOString()
  })),
  createdAt: record.createdAt.toISOString(),
  completedAt: record.completedAt?.toISOString() ?? null
})

/**
 * The top-up, if it is this user's.
 *
 * A function rather than a method on any one service, because two of them ask
 * the same question and neither should have to depend on the other to do it —
 * the receipt path used to reach into the facade for this, which pointed a
 * service at a facade instead of the other way round.
 *
 * "Not found" and "not yours" stay distinct on purpose. They are the same
 * refusal to an attacker, and completely different information to a user whose
 * top-up expired versus one whose link came from somebody else's chat.
 */
export const assertOwnedFiatDeposit = (
  record: TmaFiatDepositRecord | null,
  telegramId: number
): TmaFiatDepositRecord => {
  if (record === null) throw new NotFoundException(ERROR.FIAT_DEPOSIT.NOT_FOUND)
  if (record.telegramId !== telegramId) throw new ForbiddenException(ERROR.FIAT_DEPOSIT.NOT_OWNED)

  return record
}

/**
 * A stored request as the Mini App reads it.
 *
 * Dates become ISO strings and nothing else changes: a request holds no
 * credential, no balance and no name, so there is nothing here to withhold —
 * which is why this is a mapper and not a redaction.
 */
export const toFiatDepositWatchContract = (
  record: TmaFiatDepositWatchRecord
): FiatDepositWatch => ({
  minAmountUah: record.minAmountUah,
  maxAmountUah: record.maxAmountUah,
  mode: record.mode,
  createdAt: record.createdAt.toISOString(),
  lastNotifiedAt: record.lastNotifiedAt?.toISOString() ?? null
})
