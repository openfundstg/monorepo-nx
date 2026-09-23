import { StatementSubject } from 'src/shared/interfaces'
import {
  BankProvider,
  ERROR,
  SALE_EVENT_EVIDENCE,
  SaleCardOrderState,
  SaleEventType,
  SaleEvidence,
  SaleMethod,
  SaleReceiverNameSource,
  SaleRemainderPolicy,
  SaleStatementRejection,
  SaleStatementStatus
} from '@transacto/contracts'
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import {
  TmaSale,
  TmaSaleDocument,
  TmaSaleStatus,
  SaleBlockReason
} from 'src/modules/repositories/tma-sale-db/schemas'
import { ensure, generatePublicId, isDuplicateKeyOn } from 'src/shared/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/**
 * Attempts allowed when a generated public id collides.
 *
 * At 36^8 the first attempt fails with probability ~1e-7 per million existing
 * orders, so five retries is a formality — but a unique index without a retry
 * would surface that formality as a user-visible 500.
 */
const PUBLIC_ID_ATTEMPTS = 5

/**
 * Statuses in which a sale is still watching its terminal for money.
 *
 * `CLOSING` belongs here, and that is the whole design of a user-requested
 * stop: the terminal has been told to take no new payers, but a payer already
 * holding an order can still pay, so the order must keep matching, keep
 * counting toward its user's parallel allowance, and stay completable.
 */
const OPEN_STATUSES = [
  TmaSaleStatus.CREATED,
  TmaSaleStatus.TERMINAL_READY,
  TmaSaleStatus.AWAITING_FIAT,
  TmaSaleStatus.CLOSING
] as const

/**
 * Statuses that occupy one of a user's parallel-order slots.
 *
 * Deliberately **not** {@link OPEN_STATUSES}, and the difference is `BLOCKED`.
 * That one is not open — its terminal is stopped and nothing is watching it any
 * more — but its stake stays frozen and it was stopped for breaking a rule of
 * the scheme. Freeing the slot the moment an order is blocked would let a user
 * start a fresh one immediately, which makes being blocked cost nothing.
 *
 * The two lists are separate rather than one widened list because
 * `OPEN_STATUSES` is the guard on `blockIfOpen`, `cancelIfOpen` and
 * `completeIfOpen` — adding `BLOCKED` there would let a blocked order be
 * completed or cancelled afterwards.
 */
const SLOT_HOLDING_STATUSES = [...OPEN_STATUSES, TmaSaleStatus.BLOCKED] as const

/**
 * Endings after which the jar can still be open, and still take money.
 *
 * An order stops; the jar does not. Both of these leave a terminal whose jar
 * has to be closed by its owner before the user's slot comes back — see
 * `jarClosedAt`. `FAILED` is absent because it never got a terminal, and
 * `BLOCKED` because it holds a slot outright.
 */
const JAR_OUTLIVES_ORDER_STATUSES = [
  TmaSaleStatus.COMPLETED,
  TmaSaleStatus.CANCELLED
] as const

/**
 * What this collection was called while the product called a sale a scroll
 * order.
 *
 * Named here rather than passed in from the migration, for the reason
 * {@link TmaSaleDbService.findPricedAtMarketRate} gives about the legacy field
 * names it reads: this is the layer that knows what is on disk, and a caller
 * that had to supply the old name would be a caller that could supply a wrong
 * one.
 */
const LEGACY_SALE_COLLECTION = 'tma_scroll_orders'

@Injectable()
export class TmaSaleDbService {
  private readonly logger = new Logger(TmaSaleDbService.name)

  constructor(
    @InjectModel(TmaSale.name)
    private readonly saleModel: Model<TmaSaleDocument>
  ) {}

  /**
   * Creates a sale, allocating its public id here rather than in the
   * caller.
   *
   * A pre-check for an unused id would still race two concurrent creates, so
   * the unique index is the authority and a duplicate key simply means "draw
   * again". This is the only place in the codebase that handles E11000, and it
   * is deliberately narrow: any other duplicate-key error rethrows untouched.
   */
  async create(data: {
    telegramId: number
    saleMethod: SaleMethod
    fiatAmount: number
    exchangeRate: number
    frozenUsdt: number
    bankType: string
    /** The resolved jar link, or `''` on a card sale. */
    dropLink: string
    remainderPolicy: SaleRemainderPolicy
    receiverName: string
    receiverNameSource: SaleReceiverNameSource
    /**
     * The last four digits of the payout card, on a card sale.
     *
     * `null` on a jar sale. Four and not sixteen — nothing here stores a full
     * PAN; see `cardTail`.
     */
    payoutCardTail: string | null
    /** Whether the bank itself named the card this order pays into. */
    cardVerifiedByBank: boolean
  }): Promise<TmaSale & { _id: Types.ObjectId }> {
    for (let attempt = 1; attempt <= PUBLIC_ID_ATTEMPTS; attempt++) {
      const publicId = generatePublicId()

      try {
        const order = await this.saleModel.create({ ...data, publicId })
        return order.toObject()
      } catch (error: unknown) {
        if (!isDuplicateKeyOn(error, 'publicId')) throw error

        this.logger.warn(
          `Public id ${publicId} collided (attempt ${attempt}/${PUBLIC_ID_ATTEMPTS}), regenerating`
        )
      }
    }

    throw new InternalServerErrorException(ERROR.SALE.PUBLIC_ID_GENERATION_FAILED)
  }

  /**
   * `Model.findById` throws a CastError — surfacing as a 500 — for anything that
   * is not a 24-character hex string, so the shape is checked before the query
   * and a bad id is simply "not found".
   */
  async findById(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    if (!Types.ObjectId.isValid(id)) return null

    return this.saleModel.findById(id).lean()
  }

  async findByPublicId(
    publicId: string
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel.findOne({ publicId }).lean()
  }

  /**
   * One user's orders, newest first.
   *
   * `limit` is optional because two callers want opposite things: the timeline
   * shows a page and nothing more, while the orders screen lists them all. Left
   * off, the query is unbounded — which is the reading it had when it was the
   * only one.
   */
  async findByTelegramId(
    telegramId: number,
    limit?: number
  ): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    const query = this.saleModel.find({ telegramId }).sort({ createdAt: -1 })

    return (limit === undefined ? query : query.limit(limit)).lean()
  }

  /**
   * How many orders this user has actually sold through.
   *
   * Read by the referral programme, which only lets a code be redeemed by
   * someone who has not completed anything yet — so an established user cannot
   * be back-dated onto a link.
   */
  /**
   * How many parallel-order slots this user is holding right now.
   *
   * The figure the trust level is checked against. Counted rather than tracked:
   * a stored counter would drift the first time an order ended by a path that
   * forgot to decrement it, and the failure mode of drift is a user locked out
   * of creating anything with no visible reason.
   */
  /**
   * Moves an open order to CLOSING exactly once.
   *
   * The status guard is the idempotency key: a second tap on "finish", or two
   * requests in the same instant, must not stand the terminal down twice or put
   * a second entry on the timeline. `CLOSING` is excluded from the filter for
   * the same reason, even though it is an open status — an order already
   * winding down has nothing to move to.
   */
  /**
   * Stamps the moment a sale entered its tail, once.
   *
   * **The filter is the idempotency gate**, exactly as `markClosing`'s status
   * list is: `tailReachedAt: null` matches only the first caller, so everything
   * hanging off entering a tail — standing routing down upstream, telling an
   * operator what to transfer, starting the clock on the wait — happens once
   * however often the figures are re-examined. Every settled order and every
   * jar scrape asks the same question again.
   *
   * `null` therefore means "already stamped", not "no such sale", and a caller
   * reads it as "somebody else has done this".
   */
  async markTailReached(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, tailReachedAt: null },
        { $set: { tailReachedAt: new Date() } },
        { new: true }
      )
      .lean()
  }

  /**
   * Stamps the moment an operator was told about a sale's tail, once.
   *
   * The same gate as {@link markTailReached} and a separate field, because the
   * two moments differ: a tail is parked at once and announced only when there
   * is nothing left to ask the seller for. `null` means somebody has already
   * told them.
   */
  async markTailAnnounced(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, tailAnnouncedAt: null },
        { $set: { tailAnnouncedAt: new Date() } },
        { new: true }
      )
      .lean()
  }

  /**
   * Records which message asked the operators about this tail.
   *
   * **Ungated, and not by omission.** It is written after the send by whoever
   * sent it, and a repeated alert is a *newer* message that the reply has to
   * find — so last one wins, deliberately. The alternative would point replies
   * at a message that has scrolled a day out of view.
   *
   * Returns whether it landed, because an alert whose id was not stored is an
   * alert nobody can answer, and the caller has to say so.
   */
  async rememberTailAlert(id: string, messageId: number): Promise<boolean> {
    const result = await this.saleModel.updateOne(
      { _id: id },
      { $set: { tailAlertMessageId: messageId } }
    )

    return result.matchedCount > 0
  }

  /**
   * The sale one tail alert is about.
   *
   * The inbound half of {@link rememberTailAlert}: a reply carries the id of
   * the message it answers and nothing else about what that message said.
   * Served by the index on the field — this runs on every reply anybody writes
   * in the group's General thread, most of which are about nothing.
   */
  async findByTailAlert(messageId: number): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel.findOne({ tailAlertMessageId: messageId }).lean()
  }

  /**
   * Records that an operator has taken this sale's tail on, once.
   *
   * **The filter carries the whole rule**, as `markTailWaived`'s does, and it
   * is the widest of the three gates for a reason: this one stops the seller
   * finishing their own sale. So it may only be taken on a sale that is still
   * open, has actually been asked about, and nobody has claimed already.
   *
   * The status list is the one that accepts new payers. A sale winding down or
   * already ended must not be claimable: an operator told "accepted" would
   * transfer hryvnia into a finished order, which is the exact accident the
   * claim exists to prevent.
   *
   * `null` therefore means "not yours to take" — already claimed, never
   * announced, or over — and the caller says which from the sale it read.
   */
  async markTailClaimed(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        {
          _id: id,
          tailClaimedAt: null,
          tailAnnouncedAt: { $ne: null },
          status: {
            $in: [
              TmaSaleStatus.CREATED,
              TmaSaleStatus.TERMINAL_READY,
              TmaSaleStatus.AWAITING_FIAT
            ]
          }
        },
        { $set: { tailClaimedAt: new Date() } },
        { new: true }
      )
      .lean()
  }

  /**
   * Credits a tail the seller says has arrived, once.
   *
   * **Not `creditExecutedOrder`, because there is no order.** A tail is the
   * stretch under the pipeline's floor: Transacto never routed anything for it,
   * so there is no order id to book it against and no upstream execution to
   * mark. What arrives is one transfer somebody made by hand, and the seller
   * saying so is the only record of it — the same testimony-against-interest a
   * card sale runs on everywhere else.
   *
   * `tailConfirmedAt: null` in the filter is the gate, so two taps credit once.
   * `$inc` rather than a computed `$set`: the figure is read, shown and
   * confirmed over three round trips, and anything that landed in between is
   * money this must not overwrite.
   *
   * `null` means somebody already confirmed it.
   */
  async creditTail(
    id: string,
    kopecks: number
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, tailConfirmedAt: null },
        { $inc: { receivedAmount: kopecks }, $set: { tailConfirmedAt: new Date() } },
        { new: true }
      )
      .lean()
  }

  /**
   * Records that the tail was given back rather than transferred.
   *
   * **An operator's decision, and there is no timer behind it.** A seller
   * saying the transfer never came is making a claim about what an operator
   * did; only a person who can look at both sides settles that, so what reaches
   * here is the verdict rather than the elapsed time.
   *
   * The filter is the idempotency gate and nothing more: an alert must have
   * gone out, and nobody may have given it back already. Two replies give it
   * back once.
   *
   * {@link TmaSale.remainderPolicy} is deliberately left alone — see the field.
   */
  async markTailWaived(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, tailWaivedAt: null, tailAnnouncedAt: { $ne: null } },
        { $set: { tailWaivedAt: new Date() } },
        { new: true }
      )
      .lean()
  }

  async markClosing(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        {
          _id: id,
          status: {
            $in: [
              TmaSaleStatus.CREATED,
              TmaSaleStatus.TERMINAL_READY,
              TmaSaleStatus.AWAITING_FIAT
            ]
          }
        },
        { $set: { status: TmaSaleStatus.CLOSING } },
        { new: true }
      )
      .lean()
  }

  /**
   * Every order waiting for its last outstanding payments to resolve.
   *
   * Read by the cron that settles them. Polled rather than driven by whichever
   * signal happens to close the final order — a scrape, an `order.cancelled`
   * webhook, the 30-second `orders_list` sync — because a poll needs none of
   * them to be reliable and picks up again by itself after a restart.
   */
  async findClosing(): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel.find({ status: TmaSaleStatus.CLOSING }).lean()
  }

  /**
   * Every open sale that has taken money in, for the sweep that re-examines
   * their figures.
   *
   * **Deliberately not "every sale in its tail".** Being in one is arithmetic
   * over two fields against a floor that is configurable, so a query for it
   * would be a `$expr` over a computed difference — unindexable, and a second
   * statement of a rule `saleTailKopecks` already owns. The set below is the
   * widest one that is cheap and indexed, and the caller filters it with the
   * same function everything else uses.
   *
   * It is small by construction: a sale is open only while it is collecting,
   * and how many a user may have at once is what the trust ladder rations.
   * `receivedAmount > 0` drops the ones that have not started, which can have
   * no tail at all.
   */
  async findOpenWithMoney(): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel
      .find({ status: { $in: OPEN_STATUSES }, receivedAmount: { $gt: 0 } })
      .lean()
  }

  async countSlotsHeldByTelegramId(telegramId: number): Promise<number> {
    return this.saleModel.countDocuments({
      telegramId,
      $or: this.slotHoldingConditions()
    })
  }

  /**
   * Every order currently holding a slot, whichever reason it holds one for.
   *
   * Read by the reconciliation sweep, which has to answer a question this
   * collection cannot: whether the jar is still there. It shares
   * {@link slotHoldingConditions} with the count rather than restating it —
   * a sweep looking at a different set from the one being counted would leave
   * exactly the orders that are stuck.
   */
  async findHoldingSlots(): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel.find({ $or: this.slotHoldingConditions() }).lean()
  }

  /** The two reasons an order takes up one of its user's slots. */
  private slotHoldingConditions(): Record<string, unknown>[] {
    return [
      { status: { $in: SLOT_HOLDING_STATUSES } },
      // An order that ended and left its jar open, for as long as it stays
      // open. The jar can still take money that nothing will ever match, and
      // the only person who can stop that is the one who owns it.
      //
      // **Unbounded on purpose, and this is the second time it has been.** A
      // time limit was tried — an hour — because the rule had locked a NEWBIE
      // out at "4/1 running" with no way to bring the count down. But the limit
      // treated the symptom: the count came down while the jars stayed open, so
      // the risk the rule exists for simply went unaccounted, and the user was
      // never told what had happened either way. The fix is that the product
      // now *says* which jar to close — `slotsAwaitingJarClosure` on the create
      // form's config, the card on the sale's own screen, and the operator's
      // RELEASE_JAR for the case where the bank will not answer.
      //
      // `cardId: { $ne: null }` keeps out the orders that never got a terminal
      // at all: there is no jar to close, so there would be nothing the user
      // could do to release the slot.
      //
      // **And `saleMethod` keeps out the card sales, for the same reason.**
      // Every card sale has a `cardId` too — the credential is what routes a
      // payer to their card — and none of them has a jar, so this branch held
      // one seller's slot for ever with nothing they could go and close. The
      // rule is `saleHasJar` in `src/shared/utils`; a Mongo filter cannot call
      // it, so this is the one restatement of it and it is marked as such.
      // `$ne` also matches a document written before the field existed, which
      // the backfill migration has already set to `JAR`.
      {
        status: { $in: JAR_OUTLIVES_ORDER_STATUSES },
        cardId: { $ne: null },
        saleMethod: { $ne: SaleMethod.CARD },
        jarClosedAt: null
      }
    ]
  }

  /**
   * This user's finished sales that are still holding a slot, newest first.
   *
   * The half of {@link countSlotsHeldByTelegramId} a user can act on. The count
   * says a slot is taken; this says which sale took it and which bank's jar to
   * go and close — without which the create form can only tell somebody with no
   * running sale that they have too many running sales.
   *
   * The filter is the second branch of {@link slotHoldingConditions}, and it is
   * read from there rather than restated: a list that disagreed with the count
   * would name the wrong jars, which is worse than naming none.
   */
  async findAwaitingJarClosureByTelegramId(
    telegramId: number
  ): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    const [, endedWithOpenJar] = this.slotHoldingConditions()

    return this.saleModel.find({ telegramId, ...endedWithOpenJar }).sort({ updatedAt: -1 }).lean()
  }

  /**
   * Declares a jar closed because an operator said so, not because a bank did.
   *
   * Separate from {@link markJarClosedByCardId}, which is the scraper reporting
   * what a bank answered. This is a human overriding that rule for one order
   * when the bank will not answer at all — so it is keyed by the order, never
   * by the card: a card can carry several sales, and an operator deciding about
   * one of them has not looked at the others.
   *
   * Guarded on `jarClosedAt: null` so a second press cannot move a timestamp
   * that is already recorded.
   */
  async markJarClosedById(saleId: string | Types.ObjectId): Promise<boolean> {
    const result = await this.saleModel.updateOne(
      { _id: saleId, jarClosedAt: null },
      { $set: { jarClosedAt: new Date() } }
    )

    return (result.modifiedCount ?? 0) > 0
  }

  /**
   * Records that the bank has reported this card's jar closed.
   *
   * Keyed by card rather than by order id because the scraper is what notices,
   * and all it has is the terminal. Idempotent: a jar reported closed twice
   * keeps the first timestamp, so the sweep cannot see the moment move.
   */
  async markJarClosedByCardId(cardId: number): Promise<number> {
    const result = await this.saleModel.updateMany(
      { cardId, jarClosedAt: null },
      { $set: { jarClosedAt: new Date() } }
    )

    return result.modifiedCount ?? 0
  }

  /**
   * What this user's live orders account for, in frozen USDT cents.
   *
   * The same statuses that hold a slot, because they are the same orders that
   * hold a stake: an order still running has its USDT frozen, and a blocked one
   * keeps it frozen on purpose. Everything else has either committed its stake
   * or given it back.
   *
   * Read by the migration that repairs orphaned stakes — a user's
   * `frozenBalance` above this sum is USDT frozen for nothing.
   */
  async sumFrozenStakesByTelegramId(telegramId: number): Promise<number> {
    const [totals] = await this.saleModel
      .aggregate<{ frozen: number }>([
        { $match: { telegramId, status: { $in: SLOT_HOLDING_STATUSES } } },
        { $group: { _id: null, frozen: { $sum: '$frozenUsdt' } } },
        { $project: { _id: 0, frozen: 1 } }
      ])
      .exec()

    return totals?.frozen ?? 0
  }

  async countCompletedByTelegramId(telegramId: number): Promise<number> {
    return this.saleModel.countDocuments({
      telegramId,
      status: TmaSaleStatus.COMPLETED
    })
  }

  async updateStatus(
    id: string,
    status: TmaSaleStatus
  ): Promise<TmaSale & { _id: Types.ObjectId }> {
    const result = await this.saleModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status,
            ...(status === TmaSaleStatus.COMPLETED ? { completedAt: new Date() } : {})
          }
        },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.SALE.NOT_FOUND)
    return result
  }

  /**
   * Links Transacto terminal IDs to this sale after successful API call.
   *
   * `traderId` is stored alongside them because every downstream lookup —
   * scraper, terminal sync, order polling — keys on `{ traderId, cardId }`.
   */
  async linkTerminal(
    id: string,
    transactoTerminalId: number,
    cardId: number,
    traderId: number
  ): Promise<TmaSale & { _id: Types.ObjectId }> {
    const result = await this.saleModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            transactoTerminalId,
            cardId,
            traderId,
            status: TmaSaleStatus.TERMINAL_READY
          }
        },
        { returnDocument: 'after' }
      )
      .lean()

    if (!result) throw new NotFoundException(ERROR.SALE.NOT_FOUND)
    this.logger.log(
      `Linked terminal ${transactoTerminalId} (cardId: ${cardId}, traderId: ${traderId}) to sale ${id}`
    )
    return result
  }

  /**
   * Find sales by Transacto terminal ID — used when fiat arrives
   * and we need to complete the corresponding sale.
   */
  async findOpenByTerminalId(
    transactoTerminalId: number
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOne({ transactoTerminalId, status: { $in: OPEN_STATUSES } })
      .lean()
  }

  /**
   * The reverse bridge the whole progress pipeline depends on.
   *
   * A bank scrape and an order webhook both know only `cardId`; this is the
   * only route back to the `telegramId` whose socket room the update belongs
   * in. Restricted to open orders so a completed order's terminal — which
   * Transacto may keep reusing — cannot resurrect it.
   */
  async findOpenByCardId(
    cardId: number
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel.findOne({ cardId, status: { $in: OPEN_STATUSES } }).lean()
  }

  /**
   * Whether this card's sale is over while its jar is still open.
   *
   * The window between an ending and the jar being closed, which the user
   * controls and nobody else can shorten: routing was switched off at the
   * ending, so **no Transacto order can ever be sent here again**, and the
   * terminal is still scraped for one reason only — to notice the closure that
   * gives the user their slot back.
   *
   * What the scraper does with that: hryvnia leaving such a jar is its owner
   * withdrawing their own settled money, not a trader emptying a jar that
   * payers are still being routed to. The same reading means fraud in every
   * other state and means nothing here, and only this collection knows which.
   *
   * `CLOSING` is deliberately absent — it is an {@link OPEN_STATUSES} member,
   * with orders still outstanding and money still expected, so a drop there is
   * exactly as serious as it has always been.
   */
  async isAwaitingJarClosureByCardId(cardId: number): Promise<boolean> {
    const order = await this.saleModel
      .findOne(
        {
          cardId,
          status: { $in: JAR_OUTLIVES_ORDER_STATUSES },
          // A card sale has no jar, so it is never awaiting one — see
          // `saleHasJar`. Its terminal is not scraped either, so this can only
          // be reached by a mix-up; answering `true` for one would tell the
          // scraper to read hryvnia leaving a jar that does not exist as its
          // owner withdrawing, which is the one reading that means nothing.
          saleMethod: { $ne: SaleMethod.CARD },
          jarClosedAt: null
        },
        { _id: 1 }
      )
      .lean()

    return order !== null
  }

  /**
   * Takes over the collection this used to be called, if it is still there.
   *
   * A rename of the *collection*, which no query can express and no `@Schema`
   * decorator can perform: Mongoose binds this model to `tma_sales`, and a
   * database that still holds `tma_scroll_orders` answers every read with
   * nothing. So the one operation that can fix it is issued through the driver,
   * from the service that owns the collection — the layering rule says Mongoose
   * lives here, and this is Mongoose.
   *
   * **The target usually exists already, and that is our own doing.** Mongoose
   * runs with `autoCreate: true`, so the moment a process builds this model it
   * issues `createCollection('tma_sales')` — the migration CLI included. By the
   * time `up()` is called the destination is therefore present and empty, and a
   * plain rename fails with `NamespaceExists`. Dropping an empty target first is
   * what makes this runnable at all rather than a statement that throws on the
   * one attempt it gets.
   *
   * **A target with documents in it is refused, loudly.** That is not our
   * bootstrap; it is a process that has been serving traffic against the new
   * name while the old data sat under the old one, so the sales are split across
   * two collections and merging them is a judgement about somebody's money. The
   * migration stops rather than guessing.
   *
   * Idempotent: a database already renamed has no legacy collection, and one
   * that never had it — a fresh install — is the same case. Returns whether it
   * actually moved anything.
   */
  /**
   * Writes {@link SaleMethod.JAR} onto every sale that predates the variant.
   *
   * Every one of them was a jar sale — the card variant did not exist — so this
   * states a fact rather than choosing a default. It has to be stated because
   * `.lean()` does not apply Mongoose defaults: without it, `saleMethod` reads
   * as `undefined` on historical documents, and every place that switches on it
   * would need a `?? JAR` that one of them will eventually be written without.
   *
   * Idempotent by filter: it matches only documents with no value, which the
   * update itself gives one. A second run finds nothing and says so.
   *
   * Returns how many were written.
   */
  async backfillSaleMethod(): Promise<number> {
    const result = await this.saleModel.updateMany(
      { saleMethod: { $exists: false } },
      { $set: { saleMethod: SaleMethod.JAR } }
    )

    return result.modifiedCount
  }

  async adoptLegacyCollection(): Promise<boolean> {
    const connection = this.saleModel.db
    const target = this.saleModel.collection.name
    const present = await connection.listCollections()

    if (!present.some((collection) => collection.name === LEGACY_SALE_COLLECTION)) return false

    if (present.some((collection) => collection.name === target)) {
      const strays = await this.saleModel.estimatedDocumentCount()
      ensure(
        strays === 0,
        new ConflictException(
          `${target} already holds ${strays} document(s) while ${LEGACY_SALE_COLLECTION} still ` +
            `exists — sales are split across both and merging them is not this migration's call`
        )
      )

      await connection.db?.dropCollection(target)
    }

    // Through the driver handle: renaming a collection is not a query, and
    // Mongoose's own `Connection` does not offer it.
    await connection.db?.renameCollection(LEGACY_SALE_COLLECTION, target)

    return true
  }

  /**
   * This user's orders that ended having moved money, oldest first.
   *
   * The set an earnings figure is built from, and it reuses
   * {@link JAR_OUTLIVES_ORDER_STATUSES} rather than restating its two members:
   * "the order finished and its jar outlived it" and "the order finished having
   * sold something" are the same two statuses, and a second list would be a
   * second place to remember the next terminal status in. `BLOCKED` and
   * `FAILED` moved nothing, and the open ones have not finished moving it.
   *
   * Projected to the figures a settlement is computed from. The full documents
   * carry an `events` timeline that grows for the life of the order, and
   * pulling a user's whole history of those to read seven scalars is the cost
   * this finder exists to avoid.
   *
   * Ascending, because everything that consumes it walks a history forwards.
   */
  async findSettledByTelegramId(
    telegramId: number
  ): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel
      .find(
        { telegramId, status: { $in: JAR_OUTLIVES_ORDER_STATUSES } },
        {
          status: 1,
          frozenUsdt: 1,
          exchangeRate: 1,
          fiatAmount: 1,
          receivedAmount: 1,
          jarBalance: 1,
          openingJarBalance: 1,
          remainderPolicy: 1,
          createdAt: 1
        }
      )
      .sort({ createdAt: 1 })
      .lean()
  }

  /**
   * The remainder policy behind each of these cards, newest order per card.
   *
   * **Any status, unlike {@link findOpenByCardId}.** The trader's dashboard
   * labels a terminal by what its order does at the end, and a terminal outlives
   * the order that made it — it stays on screen while it has an unread alert
   * and is reachable through search forever. A finished order still explains
   * what the terminal was for.
   *
   * Sorted by `_id`, which is monotonic per insert, so "newest" needs no extra
   * index and cannot tie. One query for the whole page rather than one per row.
   */
  async findRemainderPoliciesByCardIds(
    cardIds: readonly number[]
  ): Promise<Map<number, SaleRemainderPolicy>> {
    if (!cardIds.length) return new Map()

    const orders = await this.saleModel
      .find({ cardId: { $in: cardIds } }, { cardId: 1, remainderPolicy: 1 })
      .sort({ _id: 1 })
      .lean()

    // Oldest first, so a later order on the same card overwrites an earlier one
    // and the map ends up holding the newest.
    return orders.reduce<Map<number, SaleRemainderPolicy>>((byCard, order) => {
      if (order.cardId !== null && order.remainderPolicy)
        byCard.set(order.cardId, order.remainderPolicy)

      return byCard
    }, new Map())
  }

  /**
   * Appends a timeline entry and, for money events, advances `receivedAmount`
   * in the same atomic update so the two can never disagree.
   *
   * `evidence` says **who says so**, and defaults to the one answer its type
   * usually has — see `SALE_EVENT_EVIDENCE`. Three types are reached on more
   * than one kind of word and those callers pass their own: an order can be
   * confirmed by a seller tapping yes or by a bank statement contradicting
   * their denial, and a dispute can be a denial, a deadline or a document.
   */
  async appendEvent(
    id: string,
    event: {
      type: SaleEventType
      amount?: number
      orderId?: number
      /** Only `STATEMENT_CORRECTED` carries it — the seller's own figure. */
      declaredAmount?: number
      at: number
      evidence?: SaleEvidence
      statementId?: Types.ObjectId
    },
    receivedDelta = 0
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findByIdAndUpdate(
        id,
        {
          $push: {
            events: {
              type: event.type,
              amount: event.amount ?? null,
              orderId: event.orderId ?? null,
              declaredAmount: event.declaredAmount ?? null,
              at: event.at,
              evidence: event.evidence ?? SALE_EVENT_EVIDENCE[event.type],
              statementId: event.statementId ?? null,
              corroboratedByStatementId: null,
              corroboratedAt: null
            }
          },
          ...(receivedDelta !== 0 ? { $inc: { receivedAmount: receivedDelta } } : {})
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Stamps every claim an accepted statement covers as settled by it.
   *
   * **The checkpoint, and it writes backwards.** A statement vouches for a
   * period; everything the *seller* asserted inside that period is now a matter
   * of record rather than of their word, and those entries were written days
   * earlier. `arrayFilters` is what makes that one atomic update rather than a
   * read, a rewrite of the whole array, and a race with whatever else is
   * touching this sale.
   *
   * Four conditions, each deliberate:
   *
   * - **`evidence: SELLER` only.** An order arriving and an order executing are
   *   Transacto's facts and were never in doubt; a deadline passing is a clock.
   *   Stamping those would claim a document corroborated something it has
   *   nothing to say about.
   * - **Not already stamped.** The first statement to cover a claim is the one
   *   that settled it. Keeping the first keeps the trail honest about *when* a
   *   claim stopped being only a claim.
   * - **Inside the document's own period**, inclusive — a statement proves
   *   nothing about a moment it does not cover, which is the same rule that
   *   makes `PERIOD_TOO_SHORT` a refusal.
   * - **`at` is epoch milliseconds**, so the bounds are converted rather than
   *   compared as dates. Comparing a `Date` against a `number` in Mongo matches
   *   nothing at all and does it silently.
   *
   * Answers how many entries it stamped.
   */
  async corroborateEvents(
    id: string,
    period: { from: Date; to: Date },
    statementId: Types.ObjectId,
    at: Date
  ): Promise<number> {
    const result = await this.saleModel.updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          'events.$[claim].corroboratedByStatementId': statementId,
          'events.$[claim].corroboratedAt': at
        }
      },
      {
        arrayFilters: [
          {
            'claim.evidence': SaleEvidence.SELLER,
            'claim.corroboratedByStatementId': null,
            'claim.at': { $gte: period.from.getTime(), $lte: period.to.getTime() }
          }
        ]
      }
    )

    return result.modifiedCount ?? 0
  }

  /**
   * Credits one settled order towards the target, exactly once.
   *
   * The `creditedOrderIds: { $ne: orderId }` filter and the `$addToSet` are the
   * whole point: the same order can be reported settled twice — once by the
   * scraper matching a jar delta, once by Transacto reporting it paid in the
   * admin panel — and counting it twice would complete an order on half the
   * money. Doing the check inside the update makes it atomic, where a
   * read-then-write would still race two concurrent reports.
   *
   * Returns `null` when this order was already credited, which is a normal
   * outcome and not an error.
   */
  /**
   * Moves the sale's checkpoint forward, and corrects what a seller understated.
   *
   * One write, because the two halves are one fact: this document has been read
   * and everything it covers is now settled. Recording the checkpoint without
   * the correction would declare the claims checked while leaving the figures
   * wrong; recording the correction without the checkpoint would apply it again
   * on the next statement covering the same period.
   *
   * `correctionKopecks` is what the bank showed above what the seller claimed,
   * summed across the orders the document reaches. Zero is the ordinary case —
   * a seller who told the truth — and still writes the checkpoint, because
   * having been checked is the fact that matters.
   *
   * Not guarded on the checkpoint moving forward. A statement covering an
   * earlier period cannot produce a correction for orders it does not reach, so
   * the correction is zero by construction; letting the date go backwards would
   * only re-open claims that have already been settled by a later document.
   *
   * **Three things in the one update, for the same reason the first two are.**
   * The per-order `provenAmount` is what the seller's screen draws the
   * correction from and the `STATEMENT_CORRECTED` entries are what say which
   * document did it; written separately, a failure between them would leave a
   * sale whose total moved, whose rows did not, and whose timeline never
   * mentioned it. The checkpoint filter is the gate for all of it.
   */
  async applyStatementCheckpoint(
    id: string,
    checkpointAt: Date,
    // Structural rather than the domain's own `StatementCorrection`, because
    // the arrow points the other way: a repository may not import from a module
    // that consumes it. The caller's type is assignable to this one.
    correction: {
      readonly correctionKopecks: number
      readonly corrected: readonly {
        readonly orderId: number
        readonly declaredKopecks: number
        readonly provenKopecks: number
      }[]
    }
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    const { correctionKopecks, corrected } = correction
    const at = Date.now()

    // One filter per corrected order, named `o0`, `o1`… — `cardOrders.$` would
    // match only the first, and these are positional updates to several rows of
    // the same array in one statement.
    const arrayFilters = corrected.map((entry, index) => ({
      [`o${index}.orderId`]: entry.orderId
    }))

    const provenAmounts = Object.fromEntries(
      corrected.map((entry, index) => [
        `cardOrders.$[o${index}].provenAmount`,
        entry.provenKopecks
      ])
    )

    const events = corrected.map((entry) => ({
      type: SaleEventType.STATEMENT_CORRECTED,
      amount: entry.provenKopecks,
      declaredAmount: entry.declaredKopecks,
      orderId: entry.orderId,
      at,
      evidence: SaleEvidence.STATEMENT
    }))

    return this.saleModel
      .findOneAndUpdate(
        { _id: id, statementCheckpointAt: { $not: { $gte: checkpointAt } } },
        {
          $set: { statementCheckpointAt: checkpointAt, ...provenAmounts },
          ...(correctionKopecks > 0 ? { $inc: { receivedAmount: correctionKopecks } } : {}),
          ...(events.length > 0 ? { $push: { events: { $each: events } } } : {})
        },
        { returnDocument: 'after', ...(arrayFilters.length > 0 ? { arrayFilters } : {}) }
      )
      .lean()
  }

  async creditExecutedOrder(
    id: string,
    orderId: number,
    amount: number,
    at: number
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, creditedOrderIds: { $ne: orderId } },
        {
          $addToSet: { creditedOrderIds: orderId },
          $inc: { receivedAmount: amount },
          $push: {
            events: { type: SaleEventType.PAYMENT_MATCHED, amount, orderId, at }
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Records a Transacto order against a card sale, exactly once.
   *
   * The `cardOrders.orderId: { $ne: orderId }` filter is the idempotency key,
   * in the manner of {@link creditExecutedOrder}: the same order can be
   * reported twice — a webhook and the thirty-second sync both see it — and a
   * second row would ask the seller the same question again and let one
   * confirmation settle the other.
   *
   * Returns `null` when the order was already recorded, which is an ordinary
   * outcome and not an error.
   */
  async pushCardOrder(
    id: string,
    order: { orderId: number; amount: number; confirmDeadlineAt: Date }
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, saleMethod: SaleMethod.CARD, 'cardOrders.orderId': { $ne: order.orderId } },
        {
          $push: {
            cardOrders: {
              orderId: order.orderId,
              amount: order.amount,
              state: SaleCardOrderState.AWAITING_CONFIRMATION,
              arrivedAt: new Date(),
              confirmDeadlineAt: order.confirmDeadlineAt,
              answeredAt: null,
              statements: []
            }
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Moves one card order from one of the states it may be in to another.
   *
   * **The `from` filter is the idempotency key, and it is doing real work
   * here.** Both surfaces that can answer an order — the sale's page and the
   * bot's inline keyboard — call the same method, and a seller who taps one and
   * then the other is the expected case rather than the exotic one. Whichever
   * arrives second matches nothing and returns `null`, which the caller reads
   * as "already answered" rather than as a failure.
   *
   * `null` is therefore never on its own evidence that the order does not
   * exist. A caller that needs to tell those apart reads the sale first.
   */
  async moveCardOrder(
    id: string,
    orderId: number,
    from: readonly SaleCardOrderState[],
    to: SaleCardOrderState,
    options: {
      readonly answered?: boolean
      readonly declaredAmount?: number
      readonly provenAmount?: number
    } = {}
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        {
          _id: id,
          saleMethod: SaleMethod.CARD,
          cardOrders: { $elemMatch: { orderId, state: { $in: [...from] } } }
        },
        {
          $set: {
            'cardOrders.$.state': to,
            ...(options.answered === true ? { 'cardOrders.$.answeredAt': new Date() } : {}),
            // Spread rather than assigned: an `undefined` here would be written
            // as `null` and read back as "the seller declared nothing", which is
            // a different claim from "the seller declared the whole amount".
            ...(typeof options.declaredAmount === 'number'
              ? { 'cardOrders.$.declaredAmount': options.declaredAmount }
              : {}),
            // Written in the same update as the state, so an order can never be
            // settled on a document without the figure that document proved.
            // The checkpoint writes this one for orders already inside
            // `receivedAmount`; this is the other half, for the disputed order
            // the same statement settles outright.
            ...(typeof options.provenAmount === 'number'
              ? { 'cardOrders.$.provenAmount': options.provenAmount }
              : {})
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Records an uploaded statement against one disputed order.
   *
   * **The id is minted by the caller**, not by Mongo, because the file on disk
   * is named after it: a `$push` that let the database choose would leave the
   * bytes written under a name nothing yet knew.
   *
   * **`answers` is the caller's own decision, re-applied atomically.** Two
   * different orders may legitimately receive a statement — a disputed one, and
   * a confirmed one whose seller declared it arrived short — and which of those
   * this upload is for was settled by `SaleStatementService.load` before a byte
   * was read. Repeating that rule here as a second Mongo filter is how the two
   * came apart the first time: this write insisted on `DISPUTED`, so every
   * checkpoint statement was stored on disk and then refused with a 409.
   *
   * What the filter is for is the race — the order being answered between the
   * read and the write — so it re-checks the same condition the caller acted on
   * and nothing else.
   */
  async pushStatement(
    id: string,
    orderId: number,
    statement: {
      _id: Types.ObjectId
      bank: BankProvider
      storedName: string
      sizeBytes: number
    },
    answers: StatementSubject
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    const stillTrue =
      answers === StatementSubject.DENIAL
        ? { state: SaleCardOrderState.DISPUTED }
        : { declaredAmount: { $exists: true } }

    return this.saleModel
      .findOneAndUpdate(
        {
          _id: id,
          saleMethod: SaleMethod.CARD,
          cardOrders: { $elemMatch: { orderId, ...stillTrue } }
        },
        {
          $push: {
            'cardOrders.$.statements': {
              ...statement,
              status: SaleStatementStatus.PARSING,
              rejection: null,
              uploadedAt: new Date(),
              periodFrom: null,
              periodTo: null,
              ownerName: null,
              accountTail: null
            }
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Writes a verdict onto one statement.
   *
   * Addressed by its own id through the array filter rather than by position:
   * a second statement can be uploaded while the first is still being checked,
   * and `cardOrders.$.statements.$` cannot express two levels anyway.
   */
  async markStatementParsed(
    id: string,
    statementId: Types.ObjectId,
    verdict: {
      status: SaleStatementStatus
      rejection: SaleStatementRejection | null
      periodFrom?: Date | null
      periodTo?: Date | null
      ownerName?: string | null
      accountTail?: string | null
    }
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            'cardOrders.$[].statements.$[statement].status': verdict.status,
            'cardOrders.$[].statements.$[statement].rejection': verdict.rejection,
            'cardOrders.$[].statements.$[statement].periodFrom': verdict.periodFrom ?? null,
            'cardOrders.$[].statements.$[statement].periodTo': verdict.periodTo ?? null,
            'cardOrders.$[].statements.$[statement].ownerName': verdict.ownerName ?? null,
            'cardOrders.$[].statements.$[statement].accountTail': verdict.accountTail ?? null
          }
        },
        { returnDocument: 'after', arrayFilters: [{ 'statement._id': statementId }] }
      )
      .lean()
  }

  /**
   * Replaces the recipient's name with the one a bank stated.
   *
   * Only ever moves `DECLARED` to `STATEMENT`, never back and never between two
   * statements: the first accepted document settles who the account belongs to,
   * and a later one disagreeing is an operator's question rather than another
   * overwrite. The filter is what makes that true rather than remembered.
   */
  async rewriteReceiverName(
    id: string,
    receiverName: string
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, receiverNameSource: SaleReceiverNameSource.DECLARED },
        {
          $set: {
            receiverName,
            receiverNameSource: SaleReceiverNameSource.STATEMENT
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Sales holding a statement whose bytes are older than the cut-off.
   *
   * Whole sales rather than statements: they are nested two levels deep, the
   * set is small, and an aggregation to flatten it would be more machinery than
   * the sweep it feeds. The caller picks the statements out.
   */
  async findSalesWithStatementsBefore(
    cutoff: Date
  ): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel
      .find({
        saleMethod: SaleMethod.CARD,
        cardOrders: {
          $elemMatch: {
            statements: { $elemMatch: { uploadedAt: { $lt: cutoff }, purgedAt: null } }
          }
        }
      })
      .lean()
  }

  /**
   * Records that one statement's bytes are gone.
   *
   * Written **after** the file is removed, never before: a row claiming a purge
   * that did not happen leaves the document on disk with nothing pointing at
   * it, which is the one outcome a retention sweep must not produce.
   */
  async markStatementPurged(id: string, statementId: Types.ObjectId): Promise<boolean> {
    const result = await this.saleModel.updateOne(
      { _id: id },
      { $set: { 'cardOrders.$[].statements.$[statement].purgedAt': new Date() } },
      { arrayFilters: [{ 'statement._id': statementId, 'statement.purgedAt': null }] }
    )

    return result.modifiedCount > 0
  }

  /**
   * The sale one Transacto order belongs to.
   *
   * **How an operator gets from a dispute to the evidence.** A dispute is
   * worked in Transacto's own panel, where the order is a number and nothing
   * else — no sale id, no user, no public code. Served by the
   * `{ 'cardOrders.orderId': 1 }` index; without it this is a collection scan,
   * which is the same as not having the feature at three in the morning.
   */
  async findByCardOrderId(orderId: number): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel.findOne({ 'cardOrders.orderId': orderId }).lean()
  }

  /**
   * Card orders whose confirmation window has run out **or is about to**.
   *
   * Returns whole sales rather than orders, because the sweep has to act on
   * both: the order becomes a dispute and the sale's terminal stops routing.
   * A sale may hold only one unanswered order at a time — the credential is
   * capped at one open order — so there is no ambiguity about which.
   *
   * `due` is a moment slightly in the future rather than now, and the caller is
   * what decides how far: routing is stood down before the window closes, so
   * Transacto cannot route a second payer in the same second the first order
   * expires. See `TMA_CARD_SALE_ROUTING_CUTOFF_MS`. The two cases are told
   * apart by the sweep against the real clock, not here — this query's job is
   * to find the documents, and one of them being still alive is the point.
   */
  async findCardOrdersDueBy(due: Date): Promise<(TmaSale & { _id: Types.ObjectId })[]> {
    return this.saleModel
      .find({
        saleMethod: SaleMethod.CARD,
        cardOrders: {
          $elemMatch: {
            state: SaleCardOrderState.AWAITING_CONFIRMATION,
            confirmDeadlineAt: { $lte: due }
          }
        }
      })
      .lean()
  }

  /**
   * Records the latest scraped jar balance, and seeds the opening one.
   *
   * Guarded on the value actually differing so the scraper's heartbeat — which
   * re-broadcasts an unchanged balance every 15 seconds — does not turn into a
   * write per tick. A `null` return therefore means "nothing changed", not
   * "order missing".
   *
   * `openingJarBalance` is written through `$ifNull` in the same update, so the
   * very first scrape sets it and no later one can move it. An aggregation
   * pipeline rather than `$setOnInsert`, which never fires here — the document
   * already exists by the time any scrape reaches it. See the field's own note
   * for why the baseline matters.
   */
  async updateJarBalance(
    id: string,
    jarBalance: number
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, jarBalance: { $ne: jarBalance } },
        [
          {
            $set: {
              jarBalance,
              openingJarBalance: { $ifNull: ['$openingJarBalance', jarBalance] }
            }
          }
        ],
        // Mongoose 9 refuses an array update without this, and refuses it at
        // runtime rather than at compile time — the query simply threw on every
        // scrape that moved a Mini App jar's balance.
        { returnDocument: 'after', updatePipeline: true }
      )
      .lean()
  }

  /**
   * Moves an open order to AWAITING_FIAT exactly once.
   *
   * Guarded on the current status so a burst of order webhooks produces one
   * transition rather than one write per webhook.
   */
  async markAwaitingFiat(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        {
          _id: id,
          status: { $in: [TmaSaleStatus.CREATED, TmaSaleStatus.TERMINAL_READY] }
        },
        { $set: { status: TmaSaleStatus.AWAITING_FIAT } },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Atomically closes an order that has received its full target.
   *
   * The status guard is the idempotency key: two concurrent payment matches
   * both call this, and only the first one gets a document back, so the balance
   * commit that follows can never run twice for the same order.
   */
  /**
   * Atomically stops an open order for breaking a rule.
   *
   * Guarded on the current status for the same reason `completeIfOpen` is: the
   * checks that call this run on the scraper's hot path, several times a
   * minute, and only the call that actually flipped the status gets a document
   * back — so the terminal is torn down and the user notified exactly once,
   * however many scrapes observe the same violation.
   *
   * Deliberately does *not* touch the frozen balance. The stake stays frozen
   * pending review, which is the whole point of blocking rather than failing.
   */
  async blockIfOpen(
    id: string,
    reason: SaleBlockReason,
    observedGoal: number | null = null
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, status: { $in: OPEN_STATUSES } },
        {
          $set: {
            status: TmaSaleStatus.BLOCKED,
            blockReason: reason,
            observedGoal
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Atomically stops an open order at the user's request.
   *
   * Status-guarded like its siblings, and for the same reason: this one hands
   * money back, so two taps arriving together must produce one refund. Only the
   * call that actually flipped the status gets a document, and only it refunds.
   */
  async cancelIfOpen(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, status: { $in: OPEN_STATUSES } },
        { $set: { status: TmaSaleStatus.CANCELLED, completedAt: new Date() } },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Atomically closes a funded order, recording what was handed back with it.
   *
   * The status guard is the idempotency key for the whole completion: two
   * payment matches arriving together both reach here, and only the one that
   * actually flipped the status gets a document — so the balance commit that
   * follows can never run twice for one order.
   *
   * The refund figures are written **in the same update**, not afterwards. They
   * are computed from the pre-flip document, which the flip does not touch, and
   * folding them in means there is no window in which an order is closed but
   * does not yet say what it gave back. Zero for every order that filled its
   * jar, which is the default and the overwhelming majority.
   */
  async completeIfOpen(
    id: string,
    refund: { usdt: number; fiat: number } = { usdt: 0, fiat: 0 }
  ): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, status: { $in: OPEN_STATUSES } },
        {
          $set: {
            status: TmaSaleStatus.COMPLETED,
            completedAt: new Date(),
            refundedRemainderUsdt: refund.usdt,
            refundedRemainderFiat: refund.fiat
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Puts a blocked order back to work.
   *
   * Guarded on `BLOCKED` and on nothing else, which is what makes it the
   * idempotency gate: two operators pressing at once produce one transition,
   * and the second gets `null` rather than a second terminal being brought up.
   *
   * `blockReason` and `observedGoal` are cleared with the status — leaving them
   * behind would show a live order still explaining why it was stopped, and the
   * Mini App renders that reason to the user.
   */
  async resumeIfBlocked(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, status: TmaSaleStatus.BLOCKED },
        {
          $set: {
            status: TmaSaleStatus.AWAITING_FIAT,
            blockReason: null,
            observedGoal: null,
            // Recorded on the order, not only in its timeline: the goal check
            // reads it on every scrape to know that a person has already
            // answered the question it is about to ask again.
            resumedByAdminAt: new Date()
          }
        },
        { returnDocument: 'after' }
      )
      .lean()
  }

  /**
   * Ends a blocked order.
   *
   * Deliberately separate from {@link cancelIfOpen}, which guards on the open
   * statuses: widening that one to accept `BLOCKED` would let the *user's* own
   * cancel button release a stake that was frozen for breaking a rule, which is
   * the thing blocking exists to prevent.
   */
  async cancelIfBlocked(id: string): Promise<(TmaSale & { _id: Types.ObjectId }) | null> {
    return this.saleModel
      .findOneAndUpdate(
        { _id: id, status: TmaSaleStatus.BLOCKED },
        { $set: { status: TmaSaleStatus.CANCELLED, completedAt: new Date() } },
        { returnDocument: 'after' }
      )
      .lean()
  }

  // --- Migration 0003: the market rate becomes the sell rate ----------------

  /**
   * Orders still priced at the market, with the markup beside them.
   *
   * `exchangeRate` used to hold the market rate and `profitPercent` the markup
   * to apply to it. It now holds the finished sell rate and the other two
   * fields do not exist, so these two are the shape of a document written
   * before that — and `profitPercent` existing is what identifies one.
   *
   * The legacy field names appear here and in migration `0003` and nowhere
   * else: this is the layer that knows what is on disk, which is the whole
   * reason a migration reads through it rather than reaching for Mongoose.
   */
  async findPricedAtMarketRate(
    page: PageQuery
  ): Promise<Page<TmaSale & { _id: Types.ObjectId; profitPercent: number }>> {
    const filter = { profitPercent: { $exists: true } } as QueryFilter<TmaSale>

    const [items, total] = await Promise.all([
      this.saleModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.saleModel.countDocuments(filter)
    ])

    return {
      // Through `unknown`: the schema no longer declares `profitPercent`, which
      // is exactly why these documents need finding — the stored shape and the
      // declared one disagree, and this is the one place that is allowed to say so.
      items: items as unknown as (TmaSale & {
        _id: Types.ObjectId
        profitPercent: number
      })[],
      total
    }
  }

  /**
   * Writes the finished sell rate and drops the two fields it replaces.
   *
   * One update, so an order can never be left with a repriced rate *and* the
   * markup that was already folded into it — which a later pass would then fold
   * in again.
   *
   * **`strict: false` is load-bearing and this is why.** Mongoose's default
   * `strict: true` silently removes update keys for paths the schema does not
   * declare — and the whole point of this method is to unset two paths the
   * schema no longer declares. Without the option, `$unset` was dropped and
   * `$set` was not: every pass re-marked-up `exchangeRate` and left
   * `profitPercent` in place, so the document never left the migration's result
   * set. It ran about eleven thousand times against production and drove every
   * rate to 1e97 before it was killed. Nothing warned; `modifiedCount` was 1
   * each time, because the `$set` really had modified something.
   */
  async repriceToSellRate(id: Types.ObjectId, sellRateKopecks: number): Promise<boolean> {
    const result = await this.saleModel.updateOne(
      { _id: id, profitPercent: { $exists: true } } as QueryFilter<TmaSale>,
      {
        $set: { exchangeRate: sellRateKopecks },
        $unset: { profitPercent: '', expectedProfit: '' }
      },
      { strict: false }
    )

    return (result.modifiedCount ?? 0) > 0
  }

  // --- Admin reads ----------------------------------------------------------

  async findPage(
    filter: QueryFilter<TmaSale>,
    page: PageQuery
  ): Promise<Page<TmaSale & { _id: Types.ObjectId }>> {
    const [items, total] = await Promise.all([
      this.saleModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.saleModel.countDocuments(filter)
    ])

    return { items, total }
  }

  async count(filter: QueryFilter<TmaSale> = {}): Promise<number> {
    return this.saleModel.countDocuments(filter)
  }

  /**
   * How many orders sit in each status, in one pass.
   *
   * Returned as a plain map keyed by status rather than an array of pairs: the
   * overview looks up one status at a time and would otherwise `find` its way
   * through the array on every render.
   */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.saleModel
      .aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
      .exec()

    return Object.fromEntries(rows.map((row) => [row._id, row.count]))
  }

  /**
   * How many slot-holding orders each of these users has right now.
   *
   * One aggregation for a page of users rather than a count per row — twenty
   * rows would otherwise be twenty round trips, which is the N+1 the list would
   * have shipped with.
   */
  async countOpenByTelegramIds(telegramIds: readonly number[]): Promise<Record<number, number>> {
    if (!telegramIds.length) return {}

    const rows = await this.saleModel
      .aggregate<{ _id: number; count: number }>([
        {
          $match: {
            telegramId: { $in: [...telegramIds] },
            status: { $in: SLOT_HOLDING_STATUSES }
          }
        },
        { $group: { _id: '$telegramId', count: { $sum: 1 } } }
      ])
      .exec()

    return Object.fromEntries(rows.map((row) => [row._id, row.count]))
  }
}
