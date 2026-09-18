import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import {
  disclosesCardNumber,
  ERROR,
  isSaleBankEnabled,
  isSameCardNumber,
  masksCardNumber,
  matchesMaskedCard,
  SaleMethod
} from '@transacto/contracts'
import { DropLinkResolverService } from 'src/modules/telegram-mini-app/services/drop-link-resolver.service'
import type {
  SaleCredentialLimits,
  SaleDestination,
  SaleDestinationRequest,
  SaleDestinationStrategy
} from 'src/modules/telegram-mini-app/interfaces/sale-destination-strategy.interface'
import { resolveReceiverName } from 'src/shared/utils'

/**
 * How many payers may hold an order against one jar at once.
 *
 * Three, and it has always been three. A jar can safely take several transfers
 * in flight because the scraper settles them against an observed balance: two
 * payers paying at the same moment produce one delta the matcher resolves, and
 * getting it wrong is what `SaleBlockReason.LEDGER_MISMATCH` refuses. A card
 * sale has none of that, which is why its cap is one.
 */
const JAR_MAX_OPEN_ORDERS = 3

/**
 * A sale that pays into the user's own bank jar — the original variant.
 *
 * Every decision here is lifted unchanged out of `SaleFacadeService.createSale`,
 * where it sat inline before there was a second variant to tell it apart from.
 * Nothing about the behaviour moved with it.
 *
 * What makes this variant what it is: **the bank is a witness.** The link
 * resolves to a goal, sometimes to a card and sometimes to an owner, and every
 * one of those is a fact stated by somebody with no stake in the trade. The
 * card variant has no equivalent, and its strategy reads as the same shape with
 * every one of those facts missing.
 */
@Injectable()
export class JarSaleDestinationService implements SaleDestinationStrategy {
  readonly method = SaleMethod.JAR

  private readonly logger = new Logger(JarSaleDestinationService.name)

  constructor(private readonly dropLinkResolver: DropLinkResolverService) {}

  async resolve(request: SaleDestinationRequest): Promise<SaleDestination> {
    const { bankType, cardNumber, seller } = request

    // Refuse a bank that is switched off, before a single call is made.
    //
    // The create form greys these out, but that is a courtesy: the request is
    // trivially assembled by hand, and a Mini App left open from before the
    // change knows nothing about it. Creation only — orders already running on
    // a bank that is later switched off keep being scraped and settled.
    if (!isSaleBankEnabled(bankType)) {
      this.logger.warn(
        `Refused a sale for telegramId ${seller.telegramId}: ${bankType} is not open for new orders`
      )
      throw new BadRequestException(ERROR.SALE.BANK_UNAVAILABLE)
    }

    // Normalise the link before anything is written or sent upstream.
    //
    // The create form already resolves on blur, but this is what makes a short
    // link work regardless of how the request arrived — and it is cheap, since
    // a link that is already usable returns without a network call. The
    // resolved link is then the only one the sale, the terminal and Transacto
    // ever see; storing the short one would produce a terminal that looks
    // healthy and never scrapes.
    const {
      link,
      goal: observedGoal,
      cardNumber: dropCardNumber,
      cardNumberMask: dropCardMask,
      ownerName: dropOwnerName
    } = await this.dropLinkResolver.resolve(bankType, request.dropLink)

    // Settle which card this sale pays into.
    //
    // Where the bank names one, **the bank's answer is the card** and whatever
    // the client sent is discarded. Checking the two for equality and then
    // using the client's would leave the account resting on a comparison; using
    // the bank's leaves it resting on the bank.
    //
    // Truthiness rather than `!== null`: the precondition is "we know the
    // card", and an empty string or a missing field satisfies that no better
    // than an explicit null does.
    const cardVerifiedByBank = Boolean(dropCardNumber)

    if (disclosesCardNumber(bankType) && !cardVerifiedByBank) {
      // Nothing to fall back to. Accepting the typed number would put an
      // unverified account into the system through the one route built to make
      // that impossible.
      this.logger.warn(
        `Refused a sale for telegramId ${seller.telegramId}: ${bankType} named no card for this link`
      )
      throw new BadRequestException(ERROR.SALE.CARD_NOT_DISCLOSED)
    }

    if (cardVerifiedByBank && !isSameCardNumber(dropCardNumber as string, cardNumber)) {
      // The form no longer lets the field be edited for these banks, so a
      // difference here means a stale or tampered client. Worth a line in the
      // log; it changes nothing, because the bank's answer wins either way.
      this.logger.warn(
        `Sale for telegramId ${seller.telegramId}: the client sent a card the drop link does ` +
          `not pay into; using the bank's own answer`
      )
    }

    // A bank that publishes its card *partially* is checked here rather than
    // trusted. The card stays the user's — a mask has four digits missing and
    // cannot be paid into — but one that disagrees with the digits PUMB does
    // show cannot be the right card, and refusing it now costs a form error
    // where discovering it later costs three expired orders and a frozen stake.
    if (masksCardNumber(bankType) && dropCardMask && !matchesMaskedCard(cardNumber, dropCardMask)) {
      this.logger.warn(
        `Refused a sale for telegramId ${seller.telegramId}: the typed card does not fit the ` +
          `mask ${bankType} publishes for this link`
      )
      throw new BadRequestException(ERROR.SALE.CARD_MASK_MISMATCH)
    }

    return {
      receiverName: resolveReceiverName({
        bankOwnerName: dropOwnerName,
        firstName: seller.firstName,
        lastName: seller.lastName,
        username: seller.username,
        telegramId: seller.telegramId
      }),
      // Banks that disclose nothing — Monobank — and banks that disclose only a
      // mask still rely on what the user typed, and their sales keep the
      // dead-order fraud rule that exists precisely because of that. Four
      // unknown digits are ten thousand candidates: a mask narrows the field,
      // it does not close it.
      payoutCardNumber: cardVerifiedByBank ? (dropCardNumber as string) : cardNumber,
      dropLink: link,
      cardVerifiedByBank,
      observedGoal
    }
  }

  /**
   * The turnover caps are the facade's, being identical for both variants; what
   * a jar sale sets of its own is how many payers may be in flight at once.
   *
   * No `minAmountUah`: the pipeline's own floor already applies, and a jar can
   * absorb a payment of any size because the scraper reconciles the total
   * rather than the parts.
   */
  credentialLimits(): SaleCredentialLimits {
    return { maxOpenOrders: JAR_MAX_OPEN_ORDERS }
  }
}
