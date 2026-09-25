import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import {
  CARD_NUMBER_LENGTH,
  cardDigits,
  isLuhnValid,
  ERROR,
  isCardSaleBankEnabled,
  MIN_RECEIVER_NAME_LENGTH,
  SALE_CARD_MAX_ORDERS,
  SaleMethod
} from '@transacto/contracts'
import type {
  SaleCredentialLimits,
  SaleDestination,
  SaleDestinationRequest,
  SaleDestinationStrategy
} from 'src/modules/telegram-mini-app/interfaces/sale-destination-strategy.interface'
import { cardCredentialWindow } from 'src/modules/telegram-mini-app/utils'
import { collapseWhitespace, transactoOrderFloorKopecks } from 'src/shared/utils'

/**
 * How many payers may hold an order against one card at once.
 *
 * **One**, and this is the single most load-bearing number in the variant.
 *
 * A jar sale allows three because the scraper reconciles a balance: several
 * transfers in flight produce one delta the matcher resolves, and a
 * miscounting is caught by `SaleBlockReason.LEDGER_MISMATCH`, which compares
 * two independent records of the same hryvnia. A card sale has no second
 * record — the seller pressing a button is the only one — so that guard cannot
 * be built here at all.
 *
 * With one order open at a time, a seller is answering one question about one
 * amount, and the worst a mistaken answer can cost is that amount. Allow two
 * and the question becomes "did *some* money arrive", which nobody can answer
 * about a card that receives more than one transfer a day.
 */
const CARD_MAX_OPEN_ORDERS = 1

/**
 * A sale that pays straight to the user's own card.
 *
 * The mirror of {@link JarSaleDestinationService} with every witness removed.
 * There is no link to resolve, so no goal, no owner and no card the bank will
 * vouch for: the seller types sixteen digits and a name, and both are claims
 * until a bank statement says otherwise.
 *
 * That is not an oversight to be patched later — it is the shape of the
 * product. What keeps it honest is the arithmetic in
 * {@link credentialLimits}, which bounds what any one unverified claim can
 * cost, and the statement a disputed order is answered with.
 */
@Injectable()
export class CardSaleDestinationService implements SaleDestinationStrategy {
  readonly method = SaleMethod.CARD

  private readonly logger = new Logger(CardSaleDestinationService.name)

  async resolve(request: SaleDestinationRequest): Promise<SaleDestination> {
    const { bankType, cardNumber, seller } = request


    // A bank is on this list only if a disputed order has a route out — that
    // is, only if there is something that can read its statements. Accepting
    // one that is not would create disputes with nowhere to go.
    if (!isCardSaleBankEnabled(bankType)) {
      this.logger.warn(
        `Refused a card sale for telegramId ${seller.telegramId}: ${bankType} is not open ` +
          `for card payouts`
      )
      throw new BadRequestException(ERROR.SALE.BANK_UNAVAILABLE)
    }

    const digits = cardDigits(cardNumber)

    // Length and checksum. This used to be length alone, on the reasoning that
    // a second implementation of Luhn here could only disagree with the one
    // that matters — which was right while the alternative was writing it
    // twice. It is now written once, in the contract, and the form calls the
    // same function: the two cannot disagree, and a mistyped digit is refused
    // here as well as on the screen. `isLuhnValid` enforces the length too; the
    // check stays spelled out because the two failures are one message to a
    // user and two different mistakes.
    if (!isLuhnValid(digits)) {
      this.logger.warn(
        `Refused a card sale for telegramId ${seller.telegramId}: the card number is ` +
          `${digits.length} digits and ${digits.length === CARD_NUMBER_LENGTH ? 'fails' : 'cannot pass'} its checksum`
      )
      throw new BadRequestException(ERROR.SALE_CARD.INVALID_CARD_NUMBER)
    }

    // The seller names their own card's holder, because nothing else can.
    //
    // Required rather than falling back to the Telegram profile the way a jar
    // sale does. That fallback names whoever *created* the sale, which is a
    // reasonable guess when a bank has already vouched for the destination and
    // a poor one when the destination is sixteen typed digits: a payer shown a
    // name that does not match the card they are paying has been given a reason
    // to abandon the transfer.
    //
    // It is a claim, and it is treated as one. It becomes the terminal's name at
    // Transacto, which is what a payer reads, and is not written down here.
    const receiverName = collapseWhitespace(request.receiverName)
    if (receiverName.length < MIN_RECEIVER_NAME_LENGTH)
      throw new BadRequestException(ERROR.SALE_CARD.RECEIVER_NAME_REQUIRED)

    return {
      receiverName,
      payoutCardNumber: digits,
      // No jar, so nothing for Transacto to route a payer to beyond the card.
      dropLink: null,
      // Never true here, and the field is not merely unused: it switches off
      // the dead-order fraud rule, which exists to catch a card that does not
      // belong to the jar. There is no jar, nothing has vouched for anything,
      // and every check this variant has still has to run.
      cardVerifiedByBank: false,
      // No goal exists to compare against, so the goal check is skipped by
      // being unanswerable rather than by being switched off.
      observedGoal: null
    }
  }

  /**
   * The three numbers that stand in for a ledger guard.
   *
   * `LEDGER_MISMATCH` compares what was credited against what a jar was
   * observed to hold, and refuses a completion where the two disagree. A card
   * sale has one record of the money and therefore nothing to compare, so the
   * guard is unbuildable rather than switched off — and these limits are what
   * replaces it.
   *
   * Together they cap one unnoticed mistake at a seventh of the sale instead of
   * all of it:
   *
   * - **one open order**, so exactly one question is outstanding at a time;
   * - **a minimum of `target / 7`**, so no order can be small enough to be
   *   waved through without thought, and no eighth one can be routed;
   * - **seven transactions in total**, enforced upstream rather than counted
   *   here, because a cap we enforce after the fact is a cap that has already
   *   been exceeded.
   *
   * Changing any of them widens that in exact proportion, which is why they are
   * derived from shared arithmetic rather than configured.
   */
  credentialLimits(targetKopecks: number): SaleCredentialLimits {
    // Creation is the same question `SaleCardLimitsService` asks after every
    // settlement, at the moment nothing has arrived and every slot is free —
    // so it is the same function, not a second copy of the arithmetic.
    const window = cardCredentialWindow(
      targetKopecks,
      SALE_CARD_MAX_ORDERS,
      transactoOrderFloorKopecks()
    )

    return {
      maxOpenOrders: CARD_MAX_OPEN_ORDERS,
      minAmountUah: window.minAmountUah,
      maxAmountUah: window.maxAmountUah,
      maxTxCountTotal: SALE_CARD_MAX_ORDERS
    }
  }
}
