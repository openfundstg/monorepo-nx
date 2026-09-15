import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserType } from 'src/shared/constants'
import { Public } from 'src/modules/auth/decorators/public.decorator'
import {
  UserTypes,
  UserTypeTMA,
  UserTypeTrader
} from 'src/modules/auth/decorators/user-types.decorator'
import { UserTypesGuard } from 'src/modules/auth/guards/user-types.guard'
import type { TmaAuthService } from 'src/modules/auth/services/tma-auth.service'
import type { TraderAuthService } from 'src/modules/auth/services/trader-auth.service'

/**
 * Routes are declared with the real decorators so the test covers the whole
 * chain — decorator, metadata key, reflector lookup — not just the guard body.
 */
class TestController {
  @Public()
  openRoute() {
    /* handler bodies are irrelevant; only their metadata is read */
  }

  @UserTypeTrader()
  traderRoute() {
    /* metadata-only */
  }

  @UserTypeTMA()
  tmaRoute() {
    /* metadata-only */
  }

  @UserTypes(UserType.TRADER, UserType.TMA)
  eitherRoute() {
    /* metadata-only */
  }

  undecoratedRoute() {
    /* deliberately carries no access decorator */
  }
}

@Public()
class OpenController {
  inheritsPublic() {
    /* metadata-only */
  }
}

describe('UserTypesGuard', () => {
  const request = { headers: {}, params: {} }

  let traderAuth: jest.Mocked<Pick<TraderAuthService, 'authenticate'>>
  let tmaAuth: jest.Mocked<Pick<TmaAuthService, 'authenticate'>>
  let guard: UserTypesGuard

  const contextFor = (
    handler: keyof TestController,
    cls: object = TestController
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => TestController.prototype[handler],
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => request })
    }) as unknown as ExecutionContext

  beforeEach(() => {
    traderAuth = { authenticate: jest.fn().mockResolvedValue(undefined) }
    tmaAuth = { authenticate: jest.fn().mockResolvedValue(undefined) }
    guard = new UserTypesGuard(
      new Reflector(),
      traderAuth as unknown as TraderAuthService,
      tmaAuth as unknown as TmaAuthService
    )
  })

  it('lets @Public() routes through without touching any authenticator', async () => {
    await expect(guard.canActivate(contextFor('openRoute'))).resolves.toBe(true)
    expect(traderAuth.authenticate).not.toHaveBeenCalled()
    expect(tmaAuth.authenticate).not.toHaveBeenCalled()
  })

  it('honours a controller-level decorator when the handler has none', async () => {
    const context = {
      getType: () => 'http',
      getHandler: () => OpenController.prototype.inheritsPublic,
      getClass: () => OpenController,
      switchToHttp: () => ({ getRequest: () => request })
    } as unknown as ExecutionContext

    await expect(guard.canActivate(context)).resolves.toBe(true)
  })

  it('fails closed on a route with no access decorator', async () => {
    // The whole point of the global guard: a forgotten decorator must not
    // silently publish an endpoint.
    await expect(guard.canActivate(contextFor('undecoratedRoute'))).rejects.toBeInstanceOf(
      InternalServerErrorException
    )
    expect(traderAuth.authenticate).not.toHaveBeenCalled()
  })

  it('routes @UserTypeTrader() to the trader authenticator only', async () => {
    await expect(guard.canActivate(contextFor('traderRoute'))).resolves.toBe(true)
    expect(traderAuth.authenticate).toHaveBeenCalledWith(request)
    expect(tmaAuth.authenticate).not.toHaveBeenCalled()
  })

  it('routes @UserTypeTMA() to the TMA authenticator only', async () => {
    await expect(guard.canActivate(contextFor('tmaRoute'))).resolves.toBe(true)
    expect(tmaAuth.authenticate).toHaveBeenCalledWith(request)
    expect(traderAuth.authenticate).not.toHaveBeenCalled()
  })

  it('stops at the first type that authenticates', async () => {
    await expect(guard.canActivate(contextFor('eitherRoute'))).resolves.toBe(true)
    expect(traderAuth.authenticate).toHaveBeenCalled()
    expect(tmaAuth.authenticate).not.toHaveBeenCalled()
  })

  it('falls through to the next type when the first one rejects', async () => {
    traderAuth.authenticate.mockRejectedValue(new UnauthorizedException('no token'))

    await expect(guard.canActivate(contextFor('eitherRoute'))).resolves.toBe(true)
    expect(tmaAuth.authenticate).toHaveBeenCalledWith(request)
  })

  it('rethrows the first failure when every type rejects', async () => {
    const first = new UnauthorizedException('trader said no')
    traderAuth.authenticate.mockRejectedValue(first)
    tmaAuth.authenticate.mockRejectedValue(new UnauthorizedException('tma said no'))

    await expect(guard.canActivate(contextFor('eitherRoute'))).rejects.toBe(first)
  })

  it('ignores non-HTTP contexts so WebSocket messages still reach the gateways', async () => {
    const wsContext = {
      getType: () => 'ws',
      getHandler: () => TestController.prototype.undecoratedRoute,
      getClass: () => TestController
    } as unknown as ExecutionContext

    await expect(guard.canActivate(wsContext)).resolves.toBe(true)
  })
})
