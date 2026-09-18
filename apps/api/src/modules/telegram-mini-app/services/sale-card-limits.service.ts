import { Injectable, Logger } from '@nestjs/common'
import { SALE_CARD_MAX_ORDERS } from '@transacto/contracts'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { cardCredentialWindow, type CardCredentialWindow } from 'src/modules/telegram-mini-app/utils'
import { TmaServiceTraderService } from 'src/modules/telegram-mini-app/services/tma-service-trader.service'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { describeError, transactoOrderFloorKopecks } from 'src/shared/utils'

/**
 * Keeps a card sale's credential in step with what the sale still needs.
 *
 * **A minimum computed once at creation strands money.** It is an equal share of
 * the *original* target across all seven slots, and it stays that size however
 * much has already arrived. Two payers sending ₴4 500 each against a ₴10 000
 * sale leave ₴1 000 outstanding and five slots free — and a minimum still set to
 * ₴1 428, which nothing under it can satisfy. The sale stops with ₴1 000 it was
 * perfectly able to collect, and the user gets USDT back instead of the hryvnia
 * they asked for.
 *
 * So the share is taken again after every order that settles, over what is
 * actually left and the slots that are actually free. The arithmetic is
 * {@link saleCardOrderFloorKopecks}, in the contract, because the create form
 * quotes the same figure and the two must not disagree.
 *
 * **It is not a ratchet.** The minimum can rise by a hryvnia or so: flooring
 * each share to whole hryvnia leaves a residue in the remainder, and dividing
 * that by fewer slots can exceed the opening figure. What is guaranteed is the
 * property that matters — the minimum is never larger than what is left, so the
 * remainder can always be reached.
 *
 * `max_amount` is tightened alongside it, to the remainder. Left at the original
 * target it would let one payer be routed the whole sale again when ₴1 000 is
 * outstanding, and a card sale has no scraper to notice the overshoot.
 */
@Injectable()
export class SaleCardLimitsService {
  private readonly logger = new Logger(SaleCardLimitsService.name)

  constructor(
    private readonly transactoApiService: TransactoApiService,
    private readonly serviceTrader: TmaServiceTraderService
  ) {}

  /**
   * What the sale still needs, as figures — no upstream call.
   *
   * Separate from {@link retune} because two callers want the answer and only
   * one of them wants to write it: the sweep that decides a sale has nothing
   * left to collect is asking the same question as the credential update.
   *
   * **Slots are counted as orders routed here, not as orders executed.** Whether
   * Transacto's own `max_tx_count_total` counts attempts or settlements is not
   * documented and has not been captured, so this counts the conservative one.
   * Being wrong in this direction stops a sale one order early; being wrong in
   * the other would route an eighth payer to a credential that promised seven.
   */
  limitsFor(
    sale: Pick<TmaSale, 'fiatAmount' | 'receivedAmount' | 'cardOrders'>
  ): CardCredentialWindow {
    return cardCredentialWindow(
      Math.max(0, sale.fiatAmount - (sale.receivedAmount ?? 0)),
      Math.max(0, SALE_CARD_MAX_ORDERS - (sale.cardOrders?.length ?? 0)),
      transactoOrderFloorKopecks()
    )
  }

  /**
   * Writes the recomputed limits upstream. Never throws.
   *
   * By the time this runs the order that triggered it is already settled — the
   * money has moved and the USDT with it — so a Transacto hiccup must not
   * surface as a failed settlement. The consequence of a missed update is a
   * minimum that stays too high for one more order, which the next settlement
   * corrects; the consequence of throwing here would be a user's completed
   * payment reported as a failure.
   *
   * A sale with nothing left to route is left alone rather than sent a minimum
   * of zero — "any amount at all" is the opposite of what that state means. What
   * happens to the tail is the caller's to decide: a refund, or an operator's
   * transfer.
   */
  async retune(
    sale: Pick<TmaSale, 'publicId' | 'cardId' | 'fiatAmount' | 'receivedAmount' | 'cardOrders'>
  ): Promise<CardCredentialWindow> {
    const limits = this.limitsFor(sale)

    if (sale.cardId === null || limits.minKopecks <= 0) return limits

    try {
      const { apiToken } = await this.serviceTrader.resolve()

      await this.transactoApiService.updateTerminals(apiToken, {
        card_id: sale.cardId,
        min_amount: limits.minAmountUah,
        max_amount: limits.maxAmountUah
      })

      this.logger.log(
        `Sale ${sale.publicId}: ${limits.ordersLeft} slot(s) left for ` +
          `${limits.remainingKopecks} kopecks, so the order minimum is now ${limits.minKopecks}`
      )
    } catch (error: unknown) {
      this.logger.error(
        `Sale ${sale.publicId}: could not retune the credential's limits — the next order's ` +
          `minimum stays where it was: ${describeError(error)}`
      )
    }

    return limits
  }
}
