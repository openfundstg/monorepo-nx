import { Injectable, Logger } from '@nestjs/common'
import { BalanceEntryKind } from '@transacto/contracts'
import { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { describeError } from 'src/shared/utils'

/**
 * What a movement is *about*, beyond the number.
 *
 * `once` is a claim the caller makes about its own path: that this movement can
 * happen at most one time for this source. It is what becomes the entry's
 * dedupe key, so it must only be passed where a repeat would be the same
 * movement arriving twice — a reconciler crediting a completed deposit again —
 * and never where a user may legitimately receive two (a refund, a transfer, a
 * correction).
 */
interface Movement {
  kind: BalanceEntryKind
  /** The document behind it, when one exists yet. */
  sourceId?: string | null
  /** Whether a second booking for this source would be a duplicate. */
  once?: boolean
}

/**
 * The one door onto a user's spendable balance.
 *
 * Every write that moves `balance` goes through here, and every one of them
 * books a row in `tma_balance_entries` on the way. That is the whole point: the
 * balance used to move in eight places through a bare `$inc`, and only three of
 * them left a document behind — a referral transfer, an operator's correction
 * and a sale's stake changed somebody's money and explained nothing to
 * them or to us.
 *
 * **The money wins if the book cannot be written.** The two writes are separate
 * and there is no transaction between them, so one of them has to be able to
 * lose. The movement goes first and the entry follows; a failure to book is
 * logged loudly and swallowed. A movement with no entry is a hole in an
 * explanation, recoverable from the document it came from — an entry with no
 * movement is a lie about somebody's balance, and nothing recovers that.
 *
 * The frozen pot is deliberately outside this. Freezing and unfreezing move the
 * spendable balance and are booked; **committing** a stake moves only
 * `frozenBalance` and is not, because the sum of this book has to equal
 * `balance` and nothing else. `commitFrozenBalance` therefore stays on the
 * repository, where its caller — the sale that staked it — accounts for
 * it in its own document.
 */
@Injectable()
export class BalanceLedgerService {
  private readonly logger = new Logger(BalanceLedgerService.name)

  constructor(
    private readonly userDb: TmaUserDbService,
    private readonly entryDb: TmaBalanceEntryDbService
  ) {}

  /** Adds money to the spendable balance and books why. Returns the new balance. */
  async credit(telegramId: number, amountCents: number, movement: Movement): Promise<number> {
    const balance = await this.userDb.creditBalance(telegramId, amountCents)

    await this.book(telegramId, amountCents, balance, movement)

    return balance
  }

  /**
   * Takes the stake for a sale out of the spendable balance.
   *
   * Books no source, because at the moment this runs there is none: the stake
   * is frozen *before* the order is created, precisely so an order is never
   * created against a balance that could not back it. The refund that ends the
   * order names it; the stake that started it cannot.
   */
  async freeze(
    telegramId: number,
    amountCents: number
  ): Promise<{ balance: number; frozenBalance: number }> {
    const frozen = await this.userDb.freezeBalance(telegramId, amountCents)

    await this.book(telegramId, -amountCents, frozen.balance, {
      kind: BalanceEntryKind.SALE_STAKE
    })

    return frozen
  }

  /**
   * Puts a stake, or what is left of one, back on the spendable balance.
   *
   * Never `once`: an order can refund more than one way — a failed creation, a
   * cancellation, an unfillable tail — and two refunds against one order are
   * two real movements of a user's money, not a retry.
   *
   * `saleId` is optional for the one case that has none: a stake frozen
   * for an order whose insert then failed. There is no document to point at —
   * that is the whole problem — and the entry says what happened all the same.
   */
  async refund(telegramId: number, amountCents: number, saleId?: string): Promise<void> {
    const { balance } = await this.userDb.unfreezeBalance(telegramId, amountCents)

    await this.book(telegramId, amountCents, balance, {
      kind: BalanceEntryKind.SALE_REFUND,
      sourceId: saleId ?? null
    })
  }

  /** Moves referral earnings onto the spendable balance and books the arrival. */
  async transferReferral(
    telegramId: number,
    amountCents: number
  ): Promise<{ referralBalance: number; balance: number }> {
    const balances = await this.userDb.transferReferralToBalance(telegramId, amountCents)

    await this.book(telegramId, amountCents, balances.balance, {
      kind: BalanceEntryKind.REFERRAL_TRANSFER
    })

    return balances
  }

  /**
   * An operator's correction.
   *
   * Booked only when it lands on the spendable balance: a correction to the
   * referral pot is a movement of a different pot, and putting it in this book
   * would put the sum out by exactly that amount. The operator's own audit row
   * records both kinds either way.
   *
   * `null` back means the guarded update matched nothing — no such user, or not
   * enough to debit — and is the caller's to interpret, as it was before.
   */
  async adjust(
    telegramId: number,
    field: 'balance' | 'referralBalance',
    deltaCents: number
  ): Promise<StoredTmaUser | null> {
    const updated = await this.userDb.adjustBalance(telegramId, field, deltaCents)

    if (updated !== null && field === 'balance')
      await this.book(telegramId, deltaCents, updated.balance, {
        kind: BalanceEntryKind.ADMIN_ADJUSTMENT
      })

    return updated
  }

  /**
   * Writes the row, and never lets its failure reach the money.
   *
   * A duplicate — `null` from the repository — is silence on purpose: the entry
   * this asked for is already there, which is what a dedupe key is for.
   */
  private async book(
    telegramId: number,
    amountCents: number,
    balanceAfter: number,
    movement: Movement
  ): Promise<void> {
    const sourceId = movement.sourceId ?? null

    try {
      await this.entryDb.create({
        telegramId,
        kind: movement.kind,
        amountCents,
        balanceAfter,
        sourceId,
        dedupeKey: movement.once === true && sourceId !== null ? `${movement.kind}:${sourceId}` : null
      })
    } catch (error: unknown) {
      // Loud, because the balance has already moved and this row is the only
      // thing that was going to explain it. Recoverable by hand from the source
      // document, which is why it is not worth failing the movement over.
      this.logger.error(
        `Balance moved by ${amountCents} cents for user ${telegramId} ` +
          `(${movement.kind}) but could not be booked: ${describeError(error)}`
      )
    }
  }
}
