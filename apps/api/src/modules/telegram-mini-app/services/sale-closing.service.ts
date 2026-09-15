import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { OrderDbService } from 'src/modules/repositories/order-db'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { describeError } from 'src/shared/utils'

/**
 * Finishes the sales that are winding down.
 *
 * A user who stops an order with payments still outstanding does not get an
 * ending on the spot: the terminal stays in service so a payer already holding
 * an order can still pay, and only when nothing is outstanding any more can the
 * stake be unwound. This is what notices that moment.
 *
 * **A poll rather than a subscription, deliberately.** The last outstanding
 * order can close through any of four routes — the scrape and its matcher, an
 * `order.paid` webhook, an `order.cancelled` webhook, or the thirty-second
 * `orders_list` sync — and hanging the settlement off each of them would mean
 * four places that must all be right, and none of them surviving a restart that
 * happens in between. Reading the state every half minute needs none of them to
 * be reliable and resumes by itself.
 *
 * There is no timeout here on purpose. An order stays outstanding until
 * Transacto closes it, including a `PAUSED` one and an `APPEAL` under dispute,
 * and money in dispute is money that can still arrive.
 */
@Injectable()
export class SaleClosingService {
  private readonly logger = new Logger(SaleClosingService.name)

  /** One pass at a time: a settlement moves money and must not overlap itself. */
  private running = false

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly orderDbService: OrderDbService,
    private readonly cancelService: SaleCancelService
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async settleFinishedClosings(): Promise<void> {
    if (this.running) {
      this.logger.debug('Closing sweep already in progress, skipping')
      return
    }

    this.running = true
    try {
      const closing = await this.saleDbService.findClosing()
      if (closing.length === 0) return

      for (const order of closing) {
        // One failure must not strand every other order waiting behind it.
        try {
          await this.settleIfFinished(order)
        } catch (error: unknown) {
          this.logger.error(
            `Could not settle closing sale ${order.publicId}: ${describeError(error)}`
          )
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Closing sweep failed: ${describeError(error)}`)
    } finally {
      this.running = false
    }
  }

  /**
   * Settles one order, if its terminal has nothing outstanding left.
   *
   * `cardId === null` means the order never got a terminal, so there is nothing
   * that could still be paid and it can be unwound at once.
   */
  private async settleIfFinished(
    order: Awaited<ReturnType<TmaSaleDbService['findClosing']>>[number]
  ): Promise<void> {
    if (order.cardId !== null) {
      const outstanding = await this.orderDbService.findUnsettledByCard(order.cardId)

      if (outstanding.length > 0) {
        this.logger.debug(
          `Sale ${order.publicId} still waiting on ${outstanding.length} order(s)`
        )
        return
      }

      // And the jar itself has to be shut. An order can expire while its jar
      // stays open, and money that arrives afterwards matches nothing and comes
      // back as an appeal — so the stake is not released until the one person
      // who can close the jar has done it.
      if (order.jarClosedAt === null) {
        this.logger.debug(
          `Sale ${order.publicId} is waiting for its owner to close the jar`
        )
        return
      }
    }

    this.logger.log(
      `Sale ${order.publicId}: nothing outstanding left, settling the user's stop`
    )

    // `settle` reads nothing back — it works on the document handed to it — and
    // this one came from the sweep's own query moments ago, so the balance it
    // unwinds against is as fresh as the last scrape made it.
    try {
      await this.cancelService.settle(order)
    } catch (error: unknown) {
      // Something else ended the order between the query and here: the jar
      // filled and the completion path took it, or a second instance's sweep
      // got there first. `cancelIfOpen` is atomic, so exactly one of them moved
      // the money — this is the one that did not, and it is routine rather than
      // a failure worth an error line.
      if (error instanceof ConflictException) {
        this.logger.log(
          `Sale ${order.publicId} was already settled by another path; nothing to do`
        )
        return
      }

      throw error
    }
  }
}
