import {
  ERROR,
  cardTail,
  defaultRemainderPolicy,
  isGoalWithinTolerance,
  isQuoteStillValid,
  isRemainderPolicyAvailable,
  MIN_USDT_AMOUNT,
  minSaleTargetKopecks,
  priceSale,
  SaleEventType,
  SaleMethod,
  SaleReceiverNameSource,
  roundToWholeUah,
  sellRate,
  SaleBlockReason
} from '@transacto/contracts'
import type { CreateSaleReq } from '@transacto/contracts'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common'
import Redis from 'ioredis'
import { REDIS_CLIENT } from 'src/shared/redis'
import { RedisKeys } from 'src/shared/redis/redis.keys'
import { SaleBlockService } from 'src/modules/telegram-mini-app/services/sale-block.service'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TerminalHistoryAlertType } from '@transacto/contracts'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { ReferralService } from 'src/modules/telegram-mini-app/services/referral.service'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { SaleTerminalService } from 'src/modules/telegram-mini-app/services/sale-terminal.service'
import { TmaServiceTraderService } from 'src/modules/telegram-mini-app/services/tma-service-trader.service'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TerminalBroadcastService } from 'src/modules/terminal'
import { getTrustLevel, BANK_PAYMENT_METHOD_ID, BankProvider } from 'src/shared/constants'
import { describeError, settleSale } from 'src/shared/utils'
import { TerminalSource, TMA_TERMINAL_NAME_PREFIX } from '@transacto/contracts'
import { TmaSaleStatus } from 'src/modules/repositories/tma-sale-db/schemas'
import environments from 'src/environments'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'
import type { SaleDestinationStrategy } from 'src/modules/telegram-mini-app/interfaces/sale-destination-strategy.interface'
import { SALE_DESTINATION_STRATEGIES } from 'src/shared/constants'

/**
 * How long a user's create lock survives without being released.
 *
 * Only a backstop for a process that dies inside the section — the ordinary
 * path releases in a `finally`. Generous against two Mongo round trips, and
 * short enough that a crash costs a user seconds rather than minutes.
 */
const CREATE_LOCK_TTL_MS = 10_000

/**
 * How far the two ledgers may drift before a completion is refused.
 *
 * One hryvnia, which is slack for rounding and nothing else. The discrepancy
 * this guards against was six hundred.
 */
const LEDGER_TOLERANCE_KOPECKS = 100

@Injectable()
export class SaleFacadeService {
  private readonly logger = new Logger(SaleFacadeService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly userDbService: TmaUserDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly terminalDbService: TerminalDbService,
    private readonly terminalBroadcast: TerminalBroadcastService,
    private readonly serviceTrader: TmaServiceTraderService,
    private readonly progressService: SaleProgressService,
    private readonly referralService: ReferralService,
    private readonly terminalService: SaleTerminalService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly tmaGateway: TmaGateway,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly balanceLedger: BalanceLedgerService,
    private readonly blockService: SaleBlockService,
    @Inject(SALE_DESTINATION_STRATEGIES)
    private readonly destinationStrategies: readonly SaleDestinationStrategy[]
  ) {}

  /**
   * The strategy that owns one variant.
   *
   * A lookup rather than a `switch`, so a third variant is a provider in the
   * module's array and nothing here changes. An unknown method is an
   * unsupported one, not a silent fall back to jar: falling back would create a
   * jar terminal for somebody who asked for a card, with a `cred3` that does
   * not exist and a stake already frozen against it.
   */
  private destinationFor(method: SaleMethod): SaleDestinationStrategy {
    const strategy = this.destinationStrategies.find(
      (candidate) => candidate.method === method
    )

    if (!strategy) {
      this.logger.error(`No sale destination strategy is registered for ${method}`)
      throw new BadRequestException(ERROR.SALE.UNSUPPORTED_BANK_TYPE)
    }

    return strategy
  }

  /**
   * Creates a new sale:
   * 1. Validate user's trust level allows this fiatAmount
   * 2. Calculate required USDT to freeze (taking profit into account)
   * 3. Freeze required USDT on user's balance
   * 4. Create TmaSale record — which allocates its public id
   * 5. Call Transacto API: POST /credentials_create with cred1 and cred3
   */
  async createSale(
    telegramId: number,
    request: CreateSaleReq
  ) {
    const { fiatAmount, bankType, cardNumber, quotedRate } = request

    // Absent means a jar sale, which is what every client that predates the
    // choice is asking for and the only thing it could have meant.
    const saleMethod = request.saleMethod ?? SaleMethod.JAR
    const destinations = this.destinationFor(saleMethod)

    // After the method, because the answer depends on it — and refused rather
    // than substituted. `isRemainderPolicyAvailable` is the same rule the create
    // form greys the option out with, read from the contract so the picker and
    // this cannot come to disagree about what is on offer.
    const remainderPolicy = request.remainderPolicy ?? defaultRemainderPolicy(saleMethod)

    if (!isRemainderPolicyAvailable(saleMethod, remainderPolicy)) {
      this.logger.warn(
        `Refused a ${saleMethod} sale for telegramId ${telegramId}: ${remainderPolicy} is not ` +
          `an ending this method can give a tail`
      )
      throw new BadRequestException(ERROR.SALE.REMAINDER_POLICY_UNAVAILABLE)
    }

    // 1. Load the user and their level.
    //
    // Before the destination rather than after it, because resolving one needs
    // the seller: a jar sale falls back to their Telegram profile for the name
    // a payer will see. One read either way.
    const user = await this.userDbService.findByTelegramId(telegramId)
    if (!user) throw new NotFoundException(ERROR.SALE.USER_NOT_FOUND)

    // 1a. Settle where the money is going, and refuse what this variant cannot
    // do — all of it before a single cent is frozen.
    //
    // Everything that differs between a jar sale and a card sale lives behind
    // this call: which banks are open, whether there is a link to resolve, who
    // names the card and who names the recipient. The rest of this method is
    // the same money either way.
    const destination = await destinations.resolve({
      seller: {
        telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username
      },
      bankType,
      dropLink: request.dropLink ?? '',
      cardNumber,
      receiverName: request.receiverName
    })

    const {
      receiverName,
      payoutCardNumber,
      dropLink: resolvedDropLink,
      cardVerifiedByBank,
      observedGoal
    } = destination

    const sellRateKopecks = await this.getSellRate()

    // The level is read here but checked later: what it limits is how many
    // orders run at once, and that count has to be taken under the lock that
    // guards the insert, not several network calls earlier.
    const trustLevel = getTrustLevel(user.totalTurnover)

    // 2. Price the order.
    //
    // One call, and the same one the create form makes: `priceSale` is
    // the single statement of this arithmetic. It used to be written out here
    // and again in the Mini App, with a comment on the second saying it
    // mirrored this one step for step — which is precisely how the quote shown
    // and the stake taken came to disagree by a cent.
    //
    // Snapping the target to a whole hryvnia happens inside it. That matters
    // here rather than being cosmetic: no bank accepts kopecks in a goal field,
    // so a target of ₴9 490,08 could never be matched and the compliance check
    // would block a correctly set-up order. Doing it server-side also means an
    // out-of-date Mini App cannot store one.
    // Resolved here rather than beside the Transacto call, because the order
    // records it too — and a figure written to our own database after the
    // upstream call would be missing on every order whose creation failed
    // halfway.
    //
    // `name` is the **receiver**, not a second place to keep our identifiers.
    // It comes back on every order as `receiver_name` and is what a payer sees
    // as the person they are paying; it used to read `TMA-885140`, which gave
    // them a reason to abandon the transfer rather than trust it. The
    // correlation that identifier provided is not lost — `terminal_name`
    // carries the order's public id, which resolves to the user.
    const { targetKopecks: target, requiredUsdtCents } = priceSale(
      fiatAmount,
      sellRateKopecks
    )

    if (target !== fiatAmount)
      this.logger.debug(`Snapped sale target ${fiatAmount} to a whole hryvnia: ${target}`)

    // 2. Refuse a quote the market has moved out from under.
    //
    // Checked on the *target*, not on the rate. The rate always changes — it is
    // re-read every five minutes — and refusing on that alone would reject
    // most submissions for nothing. What matters is whether it moved far enough
    // to shift the figure the user was told to type into their bank, because a
    // jar whose goal no longer matches the order can never fill: it would sit
    // unfillable until the compliance check blocked it, with the stake frozen.
    //
    // The tolerance is the same one hryvnia every other goal check allows, so a
    // user is never troubled by a drift too small to matter.
    if (!isQuoteStillValid(target, quotedRate, sellRateKopecks)) {
      this.logger.log(
        `Refused a sale for telegramId ${telegramId}: quoted at ${quotedRate} ` +
          `kopecks/USDT, the sell rate is now ${sellRateKopecks} — the target has moved`
      )
      throw new BadRequestException({
        ...ERROR.SALE.RATE_CHANGED,
        details: `Quoted at ${quotedRate / 100} UAH/USDT, now ${sellRateKopecks / 100} UAH/USDT`
      })
    }

    // 2a. Refuse a jar whose target does not match, before anything is frozen.
    //
    // The same rule is enforced later by `SaleComplianceService`, but by
    // then the order exists, the stake is frozen and money may already be
    // arriving — blocking at that point strands both. Checking here turns the
    // same mistake into a message the user can act on while their bank app is
    // still open. Only possible where resolving revealed the goal; `null` means
    // "not known", so it is not treated as a mismatch.
    if (observedGoal !== null && !isGoalWithinTolerance(observedGoal, target)) {
      throw new BadRequestException({
        ...ERROR.SALE.GOAL_MISMATCH,
        details: `Jar target is ${observedGoal / 100} UAH, the order needs ${target / 100} UAH`
      })
    }

    // 2b. Enforce the floor on how much is actually being sold.
    //
    // **It used to compare `requiredUsdtCents` against a flat `MIN_USDT_CENTS`,
    // and that refused the minimum itself.** A user types whole USDT, the
    // target is floored to a whole hryvnia so their stake never lands above
    // what they typed, and the stake is then recovered from that floored
    // target — so ten USDT arrived here as 9.99 and was turned away for being
    // under ten, on every rate that is not a multiple of ten kopecks.
    //
    // `minSaleTargetKopecks` is the same floor in the units the drift happens
    // in, and the same call the create form makes. It is **not** the old "check
    // the stake, never the total" mistake: the threshold is derived from the
    // rate, so both sides carry the same markup — see the helper.
    if (target < minSaleTargetKopecks(sellRateKopecks)) {
      throw new BadRequestException({
        ...ERROR.SALE.BELOW_MINIMUM,
        details: `Minimum is ${MIN_USDT_AMOUNT} USDT, this order stakes ${requiredUsdtCents / 100}`
      })
    }

    // 3. Validate and freeze balance
    if (user.balance < requiredUsdtCents) {
      throw new BadRequestException({
        ...ERROR.SALE.INSUFFICIENT_BALANCE,
        details: `Required: ${requiredUsdtCents / 100} USDT, available: ${user.balance / 100} USDT`
      })
    }
    // 3a. Take this user's create lock, and hold it across the slot check, the
    // freeze and the insert.
    //
    // Those three are one decision — "there is room, so take it" — and split
    // apart they are a read-then-write that two requests in the same instant
    // both pass. At NEWBIE, where the allowance is a single order, that is the
    // difference between a limit and a suggestion.
    //
    // The section is short on purpose: two Mongo round trips, no upstream
    // calls. Everything Transacto does happens after the lock is released, so
    // one user's slow terminal provisioning never blocks their next order.
    const lockKey = RedisKeys.Sale.createLock(telegramId)
    const locked = await this.redis.set(lockKey, '1', 'PX', CREATE_LOCK_TTL_MS, 'NX')

    if (locked !== 'OK') {
      // Nearly always a double-tap, and refusing the second tap is the right
      // answer to one. A caller that genuinely has a slot free can simply try
      // again — the lock lives for seconds at most.
      this.logger.warn(`Refused a concurrent sale create for telegramId ${telegramId}`)
      throw new ConflictException(ERROR.SALE.CREATE_IN_PROGRESS)
    }

    const { sale, balances } = await (async () => {
      try {
        const slotsHeld = await this.saleDbService.countSlotsHeldByTelegramId(telegramId)

        if (slotsHeld >= trustLevel.maxParallelOrders) {
          throw new BadRequestException({
            ...ERROR.SALE.PARALLEL_LIMIT_REACHED,
            details:
              `Your level: ${trustLevel.level}, running: ${slotsHeld}, ` +
              `allowed: ${trustLevel.maxParallelOrders}`
          })
        }

        const frozen = await this.balanceLedger.freeze(telegramId, requiredUsdtCents)

        // 4. Create sale.
        //
        // Compensated on failure, because the stake is already frozen by the
        // time this runs. It has failed for real: a `bankType` the schema did
        // not know left a user with 142 USDT frozen against an order that does
        // not exist, and nothing in the product could give it back — the admin
        // panel deliberately cannot touch the frozen pot.
        try {
          const created = await this.saleDbService.create({
            telegramId,
            saleMethod,
            fiatAmount: target,
            exchangeRate: sellRateKopecks,
            frozenUsdt: requiredUsdtCents,
            bankType,
            // Empty on a card sale, which has no jar to route anybody to.
            dropLink: resolvedDropLink ?? '',
            remainderPolicy,
            receiverName,
            // Unchecked, on either variant: a jar's owner name and a seller's
            // typed one are both assembled from what was available rather than
            // read off the account the money lands on. Only a statement moves
            // this, and only a card sale can produce one.
            receiverNameSource: SaleReceiverNameSource.DECLARED,
            // Four digits, never sixteen: enough to recognise the payout
            // account on a statement and to name it on screen, and not a
            // payment credential at rest. Only a card sale has one to keep —
            // a jar sale's destination is its link.
            payoutCardTail:
              saleMethod === SaleMethod.CARD ? cardTail(payoutCardNumber) : null,
            cardVerifiedByBank
          })

          return { sale: created, balances: frozen }
        } catch (error: unknown) {
          await this.unfreezeOrphanedStake(telegramId, requiredUsdtCents)

          throw error
        }
      } finally {
        // Released whichever way this went. The TTL is only a backstop for a
        // process that dies mid-section; leaning on it for the ordinary path
        // would lock a user out for its whole duration after every refusal.
        await this.redis.del(lockKey)
      }
    })()

    const orderId = sale._id.toString()

    try {
      // 5. Resolve the trader that will own the terminal upstream.
      //
      // Terminals used to be written under a literal `traderId: 0`, which no
      // scraper, sync or poller ever matches — so the terminal existed but was
      // never watched. Resolving the real trader is what lets money arriving in
      // this jar be seen at all.
      const { traderId, apiToken } = await this.serviceTrader.resolve()

      const paymentMethodId = BANK_PAYMENT_METHOD_ID[bankType]
      if (!paymentMethodId) {
        throw new BadRequestException({
          ...ERROR.SALE.UNSUPPORTED_BANK_TYPE,
          details: bankType
        })
      }

      const fiatAmountUah = target / 100

      // The prefix is how the terminal sync classifies this terminal as TMA-made
      // once Transacto hands it back — see TMA_TERMINAL_NAME_PREFIX. The suffix
      // is the order's own public id, so the code the user quotes is the string
      // that identifies the terminal in the Transacto panel.
      const terminalName = `${TMA_TERMINAL_NAME_PREFIX}${sale.publicId}`

      // The knobs that differ per variant, in this codebase's own vocabulary;
      // the mapping onto Transacto's field names happens here and nowhere else.
      //
      // For a card sale these three numbers are not tuning. They are what
      // stands in for `SaleBlockReason.LEDGER_MISMATCH`, which cannot exist
      // where the seller's word is the only record of the money — see
      // `CardSaleDestinationService.credentialLimits`.
      const limits = destinations.credentialLimits(target)

      const credentialResult = await this.transactoApiService.createCredential(apiToken, {
        terminal_name: terminalName,
        name: receiverName,
        payment_method_id: paymentMethodId,
        cred: payoutCardNumber,
        // Omitted rather than sent empty on a card sale: `cred3` is "the jar",
        // and an empty one is a jar that does not exist rather than no jar.
        ...(resolvedDropLink !== null ? { cred3: resolvedDropLink } : {}),
        limit_by_day: fiatAmountUah,
        max_turnover: fiatAmountUah,
        max_turnover_daily: fiatAmountUah,
        max_open_orders: limits.maxOpenOrders,
        ...(limits.minAmountUah !== undefined ? { min_amount: limits.minAmountUah } : {}),
        ...(limits.maxAmountUah !== undefined ? { max_amount: limits.maxAmountUah } : {}),
        ...(limits.maxTxCountTotal !== undefined
          ? { max_tx_count_total: limits.maxTxCountTotal }
          : {}),
        enabled: 1,
        enable_orders: 1
      })

      // 6. Save terminal locally.
      //
      // Filtered on `{ traderId, cardId }` to match the collection's unique
      // index. Upserting on `cardId` alone created a second, trader-less copy of
      // a terminal the minute sync also wrote it.
      await this.terminalDbService.upsert(
        { traderId, cardId: credentialResult.card_id },
        {
          $set: {
            traderId,
            cardId: credentialResult.card_id,
            terminalId: credentialResult.terminal_id,
            terminalName,
            // `null` on a card sale, and read that way downstream: the order
            // poller treats a terminal with no jar link as one the scraper has
            // no business queueing.
            cred3: resolvedDropLink,
            enabled: true,
            source: TerminalSource.TMA,
            // The jar's target, known here and nowhere else until the first
            // scrape. Written now so the card the trader is about to be shown
            // carries a goal from the moment it appears rather than a blank
            // that fills in a minute later. The scraper overwrites it with what
            // the bank actually reports on its first pass.
            lastGoal: target
          }
        }
      )

      // 6a. Tell the trader's extension, now rather than on the next sync pass.
      //
      // The terminals sync would announce this eventually — it runs on a cron —
      // but "eventually" is up to a minute of a jar existing, taking money, and
      // not being on screen. Re-read rather than assembled from what was just
      // written, so the card is built from the same document every other path
      // builds it from.
      const stored = await this.terminalDbService.findOne({
        traderId,
        cardId: credentialResult.card_id
      })
      if (stored) await this.terminalBroadcast.announceEnabled(stored)

      // 7. Link terminal to sale
      await this.saleDbService.linkTerminal(
        orderId,
        credentialResult.terminal_id,
        credentialResult.card_id,
        traderId
      )

      // 8. Record the first timeline entry and announce it.
      //
      // `appendEvent` returns the order as it now stands, so it doubles as the
      // authoritative re-read the caller needs — the document captured before
      // step 5 predates the terminal link.
      const linked = await this.saleDbService.appendEvent(orderId, {
        type: SaleEventType.TERMINAL_CREATED,
        at: Date.now()
      })
      if (!linked) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

      this.tmaGateway.emitSaleStatusChange(
        telegramId,
        orderId,
        TmaSaleStatus.TERMINAL_READY
      )
      this.tmaGateway.emitBalanceUpdated(telegramId, balances.balance)
      await this.progressService.emit(linked)

      return linked
    } catch (error) {
      // If Transacto API fails, mark order as FAILED and unfreeze balance
      this.logger.error(`Failed to create terminal for sale ${orderId}: ${error}`)

      await this.saleDbService.updateStatus(orderId, TmaSaleStatus.FAILED)
      await this.balanceLedger.refund(telegramId, requiredUsdtCents, orderId)

      const failed = await this.saleDbService.appendEvent(orderId, {
        type: SaleEventType.FAILED,
        at: Date.now()
      })

      this.tmaGateway.emitSaleStatusChange(telegramId, orderId, TmaSaleStatus.FAILED)

      // Re-fetch user to get updated balance for WS
      const updatedUser = await this.userDbService.findByTelegramId(telegramId)
      if (updatedUser) {
        this.tmaGateway.emitBalanceUpdated(telegramId, updatedUser.balance)
      }

      if (failed) await this.progressService.emit(failed)

      throw error
    }
  }

  /**
   * Called when the terminal has received the full fiat target:
   * 1. Close the order — atomically, so a double match cannot pay out twice
   * 2. Commit the frozen USDT
   * 3. Increment user's totalTurnover
   * 4. Pay the seller's referrer their cut, if they have one
   * 5. Retire the terminal, upstream and locally
   * 6. Emit WebSocket events
   *
   * Returns `false` when the order was already closed, which is the normal
   * outcome of a redundant call rather than an error.
   */
  async completeSale(saleId: string): Promise<boolean> {
    const order = await this.saleDbService.findById(saleId)
    if (!order) throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    // 0. Refuse to close on a ledger that does not add up.
    //
    // Before anything is committed, because everything after this point spends
    // the user's stake on the strength of `receivedAmount` being true.
    const overcredited = await this.overcreditedKopecks(order)

    if (overcredited !== null) {
      this.logger.error(
        `Sale ${saleId} (${order.publicId}) was credited ` +
          `${order.receivedAmount / 100} UAH and its jar accounts for ` +
          `${overcredited / 100} UAH less than that. Not closing it: committing the stake here ` +
          'would buy hryvnia nobody sent.'
      )
      await this.blockService.block(order, SaleBlockReason.LEDGER_MISMATCH, overcredited)

      return false
    }

    // 1. Work out the ledger before anything moves.
    //
    // For all but one case this is the identity: the whole stake is committed
    // and the whole target counts as sold. It differs only for an order
    // created with REFUND_TO_BALANCE that is closing on a tail no payment could
    // cover — see `settleSale`, which is the only statement of the rule.
    const settlement = settleSale(order)

    // 2. Close it, recording the refund in the same write. The status guard
    // inside `completeIfOpen` is the idempotency key: two concurrent payment
    // matches both arrive here, and only the one that actually flipped the
    // status gets a document back — so the balance moves below can never run
    // twice for the same order.
    const completed = await this.saleDbService.completeIfOpen(saleId, {
      usdt: settlement.refundedUsdtCents,
      fiat: settlement.remainderKopecks
    })
    if (!completed) {
      this.logger.debug(`Sale ${saleId} was already closed; nothing to commit`)
      return false
    }

    // 3. Move the stake. The committed half leaves the frozen pot for good — it
    // bought the hryvnia that reached the jar. The rest, where there is any,
    // goes back to the spendable balance: it paid for a stretch of the target
    // that nobody could ever have delivered.
    if (settlement.committedUsdtCents > 0)
      await this.userDbService.commitFrozenBalance(order.telegramId, settlement.committedUsdtCents)
    if (settlement.refundedUsdtCents > 0)
      await this.balanceLedger.refund(order.telegramId, settlement.refundedUsdtCents, saleId)

    // 4. Increment turnover — on what was actually sold, in UAH kopecks.
    //
    // Identical to the target on a full fill. On a refunded tail it is smaller,
    // deliberately: turnover drives the trust ladder, and crediting a user for
    // hryvnia that nobody ever paid would raise their limits on money that does
    // not exist.
    await this.userDbService.incrementTurnover(order.telegramId, settlement.settledFiat)

    // 5. Pay the referrer, on the same settled figure and for the same reason.
    // Placed after the commit, and never throwing, because the user's own order
    // is already settled by this point: a failure in the referral programme must
    // not surface as a failed sale.
    await this.referralService.creditForSale(order, settlement.settledFiat)

    // 6. Put the ending on the terminal's own history, before it is retired.
    //
    // The trader's history feed is the record of what happened to a terminal,
    // and a Mini App terminal's story simply stopped: the last order matched
    // and then nothing more was ever written, which reads the same as a scraper
    // that died. This is the closing entry.
    //
    // Both remainder policies land here, at the moment each of them actually
    // finishes — a refunding order the instant its tail is written off, a
    // waiting one when the last hryvnia arrives — because both routes into
    // completion come through this method.
    //
    // Emitted rather than written directly: `TerminalHistoryService` owns that
    // collection and already listens for this channel, and the Mini App must
    // not reach into the trader-side history itself.
    // Awaited, unlike every other emit on this channel. The teardown below
    // clears the terminal's Redis keys, and the history writer reads the jar's
    // balance from exactly those — a fire-and-forget emit would race the
    // deletion and file the closing entry against a balance of zero.
    // `TerminalHistoryService` swallows its own failures, so awaiting cannot
    // turn a history problem into a failed completion.
    await this.eventEmitter.emitAsync('terminal.state_changed', {
      cardId: order.cardId,
      context: {
        alerts: [
          {
            type: TerminalHistoryAlertType.SALE_COMPLETED,
            details: {
              publicId: order.publicId,
              // What the terminal actually took in, which is the target unless
              // a tail was refunded.
              amount: settlement.settledFiat,
              target: order.fiatAmount,
              refundedUsdt: settlement.refundedUsdtCents
            }
          }
        ]
      }
    })

    // 7. Retire the terminal.
    //
    // The order it was created for is over, so anything Transacto routes there
    // from now on is money arriving at a jar with nothing left to pay for it —
    // it would sit in the user's own bank while the payer waits for a sale
    // that already closed. Placed after the ledger for the same reason the
    // cancel path does it: the user is paid by this point, and a Transacto
    // failure here is an operations problem rather than theirs.
    // Routing off, but the terminal stays watched — the jar outlives the order.
    //
    // A jar left open keeps accepting money after its order is finished, and a
    // payer who started late can land hryvnia in it minutes later. Nothing
    // matches that payment, an appeal follows, and it is ours to eat. So the
    // terminal is only torn down once the bank reports the jar closed, which is
    // also what releases the user's next sale slot.
    //
    // The turnover cap a completion used to pass is gone with it: it existed to
    // stop a payer being routed into a jar already paid out, and
    // `enable_orders: 0` says that outright rather than by arithmetic.
    await this.terminalService.stopRouting(order, 'Completed')

    // 8. Record and announce.
    //
    // The refund goes on the timeline before the completion, because that is
    // the order the two happened in: the tail came back, and *that* is what
    // allowed the order to close.
    if (settlement.refundedUsdtCents > 0) {
      await this.saleDbService.appendEvent(saleId, {
        type: SaleEventType.REMAINDER_REFUNDED,
        // USDT cents, like STOPPED_BY_USER — what the user gets back is USDT.
        amount: settlement.refundedUsdtCents,
        at: Date.now()
      })
    }

    const withEvent = await this.saleDbService.appendEvent(saleId, {
      type: SaleEventType.COMPLETED,
      amount: settlement.settledFiat,
      at: Date.now()
    })

    this.tmaGateway.emitSaleStatusChange(
      order.telegramId,
      saleId,
      TmaSaleStatus.COMPLETED
    )

    // Available balance itself did not change — only the frozen side did — but
    // the client shows both, so it needs the current pair either way.
    const user = await this.userDbService.findByTelegramId(order.telegramId)
    if (user) {
      this.tmaGateway.emitBalanceUpdated(order.telegramId, user.balance)
    }

    if (withEvent) await this.progressService.emit(withEvent)

    this.logger.log(
      `Sale ${saleId} (${order.publicId}) completed. Committed ${
        settlement.committedUsdtCents / 100
      } USDT for ${settlement.settledFiat / 100} UAH` +
        (settlement.refundedUsdtCents > 0
          ? `, refunded ${settlement.refundedUsdtCents / 100} USDT for the ${
              settlement.remainderKopecks / 100
            } UAH tail no order could cover.`
          : '.')
    )

    return true
  }

  /**
   * Hands back a stake frozen for an order that was never written.
   *
   * Swallows its own failure and says so loudly: the caller is already
   * reporting one error, and replacing it with a second would hide what
   * actually went wrong. A stake left frozen by *this* path is recoverable —
   * `0002-release-orphaned-stakes` finds it by comparing the frozen pot against
   * the orders that account for it — where the original error might not be.
   */
  private async unfreezeOrphanedStake(telegramId: number, amountCents: number): Promise<void> {
    try {
      await this.balanceLedger.refund(telegramId, amountCents)
      this.logger.warn(
        `Returned ${amountCents} cents to telegramId ${telegramId}: the order it was ` +
          'frozen for could not be created'
      )
    } catch (error: unknown) {
      this.logger.error(
        `[telegramId ${telegramId}] ${amountCents} cents are frozen against an order that ` +
          `was never created, and giving them back failed too: ${describeError(error)}`
      )
    }
  }

  /**
   * UAH kopecks per USDT for a sale — the only rate this module quotes.
   *
   * The market is fetched once by `ExchangeRateService` and turned into the
   * sell rate here, so nothing downstream of this method ever sees a market
   * figure: not the create form, not the order, not a settlement. A caller that
   * could see one could price with it, which is how the same sale came to be
   * worth two different things depending on which reader was asking.
   *
   * The rate is snapshotted onto the order at creation and every later step —
   * completion, cancellation, referral reward — reads `order.exchangeRate`, so
   * a sale's price is frozen by its own document however long it runs.
   */
  async getSellRate(): Promise<number> {
    return sellRate(await this.exchangeRateService.getRate())
  }

  /**
   * How much more this order was credited than its jar can account for, or
   * `null` when the two agree.
   *
   * **Two records of the same money, and they may not disagree.**
   * `receivedAmount` sums the orders that were credited; the terminal's
   * baseline tracks what the jar was observed to hold and only ever advances
   * when money is accounted for. Equal by construction — unless something was
   * counted twice.
   *
   * Something was, on 2026-09-08. Two orders confirmed in Transacto's panel
   * left their hryvnia outside the baseline; the jar page then caught up in one
   * jump and fuzzy matching spent that same money again on two other orders.
   * The order closed on 2480 UAH while its jar held 1874, and **both figures
   * were in this document at the moment it closed**. Nothing compared them.
   *
   * The baseline is read rather than `jarBalance`, which is the other candidate
   * and the wrong one: it follows scrape payloads and lagged the truth by a
   * whole payment that night. The baseline is written by the matcher in the
   * same breath as the credit, so if the two ever disagree it is the credit
   * that is wrong.
   *
   * Read straight from Redis rather than through the scraper's own cache
   * service: that service lives in `bank-scraper`, and importing its module
   * here to read one key would couple the Mini App to the scraper for a
   * backstop.
   *
   * **Fails open**, and deliberately. A baseline that cannot be read is not
   * evidence of anything, and refusing every completion on a Redis restart
   * would strand users' stakes over a check that exists to catch one specific
   * double-count. It is loud about it instead.
   */
  private async overcreditedKopecks(
    // Taken from the repository rather than restated. Two neighbouring services
    // keep their own `StoredSale` alias of this same shape; a third copy
    // is one more thing to drift.
    order: NonNullable<Awaited<ReturnType<TmaSaleDbService['findById']>>>
  ): Promise<number | null> {
    const terminalId = order.transactoTerminalId

    if (!terminalId) return null

    const baseline = await this.redis.get(RedisKeys.Terminal.baseline(terminalId)).catch(() => null)

    if (baseline === null) {
      this.logger.warn(
        `Sale ${order._id.toString()} (${order.publicId}) is closing with no baseline ` +
          `for terminal ${terminalId}; its ${order.receivedAmount / 100} UAH could not be ` +
          'checked against the jar.'
      )

      return null
    }

    const accounted = Number(baseline) - (order.openingJarBalance ?? 0)
    const gap = order.receivedAmount - accounted

    return gap > LEDGER_TOLERANCE_KOPECKS ? gap : null
  }
}
