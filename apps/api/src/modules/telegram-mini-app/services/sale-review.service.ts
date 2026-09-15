import { ERROR, SaleEventType, TmaSaleStatus } from '@transacto/contracts'
import { ConflictException, Injectable, Logger } from '@nestjs/common'
import type { Types } from 'mongoose'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { ensure } from 'src/shared/utils'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleTerminalService } from 'src/modules/telegram-mini-app/services/sale-terminal.service'

type StoredSale = TmaSale & { _id: Types.ObjectId }

/**
 * The two ways a blocked sale can be reviewed by a person.
 *
 * A block is deliberately a dead end for the automatic pipeline: the terminal
 * is stood down, the stake stays frozen and the slot stays taken, because
 * releasing any of that on a rule the system decided by itself would make
 * breaking the rule free. Nothing in the product ever undid one.
 *
 * **This lives here rather than in the admin module on purpose.** It moves a
 * user's frozen stake, brings a Transacto credential back up and pushes to the
 * user's own screen — every one of which is this module's business. The admin
 * module supplies the operator, the reason and the audit row, and calls these
 * two methods; a second implementation over there would be a second settlement
 * path for the same money.
 *
 * Both methods flip the status **first**. That flip is the idempotency gate, so
 * two operators pressing at once produce one transition and the second is told
 * the order is no longer blocked — rather than bringing a second terminal up or
 * refunding a stake twice.
 */
@Injectable()
export class SaleReviewService {
  private readonly logger = new Logger(SaleReviewService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly cancelService: SaleCancelService,
    private readonly terminalService: SaleTerminalService,
    private readonly progressService: SaleProgressService,
    private readonly tmaGateway: TmaGateway
  ) {}

  /**
   * Puts a blocked order back to work.
   *
   * Nothing about the money changes: the stake stays frozen because the order
   * has not ended. The terminal comes back up on Transacto — possible only
   * because a teardown stands a credential down rather than deleting it.
   *
   * **Throws if the terminal cannot be brought back.** An order marked live
   * whose terminal is still stood down is one no payer can reach, and the
   * operator has to know that rather than read a green result. The status flip
   * stands either way, which is the recoverable direction: a live order with a
   * dead terminal is visible and can be released, whereas a terminal live under
   * a blocked order is money nobody is watching.
   */
  async resume(order: StoredSale): Promise<StoredSale> {
    const saleId = order._id.toString()

    const resumed = ensure(
      await this.saleDbService.resumeIfBlocked(saleId),
      new ConflictException(ERROR.SALE.NOT_CANCELLABLE)
    )

    await this.terminalService.enable(resumed, 'Resumed after review')

    const withEvent = await this.saleDbService.appendEvent(saleId, {
      type: SaleEventType.RESUMED_BY_ADMIN,
      at: Date.now()
    })

    this.tmaGateway.emitSaleStatusChange(
      order.telegramId,
      saleId,
      TmaSaleStatus.AWAITING_FIAT
    )
    if (withEvent) await this.progressService.emit(withEvent)

    this.logger.warn(
      `Sale ${order.publicId} resumed after review for telegramId ${order.telegramId}; ` +
        `${order.frozenUsdt} cents stay frozen and the terminal is back in service`
    )

    return resumed
  }

  /**
   * Ends a blocked order and gives the stake back.
   *
   * `refundOverride` is the operator's own figure in USDT cents, or `undefined`
   * to use the one the product would have computed — the stake less whatever
   * the jar already delivered. The settlement itself is
   * {@link SaleCancelService.settleClosed}, the same code a user's own
   * cancellation runs, so the two cannot diverge on how money is unwound.
   */
  async release(order: StoredSale, refundOverride?: number): Promise<void> {
    const saleId = order._id.toString()

    ensure(
      await this.saleDbService.cancelIfBlocked(saleId),
      new ConflictException(ERROR.SALE.NOT_CANCELLABLE)
    )

    // The pre-flip document, deliberately: `settleClosed` reads the figures the
    // refund is computed from, and the flip above changed only the status.
    const result = await this.cancelService.settleClosed(
      order,
      SaleEventType.RELEASED_BY_ADMIN,
      refundOverride
    )

    this.logger.warn(
      `Sale ${order.publicId} released after review for telegramId ` +
        `${order.telegramId}: refunded ${result.refunded} cents of a ${order.frozenUsdt} stake`
    )
  }
}
