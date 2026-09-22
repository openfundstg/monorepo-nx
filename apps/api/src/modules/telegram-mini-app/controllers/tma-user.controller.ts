import { Controller, Get, NotFoundException, Req } from '@nestjs/common'
import { ERROR, SaleMethod } from '@transacto/contracts'
import type { BalanceHistoryEntry, UserProfileResponse } from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { toAwaitingJar } from 'src/modules/telegram-mini-app/utils'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import { USER_VISIBLE_BALANCE_KINDS } from 'src/modules/repositories/tma-balance-entry-db/schemas'
import { getTrustLevel } from 'src/shared/constants'

/**
 * How many hryvnia top-ups the timeline carries.
 *
 * The other two reads are unbounded, which is its own problem — but this one is
 * new and need not inherit it. A user who has taken a hundred payouts does not
 * need all of them on a dashboard.
 */
const FIAT_HISTORY_LIMIT = 50

/**
 * How much of each older kind the timeline carries.
 *
 * The other two reads used to be unbounded — every deposit and every sale
 * a user had ever made, sorted in this process, on every dashboard open.
 * That is fine for a hundred rows and is not a shape to leave lying around; the
 * screen shows a list nobody scrolls to the end of.
 */
const HISTORY_LIMIT = 50

@Controller('tma/user')
export class TmaUserController {
  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly depositDbService: TmaDepositDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly fiatDepositDbService: TmaFiatDepositDbService,
    private readonly balanceEntryDbService: TmaBalanceEntryDbService
  ) {}

  /**
   * GET /api/tma/user/profile
   * Returns full user profile with trust level.
   */
  @Get('profile')
  @UserTypeTMA()
  async getProfile(@Req() req: TmaAuthenticatedRequest): Promise<UserProfileResponse> {
    const tmaUser = req.tmaUser
    const user = await this.userDbService.findByTelegramId(tmaUser.id)
    // Was a `{ error: '...' }` body with HTTP 200, which every client read as a
    // successful response and then dereferenced into a crash.
    if (!user) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)

    const trustLevel = getTrustLevel(user.totalTurnover)
    // The dashboard's copy of the create form's list. A user who is not trying
    // to start a sale never opens the form, so without this the first they hear
    // of a slot being held is the moment they are refused one.
    const awaitingJar = await this.saleDbService.findAwaitingJarClosureByTelegramId(
      tmaUser.id
    )

    return {
      user: {
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        balance: user.balance,
        // Declared on the shared TmaUser contract but omitted here, so the
        // dashboard's frozen row read `undefined` and never rendered.
        frozenBalance: user.frozenBalance,
        totalTurnover: user.totalTurnover,
        isActive: user.isActive,
        referralBalance: user.referralBalance,
        totalReferralEarned: user.totalReferralEarned,
        showNameToReferrer: user.showNameToReferrer
      },
      trustLevel: trustLevel.level,
      maxParallelOrders: trustLevel.maxParallelOrders,
      slotsAwaitingJarClosure: awaitingJar.map(toAwaitingJar)
    }
  }

  /**
   * GET /api/tma/user/balance-history
   *
   * One timeline of everything that moved, or is moving, this user's balance:
   * crypto deposits, hryvnia top-ups, sales and the movements that
   * belong to no process at all, newest first.
   *
   * The first three are read as *processes*, not as money: a deposit the user
   * can open and a sale they can follow are worth more on this list
   * than the arithmetic they book, and a completed order would otherwise
   * arrive as a stake and a refund. The fourth read is the balance book, for
   * the two kinds that have no document anywhere — a referral transfer and an
   * operator's correction. Those used to change the balance and appear on no
   * screen, which is the whole reason the book exists.
   */
  @Get('balance-history')
  @UserTypeTMA()
  async getBalanceHistory(
    @Req() req: TmaAuthenticatedRequest
  ): Promise<{ history: BalanceHistoryEntry[] }> {
    const tmaUser = req.tmaUser
    const telegramId = tmaUser.id

    const [deposits, fiatDeposits, sales, movements] = await Promise.all([
      this.depositDbService.findByTelegramId(telegramId, HISTORY_LIMIT),
      this.fiatDepositDbService.findByTelegramId(telegramId, FIAT_HISTORY_LIMIT),
      this.saleDbService.findByTelegramId(telegramId, HISTORY_LIMIT),
      this.balanceEntryDbService.findByKinds(
        telegramId,
        USER_VISIBLE_BALANCE_KINDS,
        HISTORY_LIMIT
      )
    ])

    // Merge into a unified timeline
    const history: BalanceHistoryEntry[] = [
      ...deposits.map((deposit) => ({
        type: 'deposit' as const,
        id: deposit._id.toString(),
        amount: deposit.fiatEquivalent,
        cryptoAmount: deposit.cryptoAmount,
        status: deposit.status,
        createdAt: this.createdAt(deposit)
      })),
      ...fiatDeposits.map((deposit) => ({
        type: 'fiat_deposit' as const,
        id: deposit._id.toString(),
        // The hryvnia the user actually transfers is the figure they recognise,
        // so it is the one on the row; the USDT rides along beside it.
        amount: deposit.amountUah,
        cryptoCents: deposit.cryptoCents,
        coveredUah: deposit.coveredUah,
        status: deposit.status,
        createdAt: this.createdAt(deposit)
      })),
      ...sales.map((order) => ({
        type: 'sale' as const,
        id: order._id.toString(),
        publicId: order.publicId,
        // The hryvnia that actually arrived: the target, less the tail a
        // completed order handed back — `settleSale`'s `settledFiat`, as it
        // was booked. Nothing writes that tail on any other state, so an
        // order still running shows its target. `?? 0` because a lean read
        // applies no default to orders stored before the field.
        amount: order.fiatAmount - (order.refundedRemainderFiat ?? 0),
        // What left the balance: the stake, less the tail a completed order
        // handed back.
        stakeUsdtCents: order.frozenUsdt - order.refundedRemainderUsdt,
        bankType: order.bankType,
        // Where the hryvnia went, which is what the row's own mark says. `??`
        // because a lean read applies no default to orders stored before the
        // card variant existed — and a jar is what those were.
        saleMethod: order.saleMethod ?? SaleMethod.JAR,
        status: order.status,
        // On the list so the two kinds are distinguishable without opening
        // each one — they end differently enough that "which was this?" is a
        // question the history has to answer.
        remainderPolicy: order.remainderPolicy,
        createdAt: this.createdAt(order)
      })),
      ...movements.map((movement) => ({
        type: 'balance_movement' as const,
        id: movement._id.toString(),
        kind: movement.kind,
        // Signed, as it is stored: a debited correction has to read as one.
        cryptoCents: movement.amountCents,
        createdAt: this.createdAt(movement)
      }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return { history }
  }

  /**
   * `timestamps: true` puts `createdAt` on the document but not on the class
   * Mongoose infers its type from, so it is read through a narrow cast rather
   * than by widening every schema.
   */
  private createdAt(document: unknown): string {
    const value = (document as { createdAt?: Date | string }).createdAt

    return value instanceof Date ? value.toISOString() : (value ?? new Date().toISOString())
  }
}
