import { Injectable } from '@nestjs/common'
import { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'
import { NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH } from 'src/shared/constants'

/**
 * The one question "how much may this account top up with" has an answer to.
 *
 * Its own service because two callers now need it and they are on opposite
 * sides of the product: the offer filters the amounts it shows, and a standing
 * request for an amount is refused outright when the whole range sits above the
 * cap. A second copy of the rule would be a second answer to "has this person
 * ever moved their own money through here", and the one that drifted would
 * either offer a new account sums it cannot take or promise to call somebody
 * about a sum they could never use.
 */
@Injectable()
export class FiatDepositCeilingService {
  constructor(
    // Crypto deposits, read for one yes/no question: has this account ever had
    // money credited? That, and not turnover, is what lifts the ceiling.
    private readonly depositDb: TmaDepositDbService,
    private readonly fiatDepositDb: TmaFiatDepositDbService
  ) {}

  /**
   * The largest top-up this user may make, or `null` when nothing caps them.
   *
   * One settled deposit — a crypto one or a hryvnia one, they are the same
   * evidence — lifts the ceiling for good. It used to be turnover that lifted
   * it, which asked a much harder question than the one the ceiling is for: an
   * account that has already moved its own money through the product once is
   * not the account the cap protects against, whether it has traded ₴100 000
   * since or nothing at all.
   *
   * Asked on every read rather than stored, so the ceiling lifts the moment the
   * first deposit is credited. Both reads are `exists` on an indexed
   * `telegramId`, and they run together.
   */
  async forUser(telegramId: number): Promise<number | null> {
    const [hasCrypto, hasFiat] = await Promise.all([
      this.depositDb.hasCredited(telegramId),
      this.fiatDepositDb.hasCompleted(telegramId)
    ])

    return hasCrypto || hasFiat ? null : NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH
  }

  /** `null` is no ceiling, which is why this is not a bare comparison. */
  isWithin(amountUah: number, maxAmountUah: number | null): boolean {
    return maxAmountUah === null || amountUah <= maxAmountUah
  }
}
