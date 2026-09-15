import { Injectable, Logger } from '@nestjs/common'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import { TerminalBroadcastService } from './terminal-broadcast.service'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { describeError } from 'src/shared/utils'

/** Everything bringing a terminal back into service needs to know. */
export interface TerminalActivation {
  readonly traderId: number
  readonly cardId: number
  /** Named in every log line, so an operator knows why it came back. */
  readonly reason: string
  /**
   * The trader's token. Required, unlike on a teardown.
   *
   * A teardown may legitimately have nothing to tell upstream — the credential
   * is already gone. Coming back is the opposite: without the upstream flags
   * the local row is switched on and then switched straight off again by the
   * next terminals sync, so an activation with no token is not a partial
   * success, it is a no-op with a log line.
   */
  readonly apiToken: string
}

/**
 * The one place a terminal is put back into service.
 *
 * The mirror of {@link TerminalDeactivationService}, and a separate class for
 * the same reason that one exists: each direction has its own ordering
 * constraint and its own failure semantics, and folding them into a
 * `setEnabled(boolean)` would hide both behind a flag.
 *
 * **Upstream first, then Mongo — the opposite of a teardown, and deliberately
 * so.** `TerminalsSyncService.resolveEnabled` reads Transacto's `enable_orders`
 * back into the local `enabled` flag, so a terminal switched on locally while
 * still stood down upstream is switched off again within a minute, and the
 * operator is left looking at a button that appears not to work. Making the
 * upstream call the gate means a failure leaves the terminal exactly as it was
 * rather than in a state the next sync will silently revert.
 *
 * Nothing here restores Redis. A teardown deletes the terminal's baseline on
 * purpose — so that a revived terminal does not compare today's balance against
 * a figure from before it went away and read an emptied jar as a withdrawal —
 * and the scraper re-establishes one on its first pass. Reviving that number
 * would reintroduce exactly the bug the deletion prevents.
 */
@Injectable()
export class TerminalActivationService {
  private readonly logger = new Logger(TerminalActivationService.name)

  constructor(
    private readonly terminalDbService: TerminalDbService,
    private readonly transactoApiService: TransactoApiService,
    private readonly broadcast: TerminalBroadcastService
  ) {}

  /**
   * Puts the terminal back in service, both upstream and locally.
   *
   * Throws when Transacto refuses, unlike the teardown paths — the caller is an
   * operator waiting on an answer, not a scraper on a hot path, and telling
   * them it worked when it did not is the one outcome worth avoiding.
   */
  async activate(request: TerminalActivation): Promise<void> {
    const { traderId, cardId, reason, apiToken } = request

    await this.transactoApiService.updateTerminals(apiToken, {
      card_id: cardId,
      enabled: 1,
      enable_orders: 1
    })

    await this.terminalDbService.updateOne(
      { traderId, cardId },
      { $set: { enabled: true, acceptingOrders: true } }
    )

    const terminal = await this.terminalDbService.findOne({ traderId, cardId })

    // Best-effort, and last: the announcement puts the card back on the
    // trader's dashboard, and a terminal that is in service but not yet on
    // screen is recoverable by a refresh — whereas announcing before the flags
    // were written would show a card the scraper is not watching.
    if (terminal) {
      try {
        await this.broadcast.announceEnabled(terminal)
      } catch (error: unknown) {
        this.logger.error(
          `${reason}: terminal on card_id ${cardId} is back in service but could not be ` +
            `announced to trader ${traderId}: ${describeError(error)}`
        )
      }
    }

    this.logger.log(
      `${reason}: terminal on card_id ${cardId} (trader ${traderId}) is back in service`
    )
  }

  /**
   * Resumes order routing without otherwise touching the terminal.
   *
   * The mirror of `TerminalDeactivationService.stopRouting`: `enable_orders: 1`
   * alone, for a terminal that stayed in service throughout and was only
   * withheld from new payers.
   */
  async resumeRouting(request: TerminalActivation): Promise<void> {
    const { traderId, cardId, reason, apiToken } = request

    await this.transactoApiService.updateTerminals(apiToken, {
      card_id: cardId,
      enable_orders: 1
    })

    await this.terminalDbService.updateOne(
      { traderId, cardId },
      { $set: { acceptingOrders: true } }
    )

    this.logger.log(
      `${reason}: terminal on card_id ${cardId} (trader ${traderId}) is taking new orders again`
    )
  }
}
