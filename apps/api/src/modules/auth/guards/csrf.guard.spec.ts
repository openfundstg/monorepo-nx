import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SkipCsrf } from 'src/modules/auth/decorators/skip-csrf.decorator'
import { CsrfGuard, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from 'src/modules/auth/guards/csrf.guard'

class TestController {
  guarded() {
    /* metadata-only */
  }

  @SkipCsrf()
  exempt() {
    /* metadata-only */
  }
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector())

  const contextFor = (
    handler: keyof TestController,
    request: { method: string; headers: Record<string, string> }
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => TestController.prototype[handler],
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request })
    }) as unknown as ExecutionContext

  it('allows safe methods', () => {
    expect(guard.canActivate(contextFor('guarded', { method: 'GET', headers: {} }))).toBe(true)
  })

  it('allows requests that carry no CSRF cookie', () => {
    // Today's callers authenticate with an explicit header, so the browser never
    // attaches credentials on its own and there is nothing to forge.
    expect(
      guard.canActivate(
        contextFor('guarded', { method: 'POST', headers: { cookie: 'theme=dark' } })
      )
    ).toBe(true)
  })

  it('rejects a state-changing request whose header does not echo the cookie', () => {
    expect(() =>
      guard.canActivate(
        contextFor('guarded', {
          method: 'POST',
          headers: {
            cookie: `theme=dark; ${CSRF_COOKIE_NAME}=abc123`,
            [CSRF_HEADER_NAME]: 'wrong'
          }
        })
      )
    ).toThrow(ForbiddenException)
  })

  it('rejects when the cookie is present but the header is missing', () => {
    expect(() =>
      guard.canActivate(
        contextFor('guarded', { method: 'POST', headers: { cookie: `${CSRF_COOKIE_NAME}=abc123` } })
      )
    ).toThrow(ForbiddenException)
  })

  it('allows a matching double-submit pair', () => {
    expect(
      guard.canActivate(
        contextFor('guarded', {
          method: 'POST',
          headers: {
            cookie: `${CSRF_COOKIE_NAME}=abc123; other=x`,
            [CSRF_HEADER_NAME]: 'abc123'
          }
        })
      )
    ).toBe(true)
  })

  it('lets @SkipCsrf() routes through even with a mismatched pair', () => {
    expect(
      guard.canActivate(
        contextFor('exempt', {
          method: 'POST',
          headers: { cookie: `${CSRF_COOKIE_NAME}=abc123`, [CSRF_HEADER_NAME]: 'wrong' }
        })
      )
    ).toBe(true)
  })
})
