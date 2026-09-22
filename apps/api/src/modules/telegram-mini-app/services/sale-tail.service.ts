import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ERROR, SaleEvidence, SaleEventType, SaleMethod } from '@transacto/contracts'
import { MINUTE_MS, SALE_TAIL_RELEASE_AFTER_MINUTES } from 'src/shared/constants'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { StoredSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { saleTailKopecks, transactoOrderFloorKopecks } from 'src/shared/utils'

/**
 * What can happen to a tail once nothing can be routed for it.
 *
 * A tail is the stretch under Transacto's order floor: nothing can be routed
 * for it, so it arrives as one transfer somebody makes by hand or it does not
 * arrive at all. A sale created with `REFUND_TO_BALANCE` never gets here — its
 * tail comes back as USDT the moment it appears, with nobody asked anything.
 * What is left is the sale that asked to wait, and three things that can happen
 * to it:
 *
 * - **an operator takes it on**, which is the only one that is not the
 *   seller's: it is the answer to the alert, and it is what puts a last order
 *   on their screen and takes the stop button away;
 * - **the seller says the transfer arrived**, which is the ending they wanted;
 *   or
 * - **the seller stops waiting**, once the wait has run out, and takes the gap
 *   as USDT instead — the other ending, chosen at the end rather than at the
 *   start.
 *
 * **None of them moves money on its own.** Each writes one figure and then asks
 * `reconsiderFunding` what it means, so a tail closes through the same
 * settlement rules as every other hryvnia in this product. A second path that
 * completed a sale itself would be a second place where a stake is released.
 */
@Injectable()
export class SaleTailService {
  private readonly logger = new Logger(SaleTailService.name)

  constructor(
    private readonly saleDbService: TmaSaleDbService,
    private readonly cardOrders: SaleCardOrderService,
    private readonly progressService: SaleProgressService
  ) {}

  /**
   * An operator answers the alert: they are making the transfer.
   *
   * **The only call here nobody in the Mini App can make**, and the only one
   * that changes what the seller is allowed to do rather than what they have.
   * It comes from the operators' group, where the alert was posted, and what
   * identifies the sale is the message being replied to — see
   * `findByTailAlert`.
   *
   * Three things follow from it, and all three are why the claim exists rather
   * than the alert alone being enough:
   *
   * - the seller's screen gains a last order, where before it had a stopped bar
   *   and a promise that somebody had been asked;
   * - the sale stops being theirs to end, because hryvnia is now on its way to
   *   a card nothing watches; and
   * - the clock starts again, so the operator has the full wait to make the
   *   transfer however long the alert had been sitting there.
   *
   * Refused on a sale that is no longer waiting, or no longer open — an
   * operator told "accepted" for a sale that closed would transfer into a
   * finished order, which is the accident this whole arrangement exists to
   * prevent. `false` means somebody else already took it, which is not a
   * failure and is worth saying differently in the chat.
   */
  async claim(saleId: string): Promise<boolean> {
    const sale = await this.load(saleId)

    this.tailOf(sale)

    const claimed = await this.saleDbService.markTailClaimed(saleId)

    if (!claimed) {
      // The filter refuses three cases and the sale says which. Already taken
      // is ordinary — two operators reading the same alert — and the other two
      // mean nobody should be transferring anything.
      if (sale.tailClaimedAt) return false

      throw new ConflictException(ERROR.SALE.TAIL_NOT_WAITING)
    }

    this.logger.log(
      `Sale ${claimed.publicId}: an operator has taken its tail on; it cannot be stopped ` +
        `for the next ${SALE_TAIL_RELEASE_AFTER_MINUTES} minutes`
    )

    // No money moved, so `reconsiderFunding` has nothing to reconsider — what
    // changed is what the screen may draw and what the stop button may do, and
    // that travels as a snapshot like every other change to those.
    await this.progressService.emit(claimed)

    return true
  }

  /**
   * The seller says the hand-made transfer landed.
   *
   * **Card sales only, and not because of a permission.** A jar sale's tail is
   * seen rather than reported: the scraper reads the balance, so a transfer
   * into the jar arrives as a balance change and `isSaleFunded` closes the sale
   * without anybody tapping anything. Offering a button there would be offering
   * to credit hryvnia twice.
   *
   * Taken at face value for the reason every confirmation in this variant is:
   * claiming money that never came costs the seller their own stake, and it is
   * the last thing standing between them and a completed sale. What it cannot
   * do is exceed the gap — the figure credited is the tail this service read,
   * never a number from the request, because there is no number in the request.
   */
  async confirm(telegramId: number, saleId: string): Promise<StoredSale> {
    const sale = await this.load(saleId, telegramId)

    if ((sale.saleMethod ?? SaleMethod.JAR) !== SaleMethod.CARD)
      throw new BadRequestException(ERROR.SALE_CARD.NOT_A_CARD_SALE)

    // Nobody has been sent to their banking app, so nothing can have landed.
    // An operator who transferred without claiming it first has skipped the one
    // step that tells this seller an order exists — the fix is the `+`, not a
    // credit taken on trust for a transfer we have no record of asking for.
    if (!sale.tailClaimedAt) throw new ConflictException(ERROR.SALE.TAIL_NOT_CLAIMED)

    const tail = this.tailOf(sale)

    const credited = await this.saleDbService.creditTail(saleId, tail)

    if (!credited) {
      // Two taps, or the bot and the screen at once. Whoever was first has
      // already credited it and the settlement below has already run.
      this.logger.debug(`Sale ${sale.publicId}: its tail was already confirmed`)

      return (await this.saleDbService.findById(saleId)) ?? sale
    }

    this.logger.log(
      `Sale ${sale.publicId}: seller confirms the ${tail} kopeck tail arrived by hand`
    )

    await this.saleDbService.appendEvent(saleId, {
      type: SaleEventType.PAYMENT_MATCHED,
      amount: tail,
      at: Date.now(),
      evidence: SaleEvidence.SELLER
    })

    return this.cardOrders.reconsiderFunding(credited)
  }

  /**
   * The seller stops waiting, and takes the tail as USDT.
   *
   * Available to both variants: a jar sale can be left waiting on a trader's
   * transfer exactly as a card sale can, and the seller is owed the same way
   * out of it.
   *
   * **The clock runs from the later of being told and being taken on**, not
   * from the moment the tail appeared. A tail held for a statement of the
   * seller's own can be hours old before anyone hears about it, and a wait that
   * had already run out by then would hand back USDT for a transfer nobody had
   * a chance to make; an operator who takes one on late is owed the same window
   * for the same reason. A sale nobody has been asked about yet therefore has
   * no clock running at all, and is refused here.
   *
   * The whole rule travels into the filter of `markTailWaived` rather than
   * being decided here and written there: a request that raced the clock is
   * refused by the database, not by a comparison made a moment earlier.
   */
  async release(telegramId: number, saleId: string): Promise<StoredSale> {
    const sale = await this.load(saleId, telegramId)

    this.tailOf(sale)

    const waived = await this.saleDbService.markTailWaived(saleId, this.releasableFrom())

    if (!waived) {
      // Either somebody released it already, or the wait is not up. The second
      // is the one worth a message: the screen sends `releasableAt` and this
      // refuses anything earlier, so a client with a fast clock is told rather
      // than quietly given a refund.
      if (sale.tailWaivedAt) return (await this.saleDbService.findById(saleId)) ?? sale

      throw new ConflictException(ERROR.SALE.TAIL_NOT_RELEASABLE)
    }

    this.logger.warn(
      `Sale ${waived.publicId}: seller stopped waiting for its tail after ` +
        `${SALE_TAIL_RELEASE_AFTER_MINUTES} minutes; it comes back as USDT`
    )

    return this.cardOrders.reconsiderFunding(waived)
  }

  /**
   * How far in the past the wait has to have started for it to be over.
   *
   * Computed here and compared in the database — against both moments the wait
   * can have started from — so the boundary is one value used once rather than
   * a rule stated on both sides of a round trip.
   */
  private releasableFrom(): Date {
    return new Date(Date.now() - SALE_TAIL_RELEASE_AFTER_MINUTES * MINUTE_MS)
  }

  /**
   * The sale, proving on the way that this caller owns it.
   *
   * The same 404 for "not yours" as for "not there": an id that is not the
   * caller's should not be confirmable by the shape of the error.
   *
   * `telegramId` is omitted only by {@link claim}, which has no seller to be:
   * it is answered by an operator, and what proves their right to answer is
   * that the alert was posted in the operators' group in the first place.
   */
  private async load(saleId: string, telegramId?: number): Promise<StoredSale> {
    const sale = await this.saleDbService.findById(saleId)

    if (!sale || (telegramId !== undefined && sale.telegramId !== telegramId))
      throw new NotFoundException(ERROR.SALE.NOT_FOUND)

    return sale
  }

  /**
   * The gap, or a refusal.
   *
   * Read here rather than taken from the request, and re-read on every call
   * rather than trusted from the snapshot the screen was drawn with: a payment
   * can land between the two, and a sale that is no longer in its tail has
   * nothing to confirm and nothing to release.
   */
  private tailOf(sale: StoredSale): number {
    const tail = saleTailKopecks(sale, transactoOrderFloorKopecks())

    if (tail === 0) throw new ConflictException(ERROR.SALE.TAIL_NOT_WAITING)

    return tail
  }
}
