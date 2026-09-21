import { TmaDepositStatus, TmaSaleStatus, type AdminOverviewRes } from '@transacto/contracts'
import { Injectable } from '@nestjs/common'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db/services'
import { AdminAlertsService } from 'src/modules/admin/services/admin-alerts.service'
import { disputedCardSaleFilter, startOfToday } from 'src/modules/admin/utils'

/**
 * Statuses that still hold a sale slot, and so count as "open".
 *
 * `BLOCKED` is among them and that is not an oversight: a blocked order keeps
 * its stake frozen and its slot taken until somebody reviews it, so an overview
 * that excluded them would report fewer open orders than the users' own limits
 * are counting.
 */
const OPEN_SALE_STATUSES: readonly TmaSaleStatus[] = [
  TmaSaleStatus.CREATED,
  TmaSaleStatus.TERMINAL_READY,
  TmaSaleStatus.AWAITING_FIAT,
  TmaSaleStatus.CLOSING,
  TmaSaleStatus.BLOCKED
]

/**
 * The numbers the landing screen draws.
 *
 * Every figure is an aggregation, and they all run in parallel — the screen is
 * the first thing an operator opens and a sequence of eleven round trips would
 * be felt. It is recomputed per request rather than cached: the panel has a
 * handful of users, and a cached overview that lags a manual balance correction
 * by thirty seconds is worse than the query it saves.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly depositDbService: TmaDepositDbService,
    private readonly terminalDbService: TerminalDbService,
    private readonly orderDbService: OrderDbService,
    private readonly alertsService: AdminAlertsService
  ) {}

  async build(): Promise<AdminOverviewRes> {
    const since = startOfToday()

    const [
      usersTotal,
      usersActive,
      usersNewToday,
      balances,
      openOrders,
      ordersByStatus,
      completedToday,
      disputed,
      volumeToday,
      depositsPending,
      depositsToday,
      terminals,
      pendingAlerts
    ] = await Promise.all([
      this.userDbService.countAll(),
      this.userDbService.countAll({ isActive: true }),
      this.userDbService.countAll({ createdAt: { $gte: since } }),
      this.userDbService.sumBalances(),
      this.saleDbService.count({ status: { $in: OPEN_SALE_STATUSES } }),
      this.saleDbService.countByStatus(),
      this.saleDbService.count({ status: TmaSaleStatus.COMPLETED, completedAt: { $gte: since } }),
      // One row per *sale*, and the **same filter the dispute chip applies** —
      // a card sale's credential allows one open order at a time, so counting
      // sales is counting disputes. Shared rather than restated, because a
      // dashboard figure that disagrees with the list it links to is worse than
      // no figure at all.
      this.saleDbService.count(disputedCardSaleFilter()),
      this.confirmedTmaVolumeSince(since),
      this.depositDbService.count({ status: TmaDepositStatus.PENDING }),
      this.depositDbService.verifiedSince(since),
      this.terminalDbService.countStates(),
      this.alertsService.countPending()
    ])

    return {
      users: { total: usersTotal, active: usersActive, newToday: usersNewToday },
      balances,
      sales: {
        open: openOrders,
        completedToday,
        volumeToday,
        byStatus: ordersByStatus,
        disputed
      },
      deposits: {
        pending: depositsPending,
        completedToday: depositsToday.count,
        creditedToday: depositsToday.credited
      },
      terminals,
      alerts: { pending: pendingAlerts }
    }
  }

  /**
   * Hryvnia Transacto has confirmed today on the Mini App's own terminals.
   *
   * Orders first, terminals second: a day's confirmed orders touch a handful of
   * cards, while the Mini App's terminals grow by one per sale and never
   * shrink, so asking which of today's cards are ours stays bounded where
   * listing ours first would not.
   */
  private async confirmedTmaVolumeSince(since: Date): Promise<number> {
    const byCard = await this.orderDbService.sumConfirmedByCardSince(since)
    const tmaCards = new Set(
      await this.terminalDbService.findTmaCardIds(byCard.map((row) => row.cardId))
    )

    return byCard.reduce((sum, row) => (tmaCards.has(row.cardId) ? sum + row.volume : sum), 0)
  }
}
