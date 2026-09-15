import { ERROR } from '@transacto/contracts'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { TraderDbService } from 'src/modules/repositories/trader-db/services'
import { ensure } from 'src/shared/utils'
import type { AuthenticatedRequest } from 'src/shared/interfaces'
import type { UserTypeAuthenticator } from 'src/modules/auth/interfaces/user-type-authenticator.interface'

/**
 * `UserType.TRADER` — authenticates the browser extension by its per-trader
 * API token and attaches the trader document to the request.
 *
 * Lifted verbatim from the former `ExtensionAuthGuard`, including the
 * `:traderId` ownership check: a valid token for trader A must not be able to
 * read trader B's data by changing the URL.
 */
@Injectable()
export class TraderAuthService implements UserTypeAuthenticator {
  constructor(private readonly traderDbService: TraderDbService) {}

  async authenticate(request: Request): Promise<void> {
    const token = ensure(
      request.headers['x-api-token'] as string,
      new UnauthorizedException(ERROR.AUTH.MISSING_API_TOKEN_HEADER)
    )

    const trader = await this.traderDbService.findByApiToken(token)
    if (!trader || !trader.isActive) throw new UnauthorizedException(ERROR.AUTH.INVALID_API_TOKEN)

    ;(request as AuthenticatedRequest).trader = trader

    // A route param must never widen access beyond the authenticated trader
    const requestedTraderId = request.params.traderId
    if (requestedTraderId && parseInt(String(requestedTraderId), 10) !== trader.traderId)
      throw new UnauthorizedException(ERROR.AUTH.TRADER_ACCESS_DENIED)
  }
}
