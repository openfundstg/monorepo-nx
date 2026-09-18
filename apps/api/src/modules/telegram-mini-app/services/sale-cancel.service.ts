import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  CENTS_PER_USDT,
  ERROR,
  SaleEventType,
  usdtCentsForKopecks
} from '@transacto/contracts'
import type { CancelSaleRes } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { SaleTerminalService } from 'src/modules/telegram-mini-app/services/sale-terminal.service'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { saleDeliveredFiat, saleRefundSplit } from 'src/shared/utils'
import type { StoredSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'

/** A stored sale plus its id — what both halves of a stop work on. */

/**
 * Stops a sale early, at the user's request, and gives back what is
 * still theirs.
 *
 * The refund is the stake **minus what the jar has already taken in**. A user
 * who has received ₴87 keeps that ₴87 — it is in their own bank — so the USDT
 * that paid for it is not theirs to have a second time. Refunding the whole
 * stake would let anyone collect hryvnia for free by cancelling one order at a
 * time. The profit is not refunded either, and never was: it is only ever
 * earned by an order that completes.
 *
 * What "taken in" means is {@link saleDeliveredFiat}, not
 * `receivedAmount`. This used to read the latter directly, which counts only
 * money matched to a settled Transacto order — so hryvnia that reached the jar
 * without one, which the matcher genuinely cannot always attribute, was
 * refunded in full to a user who still had it.
 */
@Injectable()
export class SaleCancelService {
  private readonly logger = new Logger(SaleCancelService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly userDbService: TmaUserDbService,
    private readonly orderDbService: OrderDbService,
    private readonly terminalService: SaleTerminalService,
    private readonly progressService: SaleProgressService,
    private readonly tmaGateway: TmaGateway,
    private readonly balanceLedger: BalanceLedgerService
  ) {}

  /**
   * Whether this order could be stopped right now.
   *
   * Shared with the progress snapshot so the button the user sees matches what
   * the endpoint would actually do — a control that is visible but always fails
   * is worse than one that is honestly disabled.
   *
   * Open orders on the terminal used to make this false, because stopping was
   * refused outright while any payment was outstanding. It no longer is: those
   * orders decide *how* the stop happens — immediately, or by winding down —
   * not whether it may be asked for. `CLOSING` is not open here, so an order
   * already winding down offers no second button.
   */
  canCancel(order: { status: TmaSaleStatus }): boolean {
    return this.isOpen(order.status)
  }

  /**
   * Stops the order and refunds the untouched part of the stake.
   *
   * Ordered so the money is safe if anything downstream fails: the status flip
   * comes first and is the idempotency gate, so two taps produce one refund;
   * the ledger moves next, while it is the only thing that matters; the
   * terminal teardown is last, because a Transacto hiccup must not cost the
   * user a refund they were already owed.
   */
  async cancel(saleId: string, telegramId: number): Promise<CancelSaleRes> {
    const order = await this.saleDbService.findById(saleId)
    // Same 404 for "not yours" as for "not there": an id that is not the
    // caller's should not be confirmable by the shape of the error.
    if (!order || order.telegramId !== telegramId)
      throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    if (!this.isOpen(order.status)) throw new ConflictException(ERROR.SALE.NOT_CANCELLABLE)

    // Outstanding payments do not refuse the stop any more — they decide which
    // of the two endings it gets. Checked before anything is written, so the
    // order is never left half-stopped.
    const outstanding =
      order.cardId === null ? [] : await this.orderDbService.findUnsettledByCard(order.cardId)

    if (outstanding.length > 0) return this.beginClosing(order, outstanding.length)

    return this.settle(order)
  }

  /**
   * Stops routing and waits, for an order that still has payments outstanding.
   *
   * Nothing is refunded here and no figure is quoted, because a payer holding
   * one of those orders can still pay — which would reduce the refund. The
   * terminal stays in service precisely so that money is seen; see
   * {@link TerminalDeactivationService.stopRouting}.
   */
  private async beginClosing(
    order: StoredSale,
    outstanding: number
  ): Promise<CancelSaleRes> {
    // The status flip is the idempotency gate, and it comes first: a second tap
    // must not stand the terminal down twice or add a second timeline entry.
    const closing = await this.saleDbService.markClosing(order._id.toString())
    if (!closing) throw new ConflictException(ERROR.SALE.NOT_CANCELLABLE)

    await this.terminalService.stopRouting(order, 'Closing')

    this.logger.log(
      `Sale ${order.publicId} is winding down at the user's request: ` +
        `${outstanding} order(s) still outstanding on card ${order.cardId}`
    )

    const withEvent = await this.saleDbService.appendEvent(order._id.toString(), {
      type: SaleEventType.CLOSING_REQUESTED,
      at: Date.now()
    })

    this.tmaGateway.emitSaleStatusChange(
      order.telegramId,
      order._id.toString(),
      TmaSaleStatus.CLOSING
    )
    if (withEvent) await this.progressService.emit(withEvent)

    const user = await this.userDbService.findByTelegramId(order.telegramId)

    return {
      status: TmaSaleStatus.CLOSING,
      refunded: 0,
      consumed: 0,
      balance: user?.balance ?? 0
    }
  }

  /**
   * Ends the order and moves the money. The half that used to be all of
   * `cancel`.
   *
   * Reached three ways: straight away when nothing was outstanding, from the
   * closing sweep once the last payment resolved, and from the reconciliation
   * sweep for an order whose jar turned out to be gone. It must behave the same
   * every time, which is why it re-reads nothing and takes the order it is
   * given.
   *
   * `ending` names it on the timeline. It defaults to the user's own stop
   * because that is what two of the three are; the third passes `JAR_CLOSED`,
   * since telling a user they stopped an order the system closed for them would
   * be a plain untruth.
   */
  async settle(
    order: StoredSale,
    ending: SaleEventType = SaleEventType.STOPPED_BY_USER,
    refundOverride?: number
  ): Promise<CancelSaleRes> {
    const cancelled = await this.saleDbService.cancelIfOpen(order._id.toString())
    if (!cancelled) throw new ConflictException(ERROR.SALE.NOT_CANCELLABLE)

    return this.settleClosed(order, ending, refundOverride)
  }

  /**
   * The money and the teardown, for an order already marked cancelled.
   *
   * Split out of {@link settle} so a second gate can reuse it. `settle` guards
   * the *open* statuses, which is right for a user stopping their own order;
   * releasing a blocked one guards `BLOCKED` instead, and widening the first
   * gate to accept it would let a user's own cancel button release a stake that
   * was frozen for breaking a rule — the thing blocking exists to prevent.
   *
   * Two preconditions, one settlement. Whoever flips the status owns the
   * idempotency; everything after it happens exactly once as a result.
   */
  async settleClosed(
    order: StoredSale,
    ending: SaleEventType = SaleEventType.STOPPED_BY_USER,
    refundOverride?: number
  ): Promise<CancelSaleRes> {
    const saleId = order._id.toString()
    const telegramId = order.telegramId

    const delivered = saleDeliveredFiat(order)
    // The same helper the admin panel previews with, so an operator is never
    // shown one figure and charged another.
    const automatic = saleRefundSplit(order)
    const { refunded, consumed } = this.applyOverride(order.frozenUsdt, automatic, refundOverride)

    // The consumed half leaves the frozen pot without returning: it paid for
    // hryvnia the user already has. Only the rest goes back to the balance.
    if (consumed > 0) await this.userDbService.commitFrozenBalance(telegramId, consumed)
    if (refunded > 0) await this.balanceLedger.refund(telegramId, refunded, saleId)

    this.logger.log(
      `Sale ${order.publicId} cancelled by telegramId ${telegramId}: ` +
        `refunded ${refunded / CENTS_PER_USDT} USDT, ` +
        `consumed ${consumed / CENTS_PER_USDT} USDT for ${delivered / 100} UAH already received ` +
        `(matched ${order.receivedAmount / 100}, jar ${(order.jarBalance ?? 0) / 100} from ` +
        `${(order.openingJarBalance ?? 0) / 100})`
    )

    await this.terminalService.disable(order, 'Cancelled')

    const withEvent = await this.saleDbService.appendEvent(saleId, {
      type: ending,
      ...(refunded > 0 ? { amount: refunded } : {}),
      at: Date.now()
    })

    const user = await this.userDbService.findByTelegramId(telegramId)
    const balance = user?.balance ?? 0

    this.tmaGateway.emitSaleStatusChange(
      telegramId,
      saleId,
      TmaSaleStatus.CANCELLED
    )
    this.tmaGateway.emitBalanceUpdated(telegramId, balance)
    if (withEvent) await this.progressService.emit(withEvent)

    return { status: TmaSaleStatus.CANCELLED, refunded, consumed, balance }
  }

  /**
   * Splits the frozen stake into what the jar has already eaten and what goes
   * back.
   *
   * `deliveredFiat` is UAH kopecks and `exchangeRate` is kopecks per USDT, so
   * dividing gives USDT and scaling by 100 gives cents. The order's own
   * snapshotted rate is used, not today's — the stake was frozen at that rate,
   * so unwinding it at any other would refund the wrong amount.
   *
   * Clamped both ways: a jar that somehow reports more than the order was for
   * must not produce a negative refund, and the consumed half can never exceed
   * what was actually frozen.
   */
  /**
   * The refund an admin typed, or the computed one when they typed nothing.
   *
   * Only the admin panel passes an override, and only for the cases it exists
   * for — an order whose automatic answer is wrong. Everything else, including
   * every user-initiated stop, goes through the arithmetic untouched.
   *
   * Clamped to the stake and refused above it by the caller: `unfreezeBalance`
   * moves money out of the frozen pot, so returning more than was frozen would
   * leave that pot permanently wrong. `consumed` is whatever is left, which
   * keeps the two halves summing to the stake however the figure was chosen.
   */
  private applyOverride(
    frozenUsdt: number,
    automatic: { refunded: number; consumed: number },
    override?: number
  ): { refunded: number; consumed: number } {
    if (override === undefined) return automatic

    const refunded = Math.max(0, Math.min(frozenUsdt, Math.round(override)))

    return { refunded, consumed: frozenUsdt - refunded }
  }

  private isOpen(status: TmaSaleStatus): boolean {
    return (
      status === TmaSaleStatus.CREATED ||
      status === TmaSaleStatus.TERMINAL_READY ||
      status === TmaSaleStatus.AWAITING_FIAT
    )
  }
}
