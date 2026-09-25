import {
  AdminAuditAction,
  AdminAuditTargetType,
  AdminBalanceOperation,
  AdminBalanceTarget,
  AdminWsEventNames,
  ERROR,
  type AdminAdjustBalanceReq,
  type AdminAdjustBalanceRes,
  type AdminPageReq,
  type AdminPaginatedRes,
  type AdminReferralEarningListItem,
  type AdminSetUserActiveReq,
  type AdminSetUserDemoReq,
  type AdminTmaUserDetailRes,
  type AdminTmaUserListItem
} from '@transacto/contracts'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common'
import type { QueryFilter } from 'mongoose'
import { TmaUserDbService, type StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import { TmaSaleStatus } from '@transacto/contracts'
import type { AdminPrincipal } from 'src/shared/interfaces'
import { ADMIN_PAGE, ADMIN_SORTABLE } from 'src/modules/admin/constants'
import { clampLimit } from 'src/modules/admin/dto'
import { containsRegex } from 'src/shared/utils'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import { AdminAuditService } from 'src/modules/admin/services/admin-audit.service'
import {
  displayName,
  toAdminDeposit,
  toAdminReferralEarning,
  toAdminSale,
  toAdminUser,
  toPageQuery,
  toPaginatedRes
} from 'src/modules/admin/utils'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'
import { DemoAccountService } from 'src/modules/telegram-mini-app/services/demo-account.service'
import { isDemoAccount } from 'src/modules/telegram-mini-app/utils'

/**
 * Everything the panel does with Mini App users and their money.
 *
 * Referral payouts live here rather than in a service of their own: they are a
 * user's money seen from the other side, they are read through the same
 * name-resolution the user lists need, and splitting them would duplicate that
 * lookup rather than isolate anything.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name)

  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly depositDbService: TmaDepositDbService,
    private readonly referralDbService: TmaReferralDbService,
    private readonly auditService: AdminAuditService,
    private readonly gateway: AdminGateway,
    private readonly balanceLedger: BalanceLedgerService,
    private readonly demoAccounts: DemoAccountService
  ) {}

  // --- Reads ----------------------------------------------------------------

  async list(request: AdminPageReq): Promise<AdminPaginatedRes<AdminTmaUserListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const page = await this.userDbService.findPage(
      this.searchFilter(request.search),
      toPageQuery(paging, ADMIN_SORTABLE.USERS)
    )

    // One aggregation for the whole page rather than a count per row — twenty
    // rows would otherwise be twenty round trips.
    const openOrders = await this.saleDbService.countOpenByTelegramIds(
      page.items.map((user) => user.telegramId)
    )

    return toPaginatedRes(page, paging, (user) =>
      toAdminUser(user, openOrders[user.telegramId] ?? 0)
    )
  }

  async detail(telegramId: number): Promise<AdminTmaUserDetailRes> {
    const user = await this.requireUser(telegramId)

    const [
      openOrders,
      salesTotal,
      salesCompleted,
      depositsTotal,
      depositedTotal,
      deposits,
      referrals,
      referralEarnedTotal,
      recentOrders
    ] = await Promise.all([
      this.saleDbService.countOpenByTelegramIds([telegramId]),
      this.saleDbService.count({ telegramId }),
      this.saleDbService.count({ telegramId, status: TmaSaleStatus.COMPLETED }),
      this.depositDbService.count({ telegramId }),
      // Aggregated across every credited deposit, not summed from the preview
      // below — that would understate any user with more than ten of them.
      this.depositDbService.sumCreditedForUser(telegramId),
      this.depositDbService.findPage(
        { telegramId },
        { skip: 0, limit: ADMIN_PAGE.DETAIL_PREVIEW, sort: { createdAt: -1 } }
      ),
      this.userDbService.findByReferrer(telegramId),
      this.referralDbService.sumForReferrer(telegramId),
      this.saleDbService.findPage(
        { telegramId },
        { skip: 0, limit: ADMIN_PAGE.DETAIL_PREVIEW, sort: { createdAt: -1 } }
      )
    ])

    const name = displayName(user, telegramId)

    return {
      user: toAdminUser(user, openOrders[telegramId] ?? 0),
      stats: {
        salesTotal,
        salesCompleted,
        depositsTotal,
        depositedTotal,
        referralsCount: referrals.length,
        referralEarnedTotal
      },
      recentSales: recentOrders.items.map((order) => toAdminSale(order, name)),
      recentDeposits: deposits.items.map((deposit) => toAdminDeposit(deposit, name))
    }
  }

  /**
   * The referral ledger, across every referrer.
   *
   * Both sides of each row are named, which is two lookups per page rather than
   * per row: the ids are collected first and resolved in one query.
   */
  async listReferralEarnings(
    request: AdminPageReq
  ): Promise<AdminPaginatedRes<AdminReferralEarningListItem>> {
    const limit = clampLimit(request.limit)
    const paging = { ...request, limit }

    const filter: QueryFilter<{ referrerTelegramId: number; referredTelegramId: number }> = {}
    const asNumber = Number(request.search)
    if (request.search && Number.isFinite(asNumber))
      filter.$or = [{ referrerTelegramId: asNumber }, { referredTelegramId: asNumber }]

    const page = await this.referralDbService.findPage(
      filter,
      toPageQuery(paging, ADMIN_SORTABLE.REFERRALS)
    )

    const name = await this.namerFor(
      page.items.flatMap((row) => [row.referrerTelegramId, row.referredTelegramId])
    )

    return toPaginatedRes(page, paging, (row) =>
      toAdminReferralEarning(row, name(row.referrerTelegramId), name(row.referredTelegramId))
    )
  }

  // --- Writes ---------------------------------------------------------------

  async setActive(
    telegramId: number,
    request: AdminSetUserActiveReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminTmaUserListItem> {
    const updated = await this.userDbService.setActive(telegramId, request.isActive)
    if (!updated) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)

    await this.auditService.record({
      actor: admin.username,
      action: request.isActive
        ? AdminAuditAction.USER_ACTIVATED
        : AdminAuditAction.USER_DEACTIVATED,
      targetType: AdminAuditTargetType.TMA_USER,
      targetId: String(telegramId),
      reason: request.reason,
      ip
    })

    this.logger.log(
      `Admin ${admin.username} ${request.isActive ? 'activated' : 'deactivated'} ` +
        `user ${telegramId}: ${request.reason}`
    )

    return this.publish(updated)
  }

  /**
   * Makes a promoter's account a demo account, or an ordinary one again.
   *
   * The rule — who may become one, and what is checked on the way — belongs
   * to `DemoAccountService`, like every other operation this panel performs
   * on somebody's account. What stays here is the operator's side: the reason,
   * the audit row and the row pushed to every open panel.
   *
   * **A switch to where the account already is changes nothing and records
   * nothing.** A stale row, or two operators at once, would otherwise put a
   * decision on the audit trail that never took effect — and that trail is the
   * only record of whose campaign an account was switched for.
   */
  async setDemo(
    telegramId: number,
    request: AdminSetUserDemoReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminTmaUserListItem> {
    const current = await this.requireUser(telegramId)
    if (isDemoAccount(current) === request.isDemo) return this.rowOf(current)

    const updated = request.isDemo
      ? await this.demoAccounts.enable(telegramId)
      : await this.demoAccounts.disable(telegramId)

    await this.auditService.record({
      actor: admin.username,
      action: request.isDemo
        ? AdminAuditAction.USER_DEMO_ENABLED
        : AdminAuditAction.USER_DEMO_DISABLED,
      targetType: AdminAuditTargetType.TMA_USER,
      targetId: String(telegramId),
      reason: request.reason,
      ip
    })

    this.logger.log(
      `Admin ${admin.username} ${request.isDemo ? 'enabled' : 'disabled'} ` +
        `the demo on user ${telegramId}: ${request.reason}`
    )

    return this.publish(updated)
  }

  /**
   * Moves money onto or off a user's balance by hand.
   *
   * The direction is taken from {@link AdminBalanceOperation} and turned into a
   * signed delta exactly once, here. The repository's `$gte` guard is what makes
   * a debit safe under concurrency, so a `null` back from it means the money was
   * not there — and this is the one place that can tell that apart from "no such
   * user", which it does by looking the user up only on that path.
   */
  async adjustBalance(
    telegramId: number,
    request: AdminAdjustBalanceReq,
    admin: AdminPrincipal,
    ip: string
  ): Promise<AdminAdjustBalanceRes> {
    // The DTO already refuses zero and negatives; this catches a caller that
    // reached the service another way rather than trusting the pipe alone.
    if (!Number.isInteger(request.amountCents) || request.amountCents <= 0)
      throw new BadRequestException(ERROR.ADMIN.INVALID_AMOUNT)

    const field =
      request.target === AdminBalanceTarget.REFERRAL_BALANCE ? 'referralBalance' : 'balance'
    const delta =
      request.operation === AdminBalanceOperation.DEBIT ? -request.amountCents : request.amountCents

    const before = await this.requireUser(telegramId)
    const updated = await this.balanceLedger.adjust(telegramId, field, delta)

    // The user existed a moment ago, so the only way the guarded update matched
    // nothing is that the balance was too low for the debit.
    if (!updated) throw new ConflictException(ERROR.ADMIN.INSUFFICIENT_BALANCE)

    await this.auditService.record({
      actor: admin.username,
      action: AdminAuditAction.USER_BALANCE_ADJUSTED,
      targetType: AdminAuditTargetType.TMA_USER,
      targetId: String(telegramId),
      reason: request.reason,
      // Both figures, so the row explains itself without the reader having to
      // find the correction that came before it.
      metadata: {
        target: request.target,
        operation: request.operation,
        amountCents: request.amountCents,
        before: before[field],
        after: updated[field]
      },
      ip
    })

    this.logger.warn(
      `Admin ${admin.username} ${request.operation} ${request.amountCents} cents ` +
        `on ${field} of user ${telegramId} (${before[field]} → ${updated[field]}): ${request.reason}`
    )

    await this.publish(updated)

    return {
      balance: updated.balance,
      frozenBalance: updated.frozenBalance,
      referralBalance: updated.referralBalance
    }
  }

  /**
   * Pushes a user's row to every open panel and hands it back to the caller.
   *
   * One place rather than two so the row a client receives over the socket is
   * byte-identical to the one the HTTP response carries — a live patch that
   * disagrees with the next refresh is the bug this shape avoids.
   */
  private async publish(user: StoredTmaUser): Promise<AdminTmaUserListItem> {
    const item = await this.rowOf(user)

    this.gateway.emit(AdminWsEventNames.USER_UPDATED, { user: item })

    return item
  }

  /** One user as a list row, with the count of sales holding a slot. */
  private async rowOf(user: StoredTmaUser): Promise<AdminTmaUserListItem> {
    const openOrders = await this.saleDbService.countOpenByTelegramIds([user.telegramId])

    return toAdminUser(user, openOrders[user.telegramId] ?? 0)
  }

  private async requireUser(telegramId: number): Promise<StoredTmaUser> {
    const user = await this.userDbService.findByTelegramId(telegramId)
    if (!user) throw new NotFoundException(ERROR.TMA_USER.NOT_FOUND)

    return user
  }

  /**
   * One user as a list row, for the pages that embed them.
   *
   * The same shape the users list carries — and produced by the same mapper —
   * so a sale's page and the users list cannot disagree about somebody's
   * balance or their trust level. `null` where the id names no Mini App
   * account, which a support row legitimately can: somebody may write to the
   * bot without ever opening the app.
   */
  async userRow(telegramId: number): Promise<AdminTmaUserListItem | null> {
    const [user, openOrders] = await Promise.all([
      this.userDbService.findByTelegramId(telegramId),
      this.saleDbService.countOpenByTelegramIds([telegramId])
    ])

    return user === null ? null : toAdminUser(user, openOrders[telegramId] ?? 0)
  }

  /**
   * What to call each of a batch of people, resolved in one query.
   *
   * **A function, not the map**, and the difference is the fallback. Every list
   * that names somebody beside a row from another collection has to answer the
   * same question — what if there is no user row? — and the answer is always
   * "their id". Written at each call site it was `names.get(x) ?? String(x)`
   * eight times, which is eight chances for the ninth to render `undefined`
   * next to somebody's money.
   *
   * There legitimately is no row sometimes: a support thread belongs to
   * whoever wrote to the bot, and writing to the bot does not create a Mini App
   * account.
   */
  async namerFor(telegramIds: readonly number[]): Promise<(telegramId: number) => string> {
    const unique = [...new Set(telegramIds)]
    const users = await this.userDbService.findManyByTelegramIds(unique)
    const names = new Map(
      users.map((user) => [user.telegramId, displayName(user, user.telegramId)])
    )

    return (telegramId) => names.get(telegramId) ?? String(telegramId)
  }

  /**
   * One search box across the fields an operator actually has to hand.
   *
   * A numeric term is matched against `telegramId` as well as the text fields —
   * an operator pasting an id should not have to say which column it is.
   */
  private searchFilter(search: string | undefined): QueryFilter<StoredTmaUser> {
    if (!search) return {}

    const pattern = containsRegex(search)
    const asNumber = Number(search)

    return {
      $or: [
        { username: pattern },
        { firstName: pattern },
        { lastName: pattern },
        { referralCode: pattern },
        ...(Number.isFinite(asNumber) ? [{ telegramId: asNumber }] : [])
      ]
    }
  }
}
