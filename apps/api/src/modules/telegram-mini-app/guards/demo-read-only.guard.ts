import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ERROR } from '@transacto/contracts'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { DEMO_ALLOWED_METADATA } from 'src/modules/telegram-mini-app/decorators/demo-allowed.decorator'
import { DemoAccountService } from 'src/modules/telegram-mini-app/services/demo-account.service'

/** Methods that only read. Everything else is a write, including methods nobody uses yet. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Refuses every write a demo account sends, unless the handler says otherwise.
 *
 * **This is the boundary, and the Mini App is not.** The app answers a demo
 * account's screens itself and never sends most of these — but a request it
 * did not know to intercept, a pack that failed to arrive, or a bundle from
 * before the demo existed would all reach here, from a screen showing a
 * balance that does not exist. Behind a hryvnia top-up is a real payout taken
 * in the promoter's name; behind a referral code, a binding that cannot be
 * undone.
 *
 * Global, after `UserTypesGuard`, because it needs to know who is asking: a
 * request that did not authenticate as a Mini App user carries no `tmaUser`
 * and is none of this guard's business. It costs one indexed read, and only
 * on a Mini App write.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly demoAccounts: DemoAccountService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const request = context.switchToHttp().getRequest<Partial<TmaAuthenticatedRequest>>()
    if (!request.tmaUser || READ_METHODS.has(request.method ?? '')) return true

    const allowed = this.reflector.getAllAndOverride<boolean>(DEMO_ALLOWED_METADATA, [
      context.getHandler(),
      context.getClass()
    ])
    if (allowed) return true

    if (await this.demoAccounts.isDemo(request.tmaUser.id))
      throw new ForbiddenException(ERROR.TMA_DEMO.READ_ONLY)

    return true
  }
}
