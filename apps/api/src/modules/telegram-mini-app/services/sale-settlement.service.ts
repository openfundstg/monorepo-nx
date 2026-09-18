import { Injectable, Logger } from '@nestjs/common'
import { SaleRemainderPolicy } from '@transacto/contracts'
import {
  awaitsStatementCheckpoint,
  isRemainderRefundable,
  isSaleFunded,
  parseMinOrderKopecks,
  transactoOrderFloorKopecks,
  type SaleClaims
} from 'src/shared/utils'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'

/**
 * The fields the settlement decision is made on.
 *
 * Widened past `{ receivedAmount, fiatAmount, jarBalance }` because the
 * remainder rule needs three more: the opening balance the delivered figure is
 * measured from, the policy the sale was created under, and the card, so
 * anything still in flight on it can be checked before a tail is written off.
 */
export interface SettleableSale extends SaleClaims {
  receivedAmount: number
  fiatAmount: number
  jarBalance?: number | null
  openingJarBalance?: number | null
  remainderPolicy?: SaleRemainderPolicy | null
  cardId?: number | null
}

/**
 * When a sale is finished, and what crediting one settled order means.
 *
 * Extracted from `SaleProgressListener`, which owned it while the scraper was
 * the only thing that could settle anything. The card variant settles on a
 * seller's confirmation instead, through a path the listener never sees — and
 * the rules below are the ones that decide whether a user's stake is released,
 * so a second copy of them is the one duplication this codebase least affords.
 *
 * Both variants therefore come through here, and whichever signal notices first
 * closes the sale.
 */
@Injectable()
export class SaleSettlementService {
  private readonly logger = new Logger(SaleSettlementService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly saleFacade: SaleFacadeService,
    private readonly orderDbService: OrderDbService
  ) {}

  /**
   * Credits one settled order, ignoring a repeat report of the same order id.
   *
   * Returns the updated document, or `null` when the order was already counted
   * or carried no usable amount — a state change with no numeric amount is a
   * status flip we cannot price, and guessing would corrupt the total.
   */
  async creditSettledOrder(
    saleId: string,
    settled: { orderId?: number; amount?: number }
  ) {
    if (typeof settled.orderId !== 'number' || typeof settled.amount !== 'number') return null

    return this.saleDbService.creditExecutedOrder(
      saleId,
      settled.orderId,
      settled.amount,
      Date.now()
    )
  }

  /**
   * Closes the sale once nothing more is coming — for either of two reasons.
   *
   * **Funded** is the ordinary one: the target has arrived, by matched orders or
   * by a trader's top-up. {@link isSaleFunded} is where the distinction
   * between matched money and money merely sitting in the jar is explained.
   *
   * **Refundable** is the other, and only for a sale created with
   * `REFUND_TO_BALANCE`: the gap left is smaller than any order the pipeline can
   * route, so it will never be filled by a payment. Rather than wait for someone
   * to pay it in by hand, the tail goes back to the user as USDT and the sale
   * closes successfully. See {@link isRemainderRefundable}.
   *
   * Funded is checked first, deliberately. A jar that actually reached its
   * target settles as a full fill with no refund at all, whatever policy the
   * sale carries — the two are not alternatives, and asking in the other order
   * would refund a tail that had already been paid.
   *
   * `completeSale` is idempotent and emits its own progress snapshot, so a
   * `true` return means the announcement is handled.
   */
  async settleIfFinished(saleId: string, latest: SettleableSale): Promise<boolean> {
    const minOrderKopecks = this.minOrderKopecks()

    if (isSaleFunded(latest, minOrderKopecks)) return this.saleFacade.completeSale(saleId)

    if (!isRemainderRefundable(latest, minOrderKopecks)) return false

    // The tail is held while a claim on this sale has not been through a
    // statement.
    //
    // **This is the lever, and it is deliberately the only one.** A seller who
    // says ₴995 arrived of ₴1 000 leaves ₴5 more of the target outstanding, and
    // is routed more hryvnia for the same stake — the one claim on a card sale
    // they gain by making. Refusing every such claim would punish everyone whose
    // bank took a fee; taking them all on trust would pay for the ones who did
    // not. So the claim is taken, the sale runs on, and the refund at the end
    // waits for a document. Telling the truth costs one upload; not telling it
    // costs the difference, out of the very money being held.
    //
    // A sale that reaches its target exactly has no tail to hold, so a seller
    // who understated within the allowance keeps it. That leak is bounded by
    // the allowance times seven orders, which is why the allowance is a figure
    // an operator sets and ships at zero.
    if (awaitsStatementCheckpoint(latest)) {
      this.logger.log(
        `Sale ${saleId} has an unfillable tail but a declared shortfall no statement ` +
          `has settled; holding the refund until one arrives`
      )
      return false
    }

    // Nothing may still be in flight.
    //
    // The arithmetic says no order this small can exist, so in principle there
    // is nothing to wait for. But an order raised while there *was* room and
    // still unsettled — one under appeal, above all — can resolve into money
    // later, and by then this sale would be closed, its tail already refunded
    // and its terminal retired. The user would keep both. The same check the
    // cancellation path makes, for the same reason, and it costs one indexed
    // lookup at the one moment a sale closes.
    if (latest.cardId !== null && latest.cardId !== undefined) {
      const unsettled = await this.orderDbService.findUnsettledByCard(latest.cardId)
      if (unsettled.length > 0) {
        this.logger.debug(
          `Sale ${saleId} has an unfillable tail but ${unsettled.length} ` +
            `order(s) are still open on card ${latest.cardId}; not refunding yet`
        )
        return false
      }
    }

    return this.saleFacade.completeSale(saleId)
  }

  /** The smallest order Transacto will route, and so the width of the tail. */
  private minOrderKopecks(): number {
    return transactoOrderFloorKopecks()
  }
}
