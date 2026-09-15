import { ERROR } from '@transacto/contracts'
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHmac } from 'crypto'
import type { Request } from 'express'
import environments from 'src/environments'
import type { TmaAuthenticatedRequest, TmaAuthUser } from 'src/shared/interfaces'
import type { UserTypeAuthenticator } from 'src/modules/auth/interfaces/user-type-authenticator.interface'

/**
 * `UserType.TMA` — verifies a Telegram `initData` payload per Telegram's
 * WebApp spec and attaches the Telegram user to the request.
 *
 * Lifted verbatim from the former `TelegramAuthGuard`.
 */
@Injectable()
export class TmaAuthService implements UserTypeAuthenticator {
  private readonly logger = new Logger(TmaAuthService.name)

  /**
   * Max acceptable age of `auth_date` — 24 hours.
   *
   * **`initData` cannot be renewed.** Telegram mints it once, into the launch
   * URL's fragment, and there is no API to ask for a fresh one; even a
   * `location.reload()` re-reads the same fragment and the same `auth_date`.
   * So this window is not "how long a session lasts" — it is how long a Mini
   * App may stay open before every request it makes starts failing and the
   * user has to close and reopen it.
   *
   * It was one hour, and that is what it cost: a Mini App left open over lunch
   * came back to a screen where nothing loaded. What the window actually buys
   * is a bound on replaying an `initData` that has already leaked — and a
   * credential that travels in a URL fragment and on every request header is
   * one that an attacker holding it can spend inside the hour anyway. A day is
   * the usual figure for this check and does not change that arithmetic.
   *
   * The real answer is to exchange `initData` for a session token of our own,
   * with a TTL we control and can renew. Until then this is the trade, and it
   * is why the client must recognise `ERROR.TMA_AUTH.EXPIRED` and say so
   * rather than showing an empty screen.
   */
  private readonly MAX_AUTH_AGE_SECONDS = 86_400

  async authenticate(request: Request): Promise<void> {
    const initData = request.headers['x-tma-init-data'] as string

    if (!initData) throw new UnauthorizedException(ERROR.TMA_AUTH.MISSING_INIT_DATA_HEADER)

    try {
      const params = new URLSearchParams(initData)
      const hash = params.get('hash')

      if (!hash) throw new UnauthorizedException(ERROR.TMA_AUTH.MISSING_HASH)

      // Remove hash from params for data check string
      params.delete('hash')

      // Sort params alphabetically and build data_check_string
      const sortedEntries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
      const dataCheckString = sortedEntries.map(([key, value]) => `${key}=${value}`).join('\n')

      // secret_key = HMAC-SHA256(key="WebAppData", data=BOT_TOKEN)
      const botToken = environments.TELEGRAM_BOT_TOKEN
      if (!botToken) {
        this.logger.error('TELEGRAM_BOT_TOKEN is not configured')
        throw new UnauthorizedException(ERROR.TMA_AUTH.SERVER_MISCONFIGURED)
      }

      const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()

      // computed_hash = HMAC-SHA256(key=secret_key, data=data_check_string)
      const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

      if (computedHash !== hash) {
        this.logger.warn('Invalid initData hash')
        throw new UnauthorizedException(ERROR.TMA_AUTH.INVALID_SIGNATURE)
      }

      // Verify auth_date freshness
      const authDate = params.get('auth_date')
      if (authDate) {
        const authTimestamp = Number(authDate)
        const now = Math.floor(Date.now() / 1000)
        if (now - authTimestamp > this.MAX_AUTH_AGE_SECONDS)
          throw new UnauthorizedException(ERROR.TMA_AUTH.EXPIRED)
      }

      // Parse user JSON and attach to request
      const userJson = params.get('user')
      if (!userJson) throw new UnauthorizedException(ERROR.TMA_AUTH.MISSING_USER)

      const user: TmaAuthUser = JSON.parse(userJson)
      if (!user.id) throw new UnauthorizedException(ERROR.TMA_AUTH.INVALID_USER_DATA)

      const authenticated = request as TmaAuthenticatedRequest
      authenticated.tmaUser = user
      // Signed alongside everything else above, so downstream code may treat it
      // as Telegram's word rather than the client's.
      authenticated.tmaStartParam = params.get('start_param') ?? undefined
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      this.logger.error(
        `initData validation failed: ${error instanceof Error ? error.message : String(error)}`
      )
      throw new UnauthorizedException(ERROR.TMA_AUTH.INVALID_INIT_DATA)
    }
  }
}
