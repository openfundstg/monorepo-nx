import { Injectable, Logger } from '@nestjs/common'
import {
  SaleMethod,
  saleCardMaxOrders,
  saleCardMinOrderKopecks,
  SaleRemainderPolicy
} from '@transacto/contracts'
import type { SaleProgress, SaleEvent } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { OrderDbService } from 'src/modules/repositories/order-db'
import type { StoredSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { awaitsStatementCheckpoint, parseMinOrderKopecks,
  transactoOrderFloorKopecks, saleDeliveredFiat } from 'src/shared/utils'

/** What every read path here works with: a lean order document plus its id. */

/**
 * Turns a sale into the snapshot the Mini App renders, and pushes it.
 *
 * Deliberately snapshot-based rather than a delta feed. The extension's history
 * page streams deltas and pays for it: it has no dedupe, an event arriving
 * between its HTTP fetch and its socket subscription is silently dropped, and a
 * reconnect leaves a permanent hole in the list. Sending complete state means
 * the client replaces instead of merging, so a dropped or duplicated push is
 * self-healing and `GET .../progress` and the socket cannot disagree.
 *
 * Holds no listeners of its own — {@link SaleProgressListener} owns those
 * — so the facade can depend on this without a dependency cycle.
 */
@Injectable()
export class SaleProgressService {
  private readonly logger = new Logger(SaleProgressService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly orderDbService: OrderDbService,
    private readonly tmaGateway: TmaGateway
  ) {}

  /**
   * What has been asked for and has not arrived — orders routed to this jar
   * and still open.
   *
   * One indexed query per push. It is worth it: without it the bar sits still
   * while three payers are mid-transfer, which reads as a stalled sale rather
   * than a busy one.
   */
  private async pendingAmount(order: StoredSale): Promise<number> {
    if (order.cardId === null || order.cardId === undefined) return 0

    const pending = await this.orderDbService.getPendingOrdersForCard(order.cardId)

    return pending.reduce((sum, waiting) => sum + waiting.amount, 0)
  }

  /**
   * Whether the user may stop this order right now.
   *
   * Answered here rather than left to the endpoint so the button matches what
   * would actually happen. It costs one indexed lookup per snapshot, which the
   * honesty is worth: a control that is visible but always refuses is worse
   * than one that is plainly disabled.
   *
   * Duplicated deliberately from `SaleCancelService` rather than
   * injected — that service depends on this one to push the snapshot, and
   * calling back the other way would close a cycle.
   *
   * Outstanding payments used to make this false. They no longer decide whether
   * a stop may be asked for, only how it happens: an order with payments in
   * play winds down rather than ending on the spot.
   */
  private canCancel(order: StoredSale): boolean {
    return (
      order.status === TmaSaleStatus.CREATED ||
      order.status === TmaSaleStatus.TERMINAL_READY ||
      order.status === TmaSaleStatus.AWAITING_FIAT
    )
  }

  /**
   * Whether the screen has to ask the user to close their jar.
   *
   * The order is done deciding — stopped, or finished — and the jar behind it
   * is still open. Nobody else can close it, so this is the one thing standing
   * between the user and both their next sale and, for an order they
   * stopped themselves, their stake.
   *
   * `cardId === null` means there is no jar: the order never got a terminal, so
   * there is nothing to ask for.
   */
  private awaitsJarClosure(order: StoredSale): boolean {
    if (order.cardId === null) return false
    if (order.jarClosedAt) return false

    return (
      order.status === TmaSaleStatus.CLOSING ||
      order.status === TmaSaleStatus.COMPLETED ||
      order.status === TmaSaleStatus.CANCELLED
    )
  }

  /**
   * Builds the snapshot.
   *
   * Nothing about the terminal's pending orders is included: it is operational
   * detail about the trader's pipeline, not something the Mini App user has any
   * use for, and shipping it would leak the shape of that pipeline to a client
   * that never renders it.
   */
  async build(order: StoredSale): Promise<SaleProgress> {
    const events: SaleEvent[] = (order.events ?? []).map((event) => ({
      type: event.type,
      ...(event.amount !== null && event.amount !== undefined ? { amount: event.amount } : {}),
      ...(event.orderId !== null && event.orderId !== undefined ? { orderId: event.orderId } : {}),
      at: event.at
    }))

    return {
      saleId: order._id.toString(),
      publicId: order.publicId,
      status: order.status,
      targetAmount: order.fiatAmount,
      jarBalance: order.jarBalance ?? null,
      receivedAmount: order.receivedAmount ?? 0,
      // Decided here so the screen never recombines two numbers into a third.
      // `saleDeliveredFiat` is the one statement of what "taken in"
      // means, and the settlement path already reads it.
      deliveredAmount: saleDeliveredFiat(order),
      pendingAmount: await this.pendingAmount(order),
      events,
      blockReason: order.blockReason ?? null,
      canCancel: this.canCancel(order),
      // Only ever true for an order that is over, or winding down — a
      // running order's jar is supposed to be open.
      awaitingJarClosure: this.awaitsJarClosure(order),
      // `.lean()` does not apply Mongoose defaults to documents stored before
      // the field existed, so the fallback is the read, not a formality.
      remainderPolicy: order.remainderPolicy ?? SaleRemainderPolicy.WAIT_FOR_TOP_UP,
      // Written by `completeIfOpen` in the same update that completes the
      // order, so the push announcing completion already carries it.
      refundedRemainderUsdt: order.refundedRemainderUsdt ?? 0,
      ...this.cardFields(order),
      updatedAt: Date.now()
    }
  }

  /**
   * The half of the snapshot only a card sale has.
   *
   * Spread in rather than always present, so a jar sale's snapshot is byte for
   * byte what it was — the card variant must not change what an existing screen
   * receives.
   *
   * **`saleMethod` cannot be inferred from the rest**, which is why it is sent.
   * A card sale before its first order and a jar sale that has never been
   * scraped both show `jarBalance: null`, and they need opposite screens.
   *
   * The two limits are sent rather than recomputed on the client for the reason
   * every shared figure here is: the same arithmetic produced the credential's
   * `min_amount` upstream, and a screen naming a different number would be
   * describing a product that does not exist.
   */
  private cardFields(order: StoredSale): Partial<SaleProgress> {
    if (order.saleMethod !== SaleMethod.CARD) return {}

    const floorKopecks = transactoOrderFloorKopecks()

    return {
      saleMethod: SaleMethod.CARD,
      cardOrders: (order.cardOrders ?? []).map((cardOrder) => ({
        orderId: cardOrder.orderId,
        amount: cardOrder.amount,
        state: cardOrder.state,
        arrivedAt: cardOrder.arrivedAt.toISOString(),
        confirmDeadlineAt: cardOrder.confirmDeadlineAt.toISOString(),
        answeredAt: cardOrder.answeredAt?.toISOString() ?? null,
        declaredAmount: cardOrder.declaredAmount,
        statements: (cardOrder.statements ?? []).map((statement) => ({
          id: statement._id.toString(),
          status: statement.status,
          rejection: statement.rejection ?? null,
          uploadedAt: statement.uploadedAt.toISOString(),
          periodFrom: statement.periodFrom?.toISOString() ?? null,
          periodTo: statement.periodTo?.toISOString() ?? null
        }))
      })),
      cardMinOrderKopecks: saleCardMinOrderKopecks(order.fiatAmount, floorKopecks),
      cardMaxOrders: saleCardMaxOrders(order.fiatAmount, floorKopecks),
      statementRequired: awaitsStatementCheckpoint(order)
    }
  }

  /**
   * Builds and pushes to the owner's room.
   *
   * Never throws: every caller is an event handler or a money path, and a
   * socket failure must not roll back a balance operation that already
   * committed. The client reconciles on its next load either way.
   */
  async emit(order: StoredSale): Promise<void> {
    try {
      const progress = await this.build(order)
      this.tmaGateway.emitSaleProgress(order.telegramId, progress)
    } catch (error) {
      this.logger.error(
        `Failed to emit progress for sale ${order._id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /** Re-reads the order first, for callers holding a document from before a write. */
  async emitById(saleId: string): Promise<void> {
    const order = await this.saleDbService.findById(saleId)
    if (!order) return

    await this.emit(order)
  }
}
