import { Injectable, Logger } from '@nestjs/common'
import { Types } from 'mongoose'
import { SaleBlockReason, SaleEventType } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleTerminalService } from 'src/modules/telegram-mini-app/services/sale-terminal.service'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'

/** A lean order document plus its id — what the checks hand over. */
type StoredSale = TmaSale & { _id: Types.ObjectId }

/**
 * Stops a sale that broke a rule, and takes its terminal down with it.
 *
 * Blocking is not failing. A failed order is our own creation path breaking and
 * refunds the stake; a blocked order is the user's setup being wrong or abusive,
 * so **the frozen USDT deliberately stays frozen** pending review. Releasing it
 * automatically would make every rule here free to break — and re-freezing it
 * afterwards is not something the balance ledger can do.
 *
 * The terminal goes down on Transacto as well as locally. Leaving it enabled
 * upstream would keep Transacto routing payers to a jar we have stopped
 * watching, and the next terminals sync would read `enable_orders` back and
 * quietly re-enable the local row.
 */
@Injectable()
export class SaleBlockService {
  private readonly logger = new Logger(SaleBlockService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly terminalService: SaleTerminalService,
    private readonly progressService: SaleProgressService,
    private readonly tmaGateway: TmaGateway
  ) {}

  /**
   * Blocks the order, then tears down its terminal.
   *
   * Order matters: the status flip is the idempotency gate, so it runs first
   * and everything after it happens exactly once no matter how many scrapes
   * spotted the same violation at the same moment. Returns `false` when another
   * caller got there first, which is a normal outcome rather than an error.
   *
   * Never throws. Every caller is on the scraper's hot path, where an
   * exception would abort a scrape that has nothing to do with this order.
   */
  async block(
    order: StoredSale,
    reason: SaleBlockReason,
    observedGoal: number | null = null
  ): Promise<boolean> {
    const orderId = order._id.toString()

    try {
      const blocked = await this.saleDbService.blockIfOpen(orderId, reason, observedGoal)
      if (!blocked) {
        this.logger.debug(`Sale ${orderId} was already closed; nothing to block`)
        return false
      }

      this.logger.warn(
        `🚫 Sale ${order.publicId} blocked (${reason}) for telegramId ${order.telegramId}. ` +
          `Frozen ${order.frozenUsdt} cents stay frozen pending review.`
      )

      await this.terminalService.disable(order, 'Blocked')

      // The observed goal rides on the event so the timeline can show what the
      // jar actually said, next to what it had to say.
      const withEvent = await this.saleDbService.appendEvent(orderId, {
        type: SaleEventType.BLOCKED,
        ...(observedGoal !== null ? { amount: observedGoal } : {}),
        at: Date.now()
      })

      this.tmaGateway.emitSaleStatusChange(
        order.telegramId,
        orderId,
        TmaSaleStatus.BLOCKED
      )
      if (withEvent) await this.progressService.emit(withEvent)

      return true
    } catch (error: unknown) {
      this.logger.error(
        `Failed to block sale ${orderId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return false
    }
  }
}
