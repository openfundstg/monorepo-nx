import { Injectable, Logger } from '@nestjs/common'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { PageQuery } from 'src/modules/repositories/interfaces'
import type { Migration } from 'src/migrations/interfaces'

/** Users per read. */
const PAGE_SIZE = 200

/** `_id` ascending — stable under concurrent inserts, as in `0001`. */
const BY_ID: PageQuery['sort'] = { _id: 1 }

/**
 * Gives back USDT frozen for sales that were never created.
 *
 * A stake is frozen *before* the order is written, so that no order can exist
 * against a balance that could not back it. If the write then failed, the money
 * stayed frozen with nothing to account for it and no way back: the frozen pot
 * is deliberately out of reach of an operator's correction, and the product
 * only ever unfreezes a stake through the order that took it.
 *
 * It happened for real. `bankType` was validated against a hardcoded list of
 * three banks, so the first NovaPay order died inside Mongoose with the stake
 * already frozen — 142.47 USDT, for one user, unreachable. The creation path
 * now compensates itself; this repairs what it did not.
 *
 * **The arithmetic is the whole migration.** A user's `frozenBalance` should
 * equal the stakes of the orders still holding one — running, closing or
 * blocked. Anything above that is frozen for nothing and comes back. Anything
 * *below* it is left alone and logged: that direction is a different fault
 * entirely and unfreezing is not its fix.
 *
 * Safe to re-run: after a pass the two figures agree, so a second pass finds
 * nothing. It books each release through the same door every other movement
 * goes through, so the balance book explains this too.
 */
@Injectable()
export class ReleaseOrphanedStakesMigration implements Migration {
  readonly name = '0002-release-orphaned-stakes'

  private readonly logger = new Logger(ReleaseOrphanedStakesMigration.name)

  constructor(
    private readonly users: TmaUserDbService,
    private readonly sales: TmaSaleDbService,
    private readonly ledger: BalanceLedgerService
  ) {}

  async up(): Promise<string> {
    let released = 0
    let cents = 0
    let shortfalls = 0

    for (let skip = 0; ; skip += PAGE_SIZE) {
      const { items } = await this.users.findPage(
        { frozenBalance: { $gt: 0 } },
        { skip, limit: PAGE_SIZE, sort: BY_ID }
      )
      if (items.length === 0) break

      for (const user of items) {
        const accounted = await this.sales.sumFrozenStakesByTelegramId(user.telegramId)
        const orphaned = user.frozenBalance - accounted

        if (orphaned === 0) continue

        if (orphaned < 0) {
          // Less frozen than the open orders claim. Not this migration's
          // business and not fixable by unfreezing — it is logged so somebody
          // sees it, and left exactly as it is.
          shortfalls++
          this.logger.warn(
            `telegramId ${user.telegramId} holds ${user.frozenBalance} frozen cents against ` +
              `${accounted} of live stakes — short by ${-orphaned}. Left alone.`
          )
          continue
        }

        await this.ledger.refund(user.telegramId, orphaned)
        released++
        cents += orphaned

        this.logger.log(
          `Returned ${orphaned} orphaned frozen cents to telegramId ${user.telegramId} ` +
            `(frozen ${user.frozenBalance}, live stakes ${accounted})`
        )
      }

      if (items.length < PAGE_SIZE) break
    }

    return (
      `released ${cents} cents to ${released} user(s)` +
      (shortfalls > 0 ? `, ${shortfalls} left short and logged` : '')
    )
  }

  /*
   * No `down`. Re-freezing money that has been handed back is not an undo — the
   * user may have spent it, and there is no order to freeze it against. A
   * mistake here is corrected by a new migration, not by reversing this one.
   */
}
