import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { TerminalDeactivationService } from 'src/modules/terminal'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { AlertsService } from 'src/modules/alerts/services/alerts.service'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { TerminalStateCacheService } from './terminal-state-cache.service'
import { TraderWsEvent, WsEventNames } from 'src/shared/interfaces'
import { AlertType, AlertDocument } from 'src/modules/repositories/alerts-db/schemas'

@Injectable()
export class TerminalErrorHandlerService {
  private readonly logger = new Logger(TerminalErrorHandlerService.name)

  constructor(
    private readonly deactivation: TerminalDeactivationService,
    private readonly trackedOrderDbService: OrderDbService,
    private readonly alertsService: AlertsService,
    private readonly terminalStateCache: TerminalStateCacheService,
    private readonly eventEmitter: EventEmitter2,
    private readonly saleDbService: TmaSaleDbService
  ) {}

  /**
   * The jar, envelope or moneybox behind this terminal is gone.
   *
   * Two signals arrive here. A 404 means the bank no longer serves the target
   * at all; `ERROR.TERMINAL.INACTIVE` means it answered and said the pot is
   * closed — PrivatBank's `active: false`, PUMB's non-`ACTIVE` status. Both mean
   * the same thing operationally: no money can ever arrive here again.
   *
   * The terminal still exists upstream in that case, so it is disabled on
   * Transacto as well — otherwise Transacto keeps routing orders to a
   * credential that cannot receive them, and the next sync would re-enable the
   * local row from `enable_orders` and start the whole loop again.
   *
   * @param reason what the bank actually said, for the log line only.
   */
  async handleDeadJar(
    terminalId: number,
    traderId: number,
    cardId: number,
    apiToken: string,
    reason = 'HTTP 404'
  ): Promise<void> {
    this.logger.error(
      `🚨 DEAD JAR DETECTED (${reason}) for terminal ${terminalId}. Trader ${traderId}, card_id ${cardId}. Disabling credential.`
    )

    // The Redis teardown that used to follow this call is part of it now, and
    // ordered inside it: Mongo first, then the keys, because the watchdog reads
    // a missing heartbeat on an *enabled* terminal as a loop to revive.
    await this.disableTerminal(terminalId, traderId, cardId, apiToken, `Dead jar (${reason})`)
    await this.trackedOrderDbService.failPendingOrdersForCard(cardId)

    // A dead jar is a *closed* jar, and that is the thing a Mini App user has
    // to do before their sale slot comes back and — for an order they
    // stopped themselves — before their stake is returned. This is the only
    // place that ever learns of it: the scraper is what asks the bank.
    //
    // Recorded even when no sale matches the card, which is the common
    // case for a terminal the trader made themselves. `markJarClosedByCardId`
    // simply writes nothing then.
    const marked = await this.saleDbService.markJarClosedByCardId(cardId)
    if (marked > 0) {
      this.logger.log(
        `Jar for card_id ${cardId} is closed; ${marked} sale(s) released from waiting on it`
      )
    }
  }

  async handleFraudOrWithdrawal(
    terminalId: number,
    traderId: number,
    cardId: number,
    baselineBalance: number,
    currentBalance: number,
    apiToken: string
  ): Promise<AlertDocument | void> {
    this.logger.error(
      `🚨 FRAUD/WITHDRAWAL DETECTED. Balance dropped from ${baselineBalance} to ${currentBalance}. ` +
        `Trader ${traderId}, card_id ${cardId}. Disabling credential.`
    )

    let fraudAlert: AlertDocument | undefined
    const alreadyHasFraud = await this.alertsService.hasPendingAlertOfType(
      terminalId,
      AlertType.FRAUD
    )

    if (!alreadyHasFraud) {
      const { alert } = await this.alertsService.createAlert(
        traderId,
        terminalId,
        AlertType.FRAUD,
        currentBalance,
        { previousBalance: baselineBalance, currentBalance }
      )
      fraudAlert = alert
    }

    await this.disableTerminal(terminalId, traderId, cardId, apiToken, 'Fraud or withdrawal')
    await this.trackedOrderDbService.failPendingOrdersForCard(cardId)

    return fraudAlert
  }

  /**
   * Hands the terminal to the one thing that takes terminals out of service.
   *
   * This used to do it itself, and got two things wrong that the shared path
   * does not. The Transacto call and the local write sat in **one `try`**, so a
   * Transacto hiccup skipped the Mongo write and left the terminal enabled here
   * — with the scraper polling a credential nobody would ever route to again.
   * And Redis was cleared by `handleDeadJar` afterwards but not by
   * `handleFraudOrWithdrawal` at all, so a fraud teardown left its baseline
   * behind: a terminal re-enabled later compared today's balance against a
   * figure from before it went away, read an emptied jar as a withdrawal, and
   * disabled itself for fraud again.
   */
  private async disableTerminal(
    terminalId: number,
    traderId: number,
    cardId: number,
    apiToken: string,
    reason: string
  ): Promise<void> {
    await this.deactivation.deactivate({ terminalId, traderId, cardId, reason, apiToken })
  }
}
