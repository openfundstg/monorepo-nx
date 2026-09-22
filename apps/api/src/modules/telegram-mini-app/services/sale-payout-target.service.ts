import { Injectable, Logger } from '@nestjs/common'
import { SaleMethod } from '@transacto/contracts'
import { TmaServiceTraderService } from 'src/modules/telegram-mini-app/services/tma-service-trader.service'
import { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'
import { describeError } from 'src/shared/utils'

/** Everything this needs off a sale to say where its money goes. */
export interface PayoutTargetSale {
  readonly publicId: string
  readonly saleMethod?: SaleMethod | null
  readonly cardId?: number | null
  readonly dropLink?: string | null
}

/**
 * Where a sale's hryvnia is supposed to arrive, in a form somebody can pay to.
 *
 * **The only thing in this product that reaches for a whole card number**, and
 * it exists so that "reaching for one" is a single file the next reader can
 * find. Nothing else needs it: a sale keeps `payoutCardTail`, four digits, and
 * has done since the variant was built.
 *
 * It is here for exactly one caller — the alert that asks an operator to
 * transfer a tail no payer can be routed for. They cannot make that transfer
 * from four digits, and sending them to the panel to look it up is a step
 * between a person and somebody else's money at two in the morning. The cost of
 * that convenience is real and is written down in the root `CLAUDE.md`; what is
 * written here is the containment.
 *
 * **What comes out of this is a credential.** It goes onto one in-process
 * event, into one Telegram message, and nowhere else. It is never stored, never
 * returned to a client, and never logged — including by the failure paths
 * below, which name the sale and not the destination.
 */
@Injectable()
export class SalePayoutTargetService {
  private readonly logger = new Logger(SalePayoutTargetService.name)

  constructor(
    private readonly transactoApiService: TransactoApiService,
    private readonly serviceTrader: TmaServiceTraderService
  ) {}

  /**
   * The jar's public link, the seller's card in full, or `null`.
   *
   * `null` is an answer and not a failure: the caller says so rather than
   * pretending, and whoever reads the message falls back to the panel. Nothing
   * here throws — an alert that cannot name a destination is still worth
   * sending, because the sum and the sale are what make it actionable.
   */
  async resolve(sale: PayoutTargetSale): Promise<string | null> {
    // A jar sale's destination is on the document already. The link is public —
    // it is what payers are sent to — so this half costs nothing and risks
    // nothing.
    if ((sale.saleMethod ?? SaleMethod.JAR) !== SaleMethod.CARD)
      return sale.dropLink?.trim() || null

    return this.cardOf(sale)
  }

  /**
   * The card a card sale pays into, read back from Transacto.
   *
   * **Read rather than recalled, because it was never written down.** The
   * number goes upstream as the credential's `cred` at creation and is not kept
   * anywhere on this side, which is the arrangement this method is careful not
   * to undo: it fetches, hands over, and keeps nothing.
   *
   * `credentials_list` is unpaginated and grows with every retired Mini App
   * credential — see `apps/api/REFACTORING.md` — so this is a heavy call for
   * one field. It is made once per sale, on a sale reaching its tail, which is
   * rare enough that the cost is worth less than a second endpoint would be.
   */
  private async cardOf(sale: PayoutTargetSale): Promise<string | null> {
    const cardId = sale.cardId
    if (typeof cardId !== 'number') return null

    try {
      const { apiToken } = await this.serviceTrader.resolve()
      const credentials = await this.transactoApiService.getTerminalsList(apiToken)
      const card = credentials.find((credential) => credential.card_id === cardId)?.cred

      if (!card) {
        this.logger.warn(
          `Sale ${sale.publicId}: Transacto lists no card for credential ${cardId}, so the ` +
            `tail alert cannot name where to transfer`
        )

        return null
      }

      return card
    } catch (error: unknown) {
      // The sale, never the destination — there is none to print on this branch
      // and there must be none on any other.
      this.logger.error(
        `Sale ${sale.publicId}: could not read its payout card from Transacto: ` +
          describeError(error)
      )

      return null
    }
  }
}
