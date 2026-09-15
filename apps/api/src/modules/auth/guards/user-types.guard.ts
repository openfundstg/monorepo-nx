import { ERROR } from '@transacto/contracts'
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { UserType } from 'src/shared/constants'
import { AUTH_METADATA } from 'src/modules/auth/constants/auth-metadata.constants'
import type { UserTypeAuthenticator } from 'src/modules/auth/interfaces/user-type-authenticator.interface'
import { TraderAuthService } from 'src/modules/auth/services/trader-auth.service'
import { TmaAuthService } from 'src/modules/auth/services/tma-auth.service'
import { AdminAuthService } from 'src/modules/auth/services/admin-auth.service'

/**
 * The single entry point for endpoint authentication, registered as an
 * `APP_GUARD` so it runs on every HTTP route.
 *
 * Access is **denied by default**: a handler with no access decorator is a
 * server-side mistake, not an open endpoint. That is the whole point of moving
 * off per-module `@UseGuards` — forgetting a decorator now fails loudly instead
 * of silently publishing the route.
 */
@Injectable()
export class UserTypesGuard implements CanActivate {
  private readonly logger = new Logger(UserTypesGuard.name)
  private readonly authenticators: Readonly<Record<UserType, UserTypeAuthenticator>>

  constructor(
    private readonly reflector: Reflector,
    traderAuthService: TraderAuthService,
    tmaAuthService: TmaAuthService,
    adminAuthService: AdminAuthService
  ) {
    this.authenticators = {
      [UserType.TRADER]: traderAuthService,
      [UserType.TMA]: tmaAuthService,
      [UserType.ADMIN]: adminAuthService
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // HTTP only. WebSocket clients authenticate once at handshake time inside
    // the gateways (ExtensionWsAuthService / TmaGateway); a global guard would
    // find no express request on a `ws` context and reject every message.
    if (context.getType() !== 'http') return true

    if (this.readFlag(context, AUTH_METADATA.PUBLIC)) return true

    const types = this.reflector.getAllAndOverride<UserType[]>(AUTH_METADATA.USER_TYPES, [
      context.getHandler(),
      context.getClass()
    ])

    if (!types?.length) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} has no access decorator — ` +
          'add @UserTypeTrader(), @UserTypeTMA(), @UserTypes(...) or @Public()'
      )
      throw new InternalServerErrorException(ERROR.CONFIG.MISSING_ACCESS_DECORATOR)
    }

    const request = context.switchToHttp().getRequest<Request>()

    // Several types means "any of these may call me". Try each in order and let
    // the first success through; if none match, surface the first failure so the
    // caller gets the specific ERROR code for the scheme it most likely intended.
    const failures: unknown[] = []
    for (const type of types) {
      try {
        await this.authenticators[type].authenticate(request)
        return true
      } catch (error) {
        failures.push(error)
      }
    }

    throw failures[0]
  }

  private readFlag(context: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]) ??
      false
    )
  }
}
