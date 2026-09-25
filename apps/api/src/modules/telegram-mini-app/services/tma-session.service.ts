import { Injectable, Logger } from '@nestjs/common'
import type { AuthResponse } from '@transacto/contracts'
import { TmaUserDbService, type StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'
import { ReferralService } from 'src/modules/telegram-mini-app/services/referral.service'
import { DemoPackService } from 'src/modules/telegram-mini-app/services/demo-pack.service'
import { isDemoAccount, toTmaUser } from 'src/modules/telegram-mini-app/utils'
import type { TmaAuthUser } from 'src/shared/interfaces'
import { getTrustLevel } from 'src/shared/constants'

/**
 * Opening the Mini App: who this is, and what their screens are drawn from.
 *
 * For almost everybody that is their own account. For a demo account it is a
 * generated history, handed over once here so the app can answer its own
 * screens without going back over the network for each — see `TmaDemoPack`.
 */
@Injectable()
export class TmaSessionService {
  private readonly logger = new Logger(TmaSessionService.name)

  constructor(
    private readonly userDbService: TmaUserDbService,
    private readonly referralService: ReferralService,
    private readonly demoPackService: DemoPackService
  ) {}

  /** Upserts the Telegram user and returns their profile and trust level. */
  async open(tgUser: TmaAuthUser, startParam: string | undefined): Promise<AuthResponse> {
    const { user, isNewUser } = await this.userDbService.findOrCreate(tgUser.id, {
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      username: tgUser.username
    })

    // Attribution happens here and only for a first-time user: the deep link is
    // how somebody arrives, so binding on any later open would let an
    // established account be moved under a referrer after its volume is known.
    // `bindFromStartParam` swallows its own failures — a stale or bogus code
    // must not stop a login.
    if (isNewUser && startParam)
      await this.referralService.bindFromStartParam(tgUser.id, startParam)

    return isDemoAccount(user) ? this.openDemo(user, isNewUser) : ownSession(user, isNewUser)
  }

  /**
   * A demo account's session: the generated profile, and the pack behind it.
   *
   * **A pack that cannot be built is not a failed login.** It fails only when
   * the rate cannot be read, and then the account opens as itself — its real,
   * empty figures — rather than not at all. The server still refuses its
   * writes, so nothing is lost but the story; the log says which account.
   */
  private async openDemo(user: StoredTmaUser, isNewUser: boolean): Promise<AuthResponse> {
    try {
      const demo = await this.demoPackService.build(user)

      return {
        user: demo.profile.user,
        trustLevel: {
          level: demo.profile.trustLevel,
          maxParallelOrders: demo.profile.maxParallelOrders
        },
        isNewUser,
        demo
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Demo account ${user.telegramId} opened without its pack: ${
          error instanceof Error ? error.message : String(error)
        }`
      )

      return ownSession(user, isNewUser)
    }
  }
}

/** A session drawn from the account's own figures — everybody's, and a demo's without a pack. */
const ownSession = (user: StoredTmaUser, isNewUser: boolean): AuthResponse => ({
  user: toTmaUser(user),
  trustLevel: getTrustLevel(user.totalTurnover),
  isNewUser
})
