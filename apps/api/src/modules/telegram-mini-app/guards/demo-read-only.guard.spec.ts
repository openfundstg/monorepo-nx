import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ERROR } from '@transacto/contracts'
import { DemoAllowed } from 'src/modules/telegram-mini-app/decorators/demo-allowed.decorator'
import { DemoReadOnlyGuard } from 'src/modules/telegram-mini-app/guards/demo-read-only.guard'
import type { DemoAccountService } from 'src/modules/telegram-mini-app/services/demo-account.service'

/** Routes declared with the real decorator, so the metadata lookup is covered too. */
class TestController {
  write() {
    /* metadata-only */
  }

  @DemoAllowed()
  allowedWrite() {
    /* metadata-only */
  }
}

const DEMO_ID = 111
const REAL_ID = 222

describe('DemoReadOnlyGuard', () => {
  let isDemo: jest.Mock
  let guard: DemoReadOnlyGuard

  const contextFor = (
    handler: keyof TestController,
    request: { method: string; tmaUser?: { id: number } }
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => TestController.prototype[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request })
    }) as unknown as ExecutionContext

  beforeEach(() => {
    isDemo = jest.fn(async (telegramId: number) => telegramId === DEMO_ID)
    guard = new DemoReadOnlyGuard(new Reflector(), { isDemo } as unknown as DemoAccountService)
  })

  it('refuses a demo account’s write, with the code the clients translate', async () => {
    const attempt = guard.canActivate(
      contextFor('write', { method: 'POST', tmaUser: { id: DEMO_ID } })
    )

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException)
    await expect(attempt).rejects.toMatchObject({ response: ERROR.TMA_DEMO.READ_ONLY })
  })

  it.each(['PUT', 'PATCH', 'DELETE', 'SOMETHING_NEW'])(
    'treats %s as a write too — a method nobody listed is refused, not waved through',
    async (method) => {
      await expect(
        guard.canActivate(contextFor('write', { method, tmaUser: { id: DEMO_ID } }))
      ).rejects.toBeInstanceOf(ForbiddenException)
    }
  )

  it('lets a demo account read', async () => {
    await expect(
      guard.canActivate(contextFor('write', { method: 'GET', tmaUser: { id: DEMO_ID } }))
    ).resolves.toBe(true)
    expect(isDemo).not.toHaveBeenCalled()
  })

  it('lets a demo account through a handler marked as safe for it', async () => {
    await expect(
      guard.canActivate(contextFor('allowedWrite', { method: 'POST', tmaUser: { id: DEMO_ID } }))
    ).resolves.toBe(true)
  })

  it('lets an ordinary account write', async () => {
    await expect(
      guard.canActivate(contextFor('write', { method: 'POST', tmaUser: { id: REAL_ID } }))
    ).resolves.toBe(true)
  })

  it('leaves alone a request that did not come from the Mini App', async () => {
    await expect(guard.canActivate(contextFor('write', { method: 'POST' }))).resolves.toBe(true)
    expect(isDemo).not.toHaveBeenCalled()
  })
})
