import { ERROR } from '@transacto/contracts'
import { Injectable, Logger, HttpException, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { isAxiosError } from 'axios'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { BankScraperService } from './bank-scraper.service'
import { TerminalStateCacheService } from './terminal-state-cache.service'
import { BalanceProcessorService } from './balance-processor.service'
import { TerminalErrorHandlerService } from './terminal-error-handler.service'
import { TraderWsEvent, WsEventNames, type UnifiedBankBalance } from 'src/shared/interfaces'
import { extractSendId, ensure, errorCodeOf, getBankProvider, describeError } from 'src/shared/utils'
import type { ScraperJobData } from 'src/shared/constants'
import { BANK_DROP_CONFIRM_MS } from 'src/modules/bank-scraper/constants'
import { TerminalBalanceOrchestratorService } from './terminal-balance-orchestrator.service'
import { isDeadJarError } from 'src/shared/utils/dead-jar.util'
import { TerminalActivationService, TerminalDeactivationService } from 'src/modules/terminal'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

@Injectable()
export class ScraperExecutionService {
  private readonly logger = new Logger(ScraperExecutionService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly bankScraperService: BankScraperService,
    private readonly terminalStateCache: TerminalStateCacheService,
    private readonly balanceProcessor: BalanceProcessorService,
    private readonly errorHandler: TerminalErrorHandlerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly terminalBalanceOrchestratorService: TerminalBalanceOrchestratorService,
    // Routing only — the teardown paths belong to `TerminalErrorHandlerService`.
    // These two are the narrow pair: hold a terminal back from new payers while
    // a drop is unresolved, and put it back when it clears.
    private readonly deactivation: TerminalDeactivationService,
    private readonly activation: TerminalActivationService,
    // Asked one question, on the rare path below: is this jar's sale already
    // over? Only this collection knows, and the answer decides whether a
    // terminal may be put back in front of payers.
    private readonly saleDbService: TmaSaleDbService
  ) {}

  async executeScrape(
    data: ScraperJobData,
    scheduleNext: (terminalId: number, data: ScraperJobData, customDelay?: number) => void,
    stopPolling: (terminalId: number) => void
  ): Promise<void> {
    const { terminalId, targetId, apiToken, traderId, cardId } = data

    // Renew the loop lease so OrderPollingService doesn't start a duplicate loop
    if (!data.isManualSync) await this.terminalStateCache.renewHeartbeat(terminalId, 35)

    const acquired = await this.terminalStateCache.acquireLock(terminalId, 10000)
    if (!acquired) {
      this.logger.error(`Failed to acquire lock for terminal ${terminalId}. Retrying later.`)
      if (!data.isManualSync) scheduleNext(terminalId, data)
      return
    }

    try {
      const terminal = ensure(
        await this.terminalDbService.findOne({ traderId, cardId }),
        new NotFoundException(ERROR.TERMINAL.NOT_FOUND)
      )
      if (!terminal.enabled && !data.isManualSync) {
        this.logger.log(`Terminal ${terminalId} is disabled. Stopping scraper loop.`)
        stopPolling(terminalId)
        return
      }

      const scraped = await this.bankScraperService.scrape(terminalId)

      const balanceData = await this.confirmDrop(terminalId, data, terminal, scraped)
      if (balanceData === null) {
        if (!data.isManualSync) scheduleNext(terminalId, data)
        return
      }

      const currentBalance = balanceData.actualBalance
      const goal = balanceData.goal

      const previousState = await this.terminalStateCache.getCurrentState(terminalId)
      const cachedBalance = previousState?.current ?? currentBalance
      const incrementalDelta = currentBalance - cachedBalance

      const terminalName = terminal.terminalName
      const sendId = extractSendId(terminal.cred3) || ''

      await this.persistLastKnownBalance(traderId, cardId, previousState, currentBalance, goal)

      await this.terminalBalanceOrchestratorService.broadcastBalanceUpdate(
        terminalId,
        traderId,
        cardId,
        terminalName,
        sendId,
        currentBalance,
        goal
      )

      const { shouldRequeue, customDelay } = await this.balanceProcessor.processBalance(
        data,
        terminalName,
        sendId,
        currentBalance,
        goal,
        incrementalDelta,
        cachedBalance
      )

      if (shouldRequeue && !data.isManualSync) scheduleNext(terminalId, data, customDelay)
      else if (!shouldRequeue) stopPolling(terminalId)
    } catch (error) {
      const status =
        error instanceof HttpException
          ? error.getStatus()
          : isAxiosError(error)
            ? error.response?.status
            : undefined

      // A 404 means the bank no longer serves this target; INACTIVE means it
      // answered and said the pot is closed. Either way no money can arrive
      // here again, so retrying is pointless — and it used to happen forever,
      // because INACTIVE is a 400 and fell through to the generic branch at the
      // bottom, which reschedules. That is the error every few seconds in the
      // logs for a closed PrivatBank envelope or PUMB moneybox.
      //
      // Shared with the reconciliation sweep, which frees a user's sale
      // slot on the same verdict — see `isDeadJarError`.
      const isDeadJar = isDeadJarError(error)

      if (isDeadJar) {
        await this.errorHandler.handleDeadJar(
          terminalId,
          traderId,
          cardId,
          apiToken,
          status === 404 ? 'HTTP 404' : 'bank reports the jar closed'
        )
        stopPolling(terminalId)
        if (data.isManualSync) throw error
        return
      }

      if (status === 401) {
        this.logger.error(
          `🚨 UNAUTHORIZED (401) for terminal ${terminalId}. Trader ${traderId}. X-API-TOKEN: ${apiToken}`
        )
        if (data.isManualSync) throw error
        scheduleNext(terminalId, data, 10000)
        return
      }

      if (status === 429 || status === 403) {
        const backoff = 30000 + Math.floor(Math.random() * 30000)
        this.logger.warn(
          `Rate limit / WAF block (HTTP ${status}) for terminal ${terminalId}. Backing off for ${backoff}ms.`
        )
        if (!data.isManualSync) scheduleNext(terminalId, data, backoff)
        if (data.isManualSync) throw error
        return
      }

      this.logger.error(`Error processing terminal ${terminalId}: ${error.message}`, error.stack)
      if (!data.isManualSync) scheduleNext(terminalId, data)
      if (data.isManualSync) {
        throw new HttpException({ ...ERROR.SCRAPER.PROCESSING_FAILED, details: error.message }, 400)
      }
    } finally {
      await this.terminalStateCache.releaseLock(terminalId)
    }
  }

  /**
   * Makes a balance that went **down** prove itself before anything acts on it.
   *
   * A reading below the baseline is the most expensive verdict this pipeline
   * reaches: `handleFraudOrWithdrawal` raises a FRAUD alert, disables the
   * credential on Transacto, fails every pending order on the card and stops
   * the loop. It is also irreversible from here — an operator has to put it
   * back — and it is reached from a single number read off somebody else's
   * service.
   *
   * Two defences, because there are two ways that number goes wrong:
   *
   * 1. **A reading that disagrees with itself.** Asked twice, the bank answers
   *    differently — a truncated parse, a partial response, a proxy serving
   *    something else. Both readings have to agree that money left.
   * 2. **A reading that is confidently stale.** NovaPay intermittently answers
   *    with a balance from about a minute earlier, and asking again lands in
   *    the same cache and gets the same answer. Nothing about such a response
   *    says it is stale — it is simply what the jar held a minute ago. The only
   *    thing that separates it from a withdrawal is time, so for those banks the
   *    drop has to *persist* for `BANK_DROP_CONFIRM_MS` before it is believed.
   *
   * While a drop is still serving its time, the pass is abandoned rather than
   * processed: nothing is broadcast, nothing is persisted, no delta is matched.
   * That is what makes the recovery clean — the cached balance never moved, so
   * when the true figure comes back it is not read as a fresh deposit.
   *
   * The cost of the wait falls only on a genuine withdrawal, which is reported
   * thirty seconds later than it used to be. The money left before either
   * reading could have told us; nothing is saved by believing the first one.
   *
   * @returns the reading to act on, or `null` to skip this pass entirely.
   */
  private async confirmDrop(
    terminalId: number,
    data: ScraperJobData,
    terminal: { cred3?: string | null },
    reading: UnifiedBankBalance
  ): Promise<UnifiedBankBalance | null> {
    const baseline = await this.terminalStateCache.getBaseline(terminalId)

    if (baseline === null || reading.actualBalance >= baseline) {
      // Unconditionally, including when nothing was being tracked: the marker
      // must never outlive the drop it measures, or the next unrelated dip
      // inherits a clock that started hours ago and fires immediately.
      //
      // A marker that was actually there means this terminal was withheld from
      // new payers while the drop was unresolved, and the drop is now over.
      if (await this.terminalStateCache.clearDropSeen(terminalId))
        await this.resumeRouting(data, terminalId, reading.actualBalance)

      return reading
    }

    if (!(await this.dropHasPersisted(terminalId, data, terminal, reading, baseline))) return null

    const second = await this.bankScraperService.scrape(terminalId)
    // The second reading, not the first: if money really is leaving, the fresher
    // figure is the one to record.
    if (second.actualBalance < baseline) return second

    this.logger.error(
      `Terminal ${terminalId} read ${reading.actualBalance} kopecks against a baseline of ` +
        `${baseline}, then ${second.actualBalance} on an immediate re-read. Two readings that ` +
        `disagree about a withdrawal are not grounds to disable a terminal — skipping this pass.`
    )

    return null
  }

  /**
   * Whether this bank's drops have to serve time, and whether this one has.
   *
   * True immediately for every bank with no window — which is all of them but
   * NovaPay, and the reason a real withdrawal is still caught on the scrape
   * that sees it.
   *
   * The window is measured from the **first** reading below the baseline, not
   * from this one, so a drop that has been sitting there for a minute is acted
   * on at once rather than starting its wait over on every poll.
   *
   * The marker's TTL is four windows: long enough that a slow poll cannot let it
   * expire mid-wait, short enough that a terminal which stops being scraped does
   * not keep one indefinitely. It is cleared on the first healthy reading and
   * with the rest of the terminal's keys on deactivation.
   */
  private async dropHasPersisted(
    terminalId: number,
    data: ScraperJobData,
    terminal: { cred3?: string | null },
    reading: UnifiedBankBalance,
    baseline: number
  ): Promise<boolean> {
    const provider = terminal.cred3 ? getBankProvider(terminal.cred3) : null
    const window = provider ? BANK_DROP_CONFIRM_MS[provider] : 0

    if (window <= 0) return true

    const { persistedMs: persisted, isFirst } = await this.terminalStateCache.markDropSeen(
      terminalId,
      window * 4
    )

    // The moment the drop is *seen*, not the moment it is believed. Waiting is
    // what keeps a stale reading from tearing a terminal down; it must not also
    // mean waiting to stop sending payers to a jar that may really be emptying.
    // One call, on the transition in — Redis decides which reading that is.
    if (isFirst) await this.pauseRouting(data, terminalId, reading.actualBalance, baseline)

    if (persisted >= window) {
      this.logger.warn(
        `Terminal ${terminalId} (${provider}) has read below its baseline of ${baseline} for ` +
          `${persisted}ms; the drop to ${reading.actualBalance} kopecks is being believed.`
      )

      return true
    }

    this.logger.log(
      `Terminal ${terminalId} (${provider}) read ${reading.actualBalance} kopecks against a ` +
        `baseline of ${baseline}. ${provider} serves a stale balance from time to time, so this ` +
        `is held for ${window}ms before it counts — ${persisted}ms so far. Skipping this pass.`
    )

    return false
  }

  /**
   * Withholds a terminal from new payers while a drop is unresolved.
   *
   * Not a teardown and deliberately not one: `enable_orders: 0` upstream and
   * `acceptingOrders: false` locally, with the terminal still enabled, still
   * scraped and still able to take the orders already routed to it. Nothing is
   * alerted, nothing is cancelled, and a balance that comes back simply resumes.
   *
   * This is what makes a three-minute window affordable. The window's cost used
   * to be three more minutes of payers sent to a jar that might be emptying;
   * now the routing stops at the first sign and only the *verdict* waits.
   *
   * Never throws. A pause that could not be arranged upstream is worth logging
   * and no reason to abandon the scrape — the drop is still being measured, and
   * the verdict at the end of the window is unaffected.
   */
  private async pauseRouting(
    data: ScraperJobData,
    terminalId: number,
    balance: number,
    baseline: number
  ): Promise<void> {
    try {
      await this.deactivation.stopRouting({
        terminalId,
        traderId: data.traderId,
        cardId: data.cardId,
        apiToken: data.apiToken,
        reason: `Balance read ${balance} against a baseline of ${baseline}; holding new orders ` +
          `until the drop is confirmed or clears`
      })
    } catch (error: unknown) {
      this.logger.error(
        `Could not hold new orders on terminal ${terminalId} while its balance is below ` +
          `baseline: ${describeError(error)}`
      )
    }
  }

  /**
   * Puts a paused terminal back in front of payers, because the drop was noise.
   *
   * The mirror of {@link pauseRouting}, and reached only when a marker was
   * actually cleared — so a terminal nobody paused is never "resumed", which
   * would hand `enable_orders: 1` to a credential somebody had switched off on
   * purpose.
   *
   * Never throws, and a failure here is the one that matters least: the
   * terminal keeps working and keeps being scraped, it simply takes no new
   * orders until somebody notices. Logged as an error for exactly that reason.
   */
  private async resumeRouting(
    data: ScraperJobData,
    terminalId: number,
    balance: number
  ): Promise<void> {
    // A sale that has ended switched its own routing off on purpose, and this
    // is the one path that could switch it back on: the terminal is still
    // scraped, so a drop that clears — its owner moving money back, or a stale
    // reading correcting itself — reaches here and would hand `enable_orders: 1`
    // to a jar with nothing left to pay for. Payers would be sent to it, and
    // their hryvnia would land where nobody is matching it any more.
    if (await this.saleHasEnded(data.cardId)) {
      this.logger.log(
        `Terminal ${terminalId} is back at ${balance}, but its sale has already ended — ` +
          `leaving it out of the routing rather than reviving a finished jar.`
      )

      return
    }

    try {
      await this.activation.resumeRouting({
        traderId: data.traderId,
        cardId: data.cardId,
        apiToken: data.apiToken,
        reason: `Balance is back at ${balance}; the drop was a bad reading`
      })
    } catch (error: unknown) {
      this.logger.error(
        `Terminal ${terminalId} recovered but could not be put back in front of payers — it is ` +
          `watched and working, taking no new orders: ${describeError(error)}`
      )
    }
  }

  /**
   * Whether this card's sale is over, with its jar still open.
   *
   * Never throws, and **fails towards leaving the terminal paused**: a lookup
   * that could not be made must not be the reason payers are sent to a jar that
   * may be finished. A terminal wrongly left out of the routing is visible and
   * one call to put back; hryvnia landing in a finished jar is an appeal.
   */
  private async saleHasEnded(cardId: number): Promise<boolean> {
    try {
      return await this.saleDbService.isAwaitingJarClosureByCardId(cardId)
    } catch (error: unknown) {
      this.logger.warn(
        `Could not read the sale for card ${cardId} while deciding whether to resume ` +
          `routing: ${describeError(error)}`
      )

      return true
    }
  }

  /**
   * Keeps a durable copy of the scraped figures on the terminal document.
   *
   * Redis holds the live state, but `terminal:state:current:{id}` expires after
   * an hour and every deactivation path deletes it along with the rest of the
   * terminal's keys. A terminal that has been switched off therefore has no
   * balance and no goal left anywhere, which is why the extension could only
   * ever show figures for jars the scraper was actively polling.
   *
   * Written only when something moved. The scraper comes back every 5–10s per
   * terminal whether or not the jar changed, and an unconditional write here
   * would be a Mongo update per terminal per pass, forever, to store the same
   * number.
   *
   * A `goal` the bank did not report is left alone rather than written as null:
   * a scrape that omits the target says nothing about it, and blanking the
   * stored one would lose the only copy.
   */
  private async persistLastKnownBalance(
    traderId: number,
    cardId: number,
    previousState: { current: number; goal?: number } | null,
    currentBalance: number,
    goal: number | null | undefined
  ): Promise<void> {
    const hasGoal = goal !== null && goal !== undefined
    const balanceMoved = previousState?.current !== currentBalance
    const goalMoved = hasGoal && previousState?.goal !== goal

    if (!balanceMoved && !goalMoved) return

    await this.terminalDbService.updateOne(
      { traderId, cardId },
      {
        $set: {
          lastBalance: currentBalance,
          lastBalanceAt: new Date(),
          ...(hasGoal ? { lastGoal: goal } : {})
        }
      }
    )
  }
}
