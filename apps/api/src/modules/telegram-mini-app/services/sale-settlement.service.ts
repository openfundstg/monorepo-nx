import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { SaleMethod, SaleRemainderPolicy } from '@transacto/contracts'
import {
  awaitsStatementCheckpoint,
  describeError,
  isRemainderRefundable,
  isSaleFunded,
  parseMinOrderKopecks,
  saleTailKopecks,
  transactoOrderFloorKopecks,
  type SaleClaims
} from 'src/shared/utils'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'
import {
  SaleTerminalService,
  type DisposableTerminal
} from 'src/modules/telegram-mini-app/services/sale-terminal.service'
import { SalePayoutTargetService } from 'src/modules/telegram-mini-app/services/sale-payout-target.service'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaSaleTailReachedEvent } from 'src/shared/interfaces'

/**
 * The fields the settlement decision is made on.
 *
 * Widened past `{ receivedAmount, fiatAmount, jarBalance }` because the
 * remainder rule needs three more: the opening balance the delivered figure is
 * measured from, the policy the sale was created under, and the card, so
 * anything still in flight on it can be checked before a tail is written off.
 *
 * It is a {@link DisposableTerminal} as well, because a sale entering its tail
 * has its routing stood down here — and those are the four fields that takes.
 * Required rather than optional, like the terminal interface has them: every
 * caller passes a whole sale document, and a structural type that allowed one
 * without a `publicId` would only be describing something that does not exist.
 */
export interface SettleableSale extends SaleClaims, DisposableTerminal {
  receivedAmount: number
  fiatAmount: number
  jarBalance?: number | null
  openingJarBalance?: number | null
  remainderPolicy?: SaleRemainderPolicy | null
  /**
   * When the sale first had less left than the pipeline will route, if it has.
   *
   * Read here only to know whether entering the tail has already been acted on;
   * the gate that decides it is `TmaSaleDbService.markTailReached`.
   */
  tailReachedAt?: Date | null
  /** When an operator was told what to transfer — the second gate's field. */
  tailAnnouncedAt?: Date | null
  /**
   * The group message that told them, if it was recorded.
   *
   * Read here because an alert nobody can answer is not an alert: a reply finds
   * its sale by this id and by nothing else, so a tail announced without one —
   * every tail that existed before the answer did — has to be asked again.
   */
  tailAlertMessageId?: number | null
  /** The three things the alert needs to say where the money has to go. */
  telegramId: number
  saleMethod?: SaleMethod | null
  dropLink?: string | null
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
    private readonly orderDbService: OrderDbService,
    private readonly terminalService: SaleTerminalService,
    private readonly payoutTarget: SalePayoutTargetService,
    private readonly eventEmitter: EventEmitter2
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

    // Acted on before the ending is chosen, because entering a tail is true
    // whichever ending this sale asked for — and what it means first is that
    // nothing more may be routed here. Funded is still checked ahead of it: a
    // sale that reached its target has no tail, and parking one would stand
    // down a terminal that is about to be torn down anyway.
    await this.parkTailIfReached(saleId, latest, minOrderKopecks)

    if (!isRemainderRefundable(latest, minOrderKopecks)) {
      // The other ending. A sale that asked to wait needs a person to transfer
      // the tail, and this is where that person is told — on the branch where
      // no refund is coming, because a refunding sale needs nobody.
      await this.announceTailIfDue(saleId, latest, minOrderKopecks)

      return false
    }

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

  /**
   * Records that this sale has entered its tail, and stops payers being routed
   * into it. Once.
   *
   * **A tail is what nothing may be routed into.** `SaleCardLimitsService`
   * stops retuning the credential the moment the remainder drops under the
   * floor — a minimum of zero would mean "any amount at all" — so the window
   * upstream keeps whatever it was last given. On a ₴60 tail that was a
   * ₴300–₴364 window, and a payer routed into it overshoots the target: the
   * seller receives more hryvnia than the USDT they were charged for, and a
   * card sale has no scraper to notice. So routing comes down instead.
   *
   * **Stood down, not switched off.** `stopRouting` is `enable_orders: 0` with
   * `enabled` left alone, so the terminal keeps being scraped — which is the
   * whole of how a jar sale's manual top-up is ever seen, and the one thing a
   * teardown here would break.
   *
   * The write is the gate and it comes first, deliberately. A stamped sale whose
   * routing failed to come down is visible, bounded by the window upstream, and
   * says so in an error line; an unstamped sale is one nobody is ever told
   * about, and its tail is the part that needs a person.
   */
  private async parkTailIfReached(
    saleId: string,
    latest: SettleableSale,
    minOrderKopecks: number
  ): Promise<void> {
    const tail = saleTailKopecks(latest, minOrderKopecks)
    if (tail === 0) return

    // Cheap pre-check only — every settled order and every jar scrape asks this
    // again. What actually decides is the filter inside `markTailReached`.
    if (latest.tailReachedAt) return

    const parked = await this.saleDbService.markTailReached(saleId)
    if (parked === null) return

    this.logger.log(
      `Sale ${latest.publicId}: ${tail} kopecks left of ${latest.fiatAmount}, under the ` +
        `${minOrderKopecks} floor — no order can be routed for it. Standing routing down.`
    )

    try {
      await this.terminalService.stopRouting(latest, 'Tail reached')
    } catch (error: unknown) {
      this.logger.error(
        `Sale ${latest.publicId}: reached its tail and routing could not be stood down — a ` +
          `payer may still be sent there and overshoot the target: ${describeError(error)}`
      )
    }
  }

  /**
   * Tells an operator what to transfer to finish this sale. Once.
   *
   * **Reached only on the waiting ending**, because it is the only one that
   * needs a person: a sale that asked for its tail back as USDT gets it from
   * the branch above without anybody being told anything.
   *
   * **And only once there is nothing left to ask the seller for.** A declared
   * shortfall no statement has settled is about to change the very figure an
   * operator would be told to transfer — ₴4 of it, on the sale this was written
   * for — so the alert waits for the document rather than naming a number that
   * is about to move. Whatever accepts that statement re-examines the figures,
   * which is what brings this back.
   *
   * A second gate beside {@link parkTailIfReached}'s, and a second field, for
   * exactly that reason: the park cannot wait and the alert has to.
   *
   * **The destination is a payment credential**, and it goes onto the event and
   * no further. Nothing on this path logs it — the log line names the sale.
   */
  private async announceTailIfDue(
    saleId: string,
    latest: SettleableSale,
    minOrderKopecks: number
  ): Promise<void> {
    const tail = saleTailKopecks(latest, minOrderKopecks)
    if (tail === 0) return

    // **Announced is not the same as answerable.** A reply takes a tail on by
    // quoting the message that asked for it, so an alert whose id was never
    // recorded can never be answered — the seller cannot confirm the transfer
    // and nobody can claim it. That is every tail announced before the answer
    // existed, and any whose id failed to land afterwards, so both go round
    // again. Cheap pre-check; the writes below are what actually decide.
    if (latest.tailAnnouncedAt && latest.tailAlertMessageId != null) return

    if (awaitsStatementCheckpoint(latest)) {
      this.logger.log(
        `Sale ${latest.publicId} is in its tail and a declared shortfall has not been through ` +
          `a statement; not asking anyone to transfer a figure that document may correct`
      )

      return
    }

    // Resolved before the gate is taken, so a sale is never stamped as
    // announced on the strength of a message this could not compose. It answers
    // `null` rather than throwing, and the message says so.
    const payoutTarget = await this.payoutTarget.resolve(latest)

    // **Only a first ask takes the gate, and only a first one stamps the sale.**
    // Asking again is a repair rather than a new ask: the seller's wait has been
    // running since the original, and restarting it would take away a release
    // they may already have earned, because *our* write was the thing that
    // failed.
    const repeating = latest.tailAnnouncedAt != null

    if (!repeating) {
      const announced = await this.saleDbService.markTailAnnounced(saleId)
      if (announced === null) return
    }

    const unreadable = payoutTarget === null ? ' — and the destination could not be read' : ''

    this.logger.log(
      repeating
        ? `Sale ${latest.publicId}: asking again for its ${tail} kopeck tail — the first ` +
            `alert was never recorded, so nobody can answer it${unreadable}`
        : `Sale ${latest.publicId}: asking an operator to transfer its ${tail} kopeck ` +
            `tail${unreadable}`
    )

    this.eventEmitter.emit(TMA_DOMAIN_EVENT.SALE_TAIL_REACHED, {
      saleId,
      publicId: latest.publicId,
      telegramId: latest.telegramId,
      saleMethod: latest.saleMethod ?? SaleMethod.JAR,
      tailKopecks: tail,
      fiatAmount: latest.fiatAmount,
      receivedAmount: latest.receivedAmount,
      payoutTarget
    } satisfies TmaSaleTailReachedEvent)
  }

  /** The smallest order Transacto will route, and so the width of the tail. */
  private minOrderKopecks(): number {
    return transactoOrderFloorKopecks()
  }
}
