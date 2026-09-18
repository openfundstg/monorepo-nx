import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ERROR,
  OrderExecutionReason,
  SaleCardOrderState,
  SaleEventType,
  SaleMethod
} from '@transacto/contracts'
import { OrderDbService, OrderStatus } from 'src/modules/repositories/order-db'
import type { StoredSale, TmaSaleCardOrder } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { cardOrderOf } from 'src/modules/telegram-mini-app/utils'
import { SaleCardLimitsService } from 'src/modules/telegram-mini-app/services/sale-card-limits.service'
import { SaleSettlementService } from 'src/modules/telegram-mini-app/services/sale-settlement.service'
import { SaleTerminalService } from 'src/modules/telegram-mini-app/services/sale-terminal.service'
import { TmaServiceTraderService } from 'src/modules/telegram-mini-app/services/tma-service-trader.service'
import {
  OrderExecutionOutcome,
  TransactoApiService,
  transactoErrorCodeOf
} from 'src/modules/transacto/services/transacto-api.service'
import { TransactoErrorCode } from 'src/shared/interfaces'
import { TMA_DOMAIN_EVENT } from 'src/shared/interfaces'
import type { TmaSaleCardOrderEvent } from 'src/shared/interfaces'
import {
  isShortfallAcceptable,
  MINUTE_MS,
  TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES
} from 'src/shared/constants'
import { describeError } from 'src/shared/utils'


/** The states an unanswered order may be answered from. */
const ANSWERABLE = [
  SaleCardOrderState.AWAITING_CONFIRMATION,
  SaleCardOrderState.DISPUTED
] as const

/** The states that mean the money has already been accounted for. */
const SETTLED = [SaleCardOrderState.CONFIRMED, SaleCardOrderState.PROVEN_PAID] as const

/**
 * One card sale's orders, from a payer being routed to the money being accounted
 * for.
 *
 * **The whole variant rests on an asymmetry.** A seller has a motive to lie in
 * exactly one direction: saying "it did not arrive" when it did leaves them
 * holding both the hryvnia and the USDT, while saying "it arrived" when it did
 * not costs them their own stake. So {@link confirm} takes the seller at their
 * word — it is testimony against interest — and {@link deny} takes nobody at
 * their word at all, stopping the terminal and asking for a document.
 *
 * Two surfaces answer an order, the sale's own screen and the bot's inline
 * keyboard, and both call the same method here. That is not tidiness: a seller
 * who taps one and then the other is the expected case, and the state filter in
 * `moveCardOrder` is what makes the second tap a no-op rather than a second
 * confirmation.
 */
@Injectable()
export class SaleCardOrderService {
  private readonly logger = new Logger(SaleCardOrderService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly orderDbService: OrderDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly serviceTrader: TmaServiceTraderService,
    private readonly terminalService: SaleTerminalService,
    private readonly settlement: SaleSettlementService,
    private readonly limits: SaleCardLimitsService,
    private readonly progressService: SaleProgressService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Records a payer being routed to this sale, and asks its seller about it.
   *
   * Idempotent through `pushCardOrder`, which refuses a second row for the same
   * order id: a webhook and the thirty-second sync both report the same arrival,
   * and two rows would ask the same question twice and let one answer settle
   * the other.
   *
   * The announcement rides an event rather than a call, so this pipeline never
   * learns that a Telegram bot exists — and so a bot that is slow or down
   * cannot fail the arrival it is only reporting.
   */
  async recordArrival(
    sale: StoredSale,
    order: { orderId: number; amount: number }
  ): Promise<StoredSale | null> {
    const confirmDeadlineAt = await this.deadlineFor(order.orderId)

    const updated = await this.saleDbService.pushCardOrder(sale._id.toString(), {
      ...order,
      confirmDeadlineAt
    })
    if (!updated) return null

    this.announce(TMA_DOMAIN_EVENT.SALE_CARD_ORDER_AWAITING, updated, {
      ...order,
      confirmDeadlineAt: confirmDeadlineAt.getTime()
    })

    return updated
  }

  /**
   * When this order stops being a question and becomes a dispute.
   *
   * **Transacto's deadline, not one of ours.** There used to be two: theirs,
   * for the payer, and a separate window of our own for the seller on top of
   * it. Two deadlines are two different answers to "how long do I wait", and
   * only one of them was ever shown — so the screen counted down one clock
   * while the sweep acted on another.
   *
   * It is read off the tracked order, where `trackOnly` resolved it from the
   * webhook that created this order. A delivery that carried no usable pair of
   * timestamps leaves it absent, and the configured window stands in: a card
   * order with no deadline at all could never be disputed, and an unanswerable
   * question that never expires is the one outcome this variant cannot have.
   */
  private async deadlineFor(orderId: number): Promise<Date> {
    const tracked = await this.orderDbService.findByOrderId(orderId)
    if (tracked?.payerDeadlineAt) return new Date(tracked.payerDeadlineAt)

    this.logger.warn(
      `Order ${orderId} reached a card sale with no deadline from Transacto; ` +
        `falling back to ${TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES} minutes.`
    )

    return new Date(Date.now() + TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES * MINUTE_MS)
  }

  /**
   * The seller says the money reached their card.
   *
   * Called by the Mini App and by the bot, and safe to call twice. Returns the
   * sale as it now stands.
   *
   * `receivedKopecks` is what actually landed, when a transfer fee took a bite
   * out of the payment. Omitted — which is what the bot's inline key always
   * sends, a keyboard having no way to ask for a number — it means the whole of
   * the order arrived.
   *
   * **A shortfall is not automatically waved through.** Within the configured
   * allowance the order is executed and the smaller figure is what counts toward
   * the target. Beyond it, nothing is executed: the payer's money is not
   * released against a sum the seller says they did not get, and the order goes
   * to a statement instead. Confirming is still testimony against the seller's
   * own interest, but only in the part they are agreeing to.
   */
  async confirm(
    telegramId: number,
    saleId: string,
    orderId: number,
    receivedKopecks?: number
  ): Promise<StoredSale> {
    const { sale, cardOrder } = await this.resolve(telegramId, saleId, orderId)

    // Already accounted for. The ordinary way to reach this is the race the
    // two surfaces make inevitable, so it is an answer and not an error.
    if ((SETTLED as readonly SaleCardOrderState[]).includes(cardOrder.state)) return sale

    if (!(ANSWERABLE as readonly SaleCardOrderState[]).includes(cardOrder.state))
      throw new ConflictException(ERROR.SALE_CARD.ORDER_NOT_AWAITING)

    const declared = this.readDeclared(cardOrder, receivedKopecks)
    const shortfall = cardOrder.amount - declared

    if (!isShortfallAcceptable(shortfall)) {
      this.logger.warn(
        `Sale ${sale.publicId}: order ${cardOrder.orderId} was confirmed ${shortfall} kopecks ` +
          `short, which is past the allowance. Not executed; a statement settles it.`
      )

      return this.dispute(sale, cardOrder, `confirmed ${shortfall} kopecks short`, declared)
    }

    await this.executeUpstream(orderId)

    return this.settleConfirmed(
      sale,
      cardOrder,
      SaleCardOrderState.CONFIRMED,
      OrderExecutionReason.USER_CONFIRMED,
      declared
    )
  }

  /**
   * What to credit for this order, from what the seller said.
   *
   * Nothing said means the whole order — the ordinary answer, and the only one
   * the bot can give. A figure above the order is refused outright rather than
   * clamped: a fee takes money out of a payment and nothing puts money in, so
   * that number cannot have happened, and silently reading it as the order's
   * own amount would hide a client sending nonsense.
   */
  private readDeclared(cardOrder: TmaSaleCardOrder, receivedKopecks?: number): number {
    if (typeof receivedKopecks !== 'number') return cardOrder.amount

    if (!Number.isInteger(receivedKopecks) || receivedKopecks <= 0)
      throw new BadRequestException(ERROR.SALE_CARD.DECLARED_ABOVE_ORDER)

    if (receivedKopecks > cardOrder.amount)
      throw new BadRequestException(ERROR.SALE_CARD.DECLARED_ABOVE_ORDER)

    return receivedKopecks
  }

  /**
   * The seller says the money never arrived.
   *
   * Nothing upstream is told, because nothing has been established: what the
   * seller has produced is a claim that costs them nothing to make, and it is
   * the only claim in this flow that does. So routing stops — more money must
   * not land somewhere a dispute is already open — and the answer becomes a
   * document rather than a tap.
   */
  async deny(telegramId: number, saleId: string, orderId: number): Promise<StoredSale> {
    const { sale, cardOrder } = await this.resolve(telegramId, saleId, orderId)

    if (cardOrder.state === SaleCardOrderState.DISPUTED) return sale

    if (!(ANSWERABLE as readonly SaleCardOrderState[]).includes(cardOrder.state))
      throw new ConflictException(ERROR.SALE_CARD.ORDER_NOT_AWAITING)

    // Not late yet, so there is nothing to deny. The rule lives here and not on
    // a screen because two surfaces reach this: the Mini App can withhold the
    // button until the deadline, the bot's inline keyboard is attached to a
    // message sent on arrival and cannot. A denial stops routing to the
    // terminal, so accepting one early costs the seller the rest of their own
    // sale over a transfer that is merely in flight.
    if (cardOrder.confirmDeadlineAt > new Date())
      throw new ConflictException(ERROR.SALE_CARD.ORDER_NOT_OVERDUE)

    return this.dispute(sale, cardOrder, 'denied by the seller')
  }

  /**
   * The confirmation window ran out with nobody answering.
   *
   * Treated exactly as a denial, and deliberately not more leniently: silence
   * and "it did not arrive" put the sale in the same place, because in both
   * cases nothing has established that the hryvnia landed. The seller can still
   * confirm afterwards — `DISPUTED` is one of the states {@link confirm}
   * accepts, and a late `OVERDUE` order is still executable upstream.
   */
  async expire(sale: StoredSale, cardOrder: TmaSaleCardOrder): Promise<StoredSale | null> {
    if (cardOrder.state !== SaleCardOrderState.AWAITING_CONFIRMATION) return null

    return this.dispute(sale, cardOrder, 'unanswered past its deadline')
  }

  /**
   * Somebody settled this order upstream, without the seller being asked.
   *
   * In practice an operator confirming it in Transacto's own panel. The money
   * is credited by the path that noticed — this only closes the question, so the
   * sweep does not later dispute an order that is already paid and stop a
   * terminal that has nothing wrong with it.
   *
   * Nothing is executed here and no `markExecutionStarted` is written: the
   * execution already happened elsewhere, and claiming it would make the next
   * `order.paid` look like this process's own echo.
   */
  async markSettledUpstream(sale: StoredSale, orderId: number): Promise<StoredSale | null> {
    const saleId = sale._id.toString()

    const moved = await this.saleDbService.moveCardOrder(
      saleId,
      orderId,
      ANSWERABLE,
      SaleCardOrderState.CONFIRMED,
      { answered: true }
    )
    if (!moved) return null

    this.logger.log(
      `Sale ${sale.publicId}: order ${orderId} was settled upstream; its question is closed.`
    )

    const cardOrder = cardOrderOf(moved, orderId)

    const withEvent =
      (await this.saleDbService.appendEvent(saleId, {
        type: SaleEventType.ORDER_CONFIRMED,
        amount: cardOrder?.amount,
        orderId,
        at: Date.now()
      })) ?? moved

    await this.resumeIfSettled(withEvent)

    return withEvent
  }

  /**
   * A statement settled a dispute the seller had raised — the money was there.
   *
   * Executed on the document's word rather than on anybody's, and recorded as
   * such: {@link OrderExecutionReason.STATEMENT_PROVEN} is a different fact from
   * a seller confirming, and the two describe opposite situations.
   */
  async confirmFromStatement(sale: StoredSale, cardOrder: TmaSaleCardOrder): Promise<StoredSale> {
    await this.executeUpstream(cardOrder.orderId)

    this.logger.warn(
      `Sale ${sale.publicId}: order ${cardOrder.orderId} was denied by the seller and a ` +
        `statement showed the credit. Settled on the document.`
    )

    return this.settleConfirmed(
      sale,
      cardOrder,
      SaleCardOrderState.PROVEN_PAID,
      OrderExecutionReason.STATEMENT_PROVEN
    )
  }

  /**
   * Loads a card order, proving on the way that this caller may answer for it.
   *
   * **Public, and the only way to reach one.** Ownership is checked here rather
   * than by the callers, because there are now three of them — the Mini App, a
   * bot callback and the statement path — and one is a callback where the
   * telegram id arrives from Telegram rather than from a signed launch. The
   * temptation to trust the button's payload is exactly the mistake this
   * prevents, and it is prevented once rather than in each caller.
   */
  async resolve(
    telegramId: number,
    saleId: string,
    orderId: number
  ): Promise<{ sale: StoredSale; cardOrder: TmaSaleCardOrder }> {
    const sale = await this.saleDbService.findById(saleId)
    if (!sale || sale.telegramId !== telegramId)
      throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    if (sale.saleMethod !== SaleMethod.CARD)
      throw new BadRequestException(ERROR.SALE_CARD.NOT_A_CARD_SALE)

    const cardOrder = cardOrderOf(sale, orderId)
    if (!cardOrder) throw new NotFoundException(ERROR.SALE_CARD.ORDER_NOT_FOUND)

    return { sale, cardOrder }
  }

  /**
   * Tells Transacto the order is paid.
   *
   * **`markExecutionStarted` comes first, always.** Transacto fires
   * `order.paid` the instant `orders_execute` succeeds, so the confirmation
   * comes straight back as a webhook — and without this marker that delivery is
   * indistinguishable from an operator confirming by hand, which is recorded and
   * shown to the user as exactly that. Every path that executes an order marks
   * it; adding one that does not is how a machine decision gets reported as a
   * human's.
   */
  private async executeUpstream(orderId: number): Promise<void> {
    await this.orderDbService.markExecutionStarted(orderId)

    const { apiToken } = await this.serviceTrader.resolve()

    try {
      const { outcome } = await this.transactoApiService.executeOrder(apiToken, orderId)

      if (outcome === OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED) {
        // The money arrived; the confirmation did not. Settling locally anyway
        // is right — the seller's word is what this variant runs on, and our
        // failure to relay it does not un-arrive their hryvnia. The order stays
        // open upstream for the retry or for a person.
        await this.orderDbService.markAwaitingUpstreamConfirmation(orderId)
      }
    } catch (error: unknown) {
      // A status Transacto will not execute — `EXPIRED_HOLD`, `CLIENT_CANCELLED`
      // or `DECLINED` — answers `VALIDATION`, and it is final. An honest seller
      // who tapped the button an hour late has to be told that rather than shown
      // a silent no-op.
      //
      // Late alone is not this: `OVERDUE` is executable, because a late payer's
      // money is still money.
      // Transacto's `error_code`, not ours. `errorCodeOf` in `src/shared/utils`
      // reads the `ERROR` constant out of a thrown NestJS exception, which an
      // axios failure from another system does not carry — it answers
      // `undefined` here for every refusal there is.
      if (transactoErrorCodeOf(error) === TransactoErrorCode.VALIDATION) {
        this.logger.warn(
          `Order ${orderId} can no longer be confirmed upstream: ${describeError(error)}`
        )
        throw new ConflictException(ERROR.SALE_CARD.ORDER_NOT_EXECUTABLE)
      }

      this.logger.error(`Could not confirm order ${orderId}: ${describeError(error)}`)
      throw new ServiceUnavailableException(ERROR.SALE_CARD.CONFIRMATION_FAILED)
    }
  }

  /**
   * Books one confirmed order, whichever thing confirmed it.
   *
   * The state flip comes before the money moves, as everywhere else in this
   * codebase: it is the idempotency gate, and a second caller that finds it
   * already flipped must not credit the same order again.
   */
  private async settleConfirmed(
    sale: StoredSale,
    cardOrder: TmaSaleCardOrder,
    state: SaleCardOrderState,
    reason: OrderExecutionReason,
    creditedKopecks: number = cardOrder.amount
  ): Promise<StoredSale> {
    const saleId = sale._id.toString()
    const declaredAmount = creditedKopecks === cardOrder.amount ? undefined : creditedKopecks

    await this.orderDbService.markCompleted(
      cardOrder.orderId,
      OrderStatus.EXECUTED,
      reason,
      creditedKopecks
    )

    const moved = await this.saleDbService.moveCardOrder(
      saleId,
      cardOrder.orderId,
      ANSWERABLE,
      state,
      { answered: true, declaredAmount }
    )
    // Somebody else answered between the read and the write. Their call is
    // doing the crediting; this one returns what is there.
    if (!moved) return (await this.saleDbService.findById(saleId)) ?? sale

    const withEvent =
      (await this.saleDbService.appendEvent(saleId, {
        type: SaleEventType.ORDER_CONFIRMED,
        amount: creditedKopecks,
        orderId: cardOrder.orderId,
        at: Date.now()
      })) ?? moved

    // What landed, not what was ordered. A jar sale credits the growth the
    // scraper observed, which is already net of whatever the bank took; this is
    // the same figure, from the only witness a card sale has.
    const credited =
      (await this.settlement.creditSettledOrder(saleId, {
        orderId: cardOrder.orderId,
        amount: creditedKopecks
      })) ?? withEvent

    // Nothing is disputed any more, so payers may be routed here again. Done
    // before settling, because a sale that is about to complete retires its
    // terminal anyway and resuming a retired one would be a wasted call in the
    // other order.
    await this.resumeIfSettled(credited)

    if (await this.settlement.settleIfFinished(saleId, credited)) {
      return (await this.saleDbService.findById(saleId)) ?? credited
    }

    // The sale goes on, so the credential is re-tuned to what is still needed.
    // Done here rather than on arrival because the figure it divides — what is
    // outstanding — only changes when an order settles. See
    // `SaleCardLimitsService` for what strands if this is left at its original
    // value.
    await this.limits.retune(credited)

    await this.progressService.emit(credited)

    return credited
  }

  /**
   * Moves an order into dispute and stops the terminal taking more.
   *
   * Stopping routing is not a punishment and not an anti-fraud measure — it is
   * the only way to keep the question answerable. One open order at a time is
   * what lets a seller say "this ₴1 428 arrived"; a second payer landing money
   * while the first is disputed turns that into "some money arrived", which
   * nobody can answer about a card that sees more than one transfer a day.
   */
  private async dispute(
    sale: StoredSale,
    cardOrder: TmaSaleCardOrder,
    context: string,
    declaredAmount?: number
  ): Promise<StoredSale> {
    const saleId = sale._id.toString()

    const moved = await this.saleDbService.moveCardOrder(
      saleId,
      cardOrder.orderId,
      [SaleCardOrderState.AWAITING_CONFIRMATION],
      SaleCardOrderState.DISPUTED,
      { answered: true, declaredAmount }
    )
    if (!moved) return (await this.saleDbService.findById(saleId)) ?? sale

    this.logger.warn(
      `Sale ${sale.publicId}: order ${cardOrder.orderId} ${context}; routing stopped`
    )

    // Swallowed rather than thrown, unlike `resumeRouting`. The dispute is
    // already recorded and the seller has already been told; a Transacto hiccup
    // must not turn "we have noted your report" into an error on their screen.
    try {
      await this.terminalService.stopRouting(moved, 'Disputed')
    } catch (error: unknown) {
      this.logger.error(
        `Could not stop routing for sale ${sale.publicId}: ${describeError(error)}`
      )
    }

    const withEvent =
      (await this.saleDbService.appendEvent(saleId, {
        type: SaleEventType.ORDER_DISPUTED,
        amount: cardOrder.amount,
        orderId: cardOrder.orderId,
        at: Date.now()
      })) ?? moved

    this.announce(TMA_DOMAIN_EVENT.SALE_CARD_ORDER_DISPUTED, withEvent, {
      orderId: cardOrder.orderId,
      amount: cardOrder.amount,
      confirmDeadlineAt: cardOrder.confirmDeadlineAt.getTime()
    })

    await this.progressService.emit(withEvent)

    return withEvent
  }

  /**
   * Shuts the terminal while an order is still running, without answering it.
   *
   * **The order is untouched, and that is the whole difference from
   * {@link dispute}.** Its seller still has the rest of their window and can
   * still confirm; what is taken away is Transacto's ability to route a *second*
   * payer here in the moment the first order runs out. Expiry and routing are
   * both decided upstream, on a clock we do not hold, and nothing says the
   * sweep gets to see the first before the second exists.
   *
   * Nothing new is recorded, so this is safe to repeat — `stopRouting` is one
   * `enable_orders: 0` and one local flag, and it is called at most twice per
   * order because the sweep's period and the cutoff are the same half minute.
   * Routing comes back the moment the order settles, through
   * {@link resumeIfSettled}, exactly as it does after a dispute.
   *
   * Swallowed rather than thrown, like the stop inside {@link dispute}: nobody
   * asked for this and nobody is waiting to be told it happened. What is lost
   * when it fails is the guarantee, which the log line names.
   */
  async holdRouting(sale: StoredSale): Promise<void> {
    try {
      await this.terminalService.stopRouting(sale, 'Order window closing')
    } catch (error: unknown) {
      this.logger.error(
        `Could not close routing ahead of the deadline on sale ${sale.publicId}: ` +
          describeError(error)
      )
    }
  }

  /** Lets payers back in once no order on this sale is disputed. */
  private async resumeIfSettled(sale: StoredSale): Promise<void> {
    const stillDisputed = sale.cardOrders?.some(
      (candidate) => candidate.state === SaleCardOrderState.DISPUTED
    )
    if (stillDisputed !== false) return

    try {
      await this.terminalService.resumeRouting(sale, 'Dispute settled')
    } catch (error: unknown) {
      // Loud, and not fatal. The sale is correct either way; what is lost is
      // that no further payer is routed until somebody notices.
      this.logger.error(
        `Could not resume routing for sale ${sale.publicId}: ${describeError(error)}`
      )
    }
  }

  /** Publishes one card order to whoever is telling the seller about it. */
  private announce(
    channel: string,
    sale: StoredSale,
    order: { orderId: number; amount: number; confirmDeadlineAt: number }
  ): void {
    const payload: TmaSaleCardOrderEvent = {
      telegramId: sale.telegramId,
      saleId: sale._id.toString(),
      publicId: sale.publicId,
      ...order
    }

    this.eventEmitter.emit(channel, payload)
  }
}
