import { Injectable } from '@nestjs/common'
import type { TmaDemoPack } from '@transacto/contracts'
import type { StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { ReferralService } from 'src/modules/telegram-mini-app/services/referral.service'
import { DepositFacadeService } from 'src/modules/telegram-mini-app/services/deposit-facade.service'
import { FiatDepositFacadeService } from 'src/modules/telegram-mini-app/services/fiat-deposit-facade.service'
import { buildDemoPack } from 'src/modules/telegram-mini-app/utils'
import { transactoOrderFloorKopecks } from 'src/shared/utils'

/**
 * Gathers what a demo account's story has to be true to, and draws it.
 *
 * The story itself is {@link buildDemoPack}, a pure function; this is the part
 * that reads the world — today's two rates, the account's real code and link,
 * the real wallet and windows — so the generated screens quote the product as
 * it is right now and the link on them recruits for the promoter.
 */
@Injectable()
export class DemoPackService {
  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly referralService: ReferralService,
    private readonly depositFacade: DepositFacadeService,
    private readonly fiatDepositFacade: FiatDepositFacadeService
  ) {}

  /** Throws when the rate cannot be read — a pack priced at nothing is not one. */
  async build(user: StoredTmaUser): Promise<TmaDemoPack> {
    // The only rate read, and one for both rates: every figure in the pack is
    // priced from it, so the spread it shows is the one the dashboard
    // advertises beside it — and a cold cache costs the panel one scrape.
    const [spread, referral] = await Promise.all([
      this.exchangeRateService.getSpread(),
      this.referralService.sharingTerms(user)
    ])

    return buildDemoPack({
      telegramId: user.telegramId,
      identity: {
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        showNameToReferrer: user.showNameToReferrer
      },
      now: Date.now(),
      buyRate: spread.buy,
      sellRate: spread.sell,
      referral,
      walletAddress: this.depositFacade.getWalletAddress(),
      depositExpiryMinutes: this.depositFacade.expiryMinutes,
      payWindowMinutes: this.fiatDepositFacade.payWindowMinutes,
      minOrderKopecks: transactoOrderFloorKopecks()
    })
  }
}
