import { Injectable } from '@nestjs/common'
import { BalanceEntryKind, type IncomeAnalyticsResponse } from '@transacto/contracts'
import { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { saleDisposal } from 'src/shared/utils'
import { matchSalesToLots, type UsdtLot, type UsdtSale } from 'src/modules/telegram-mini-app/utils'
import type { TmaBalanceEntryRecord } from 'src/modules/repositories/tma-balance-entry-db/interfaces'

/**
 * What a user has earned here, computed from the record rather than stored.
 *
 * **Nothing is materialised, deliberately.** A stored total is a second answer
 * to a question the documents already answer, and it drifts the first time a
 * settlement path forgets to update it — which, on the evidence of this
 * codebase, is the kind of thing that happens and is noticed months later. The
 * page is read a few times a day per user over a handful of documents; there is
 * no volume here that buys anything back for that risk.
 *
 * Two streams go into it, from two different collections, and which collection
 * each comes from is not arbitrary:
 *
 * - **Arrivals** come from the balance book, because it is the only complete
 *   list of them. Deposits are not: a referral transfer and an operator's
 *   correction add USDT and write no deposit anywhere.
 * - **Disposals** come from the sales, because a stake is not a
 *   disposal. Freezing USDT reserves it and a refund gives part of it back;
 *   what actually left is the committed remainder, and only the order document
 *   states that — through `saleDisposal`, which is also what the
 *   settlement and the refund preview read, so an earnings figure and a refund
 *   cannot come to two answers about the same order.
 */
@Injectable()
export class IncomeAnalyticsService {
  constructor(
    private readonly balanceEntryDb: TmaBalanceEntryDbService,
    private readonly fiatDepositDb: TmaFiatDepositDbService,
    private readonly saleDb: TmaSaleDbService
  ) {}

  async forUser(telegramId: number): Promise<IncomeAnalyticsResponse> {
    const [entries, orders] = await Promise.all([
      this.balanceEntryDb.findAcquisitions(telegramId),
      this.saleDb.findSettledByTelegramId(telegramId)
    ])

    const sales = orders
      .map<UsdtSale>((order) => {
        const { committedUsdtCents, deliveredFiat } = saleDisposal(order)

        return { usdtCents: committedUsdtCents, receivedUah: deliveredFiat, at: order.createdAt }
      })
      // An order cancelled before anybody paid gave its whole stake back: it
      // disposed of nothing, so it is not a sale and has no hryvnia to divide.
      .filter((sale) => sale.usdtCents > 0)

    return matchSalesToLots(await this.lotsFrom(telegramId, entries), sales)
  }

  /**
   * Turns balance movements into lots, pricing the ones that were paid for.
   *
   * The hryvnia is read from the top-up document rather than from the entry,
   * because the entry records USDT and the payment was in hryvnia — and the two
   * are related by a rate this must not re-apply. `amountUah` is what the user
   * transferred; deriving it from the credited cents and a stored rate would be
   * the same number recomputed, and would differ by a kopeck the moment either
   * rounding changed.
   *
   * Every other kind is a lot with no cost. That includes the TRC20 deposits,
   * whose hryvnia valuation *is* recorded on the deposit — and is deliberately
   * not read here. It says what that USDT was worth at our own buy rate when it
   * landed, which is a useful thing for an operator reading history and a
   * dishonest thing to call somebody's purchase price. The user bought it
   * somewhere we cannot see, at a price we were never told.
   *
   * The top-up query is skipped outright when no lot could use it, which is
   * every user who has only ever brought their own USDT in.
   */
  private async lotsFrom(
    telegramId: number,
    entries: readonly TmaBalanceEntryRecord[]
  ): Promise<UsdtLot[]> {
    const paidFor = entries.some((entry) => entry.kind === BalanceEntryKind.FIAT_DEPOSIT)
      ? await this.fiatDepositDb.amountPaidByCompletedTopUp(telegramId)
      : new Map<string, number>()

    return entries.map<UsdtLot>((entry) => ({
      usdtCents: entry.amountCents,
      // A `FIAT_DEPOSIT` whose top-up cannot be resolved is priced as *unknown*,
      // never as free: unknown puts it in the bucket that claims no profit,
      // where free would report the whole sale as gain.
      costUah:
        entry.kind === BalanceEntryKind.FIAT_DEPOSIT && entry.sourceId !== null
          ? paidFor.get(entry.sourceId.toString()) ?? null
          : null,
      at: entry.createdAt
    }))
  }
}
