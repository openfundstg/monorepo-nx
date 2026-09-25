import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ERROR, isDemoEligible } from '@transacto/contracts'
import { TmaUserDbService, type StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { isDemoAccount } from 'src/modules/telegram-mini-app/utils'
import { ensure } from 'src/shared/utils'

/**
 * Whether an account is a demo account, and switching it over or back.
 *
 * One owner for both halves, because they are one rule: a demo account can
 * change nothing, so it may only be made from an account that has nothing to
 * lose by that. `DemoReadOnlyGuard` asks the first question on every write;
 * the admin panel delegates the second here rather than deciding it itself.
 */
@Injectable()
export class DemoAccountService {
  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly depositDbService: TmaDepositDbService,
    private readonly fiatDepositDbService: TmaFiatDepositDbService
  ) {}

  /** Whether writes from this account must be refused. */
  async isDemo(telegramId: number): Promise<boolean> {
    return this.userDbService.isDemo(telegramId)
  }

  /**
   * Makes an account a demo account, only while it has nothing to lose by it.
   *
   * `isDemoEligible` against what is stored, and the write repeats its balance
   * half in its own filter, so a deposit credited since the read matches
   * nothing and is refused the same way. An account that already is one is
   * returned as it stands.
   *
   * **What is in flight is looked for after the write, not before it.**
   * Reserving a hryvnia top-up or announcing a USDT deposit moves no balance,
   * so no filter on the user can see either — but once the flag is down the
   * guard refuses the account both. So an operation not on record by the time
   * this looks was not started before the flag and cannot be started after it;
   * one that is on record puts the flag back and refuses — back to `false`,
   * which is what it was, since an account that was a demo returned above.
   * What is left is a request already past the guard and still being written
   * in that same second, and switching the demo off lets it through.
   */
  async enable(telegramId: number): Promise<StoredTmaUser> {
    const user = ensure(
      await this.userDbService.findByTelegramId(telegramId),
      new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    )
    if (isDemoAccount(user)) return user

    const openOrders = await this.saleDbService.countOpenByTelegramIds([telegramId])
    const eligible = isDemoEligible({
      balance: user.balance,
      frozenBalance: user.frozenBalance,
      openOrders: openOrders[telegramId] ?? 0
    })
    if (!eligible) throw new ConflictException(ERROR.ADMIN.DEMO_ACCOUNT_NOT_EMPTY)

    const marked = ensure(
      await this.userDbService.markDemoIfEmpty(telegramId),
      new ConflictException(ERROR.ADMIN.DEMO_ACCOUNT_NOT_EMPTY)
    )

    if (await this.hasPaymentInFlight(telegramId)) {
      await this.userDbService.unmarkDemo(telegramId)
      throw new ConflictException(ERROR.ADMIN.DEMO_ACCOUNT_NOT_EMPTY)
    }

    return marked
  }

  /** Makes a demo account an ordinary one again — always allowed. */
  async disable(telegramId: number): Promise<StoredTmaUser> {
    return ensure(
      await this.userDbService.unmarkDemo(telegramId),
      new NotFoundException(ERROR.TMA_USER.NOT_FOUND)
    )
  }

  /**
   * A hryvnia top-up waiting on its receipt, or a USDT deposit waiting on its
   * transfer — money a demo account could no longer claim.
   */
  private async hasPaymentInFlight(telegramId: number): Promise<boolean> {
    const [depositPending, topUp] = await Promise.all([
      this.depositDbService.hasPending(telegramId),
      this.fiatDepositDbService.findActiveByTelegramId(telegramId)
    ])

    return depositPending || topUp !== null
  }
}
