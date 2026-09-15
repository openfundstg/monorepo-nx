import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http'
import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { ERROR } from '@transacto/contracts'
import { firstValueFrom, of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TmaService } from '../services/tma.service'
import { SessionExpiryService } from '../services/session-expiry.service'
import { tmaAuthInterceptor } from './tma-auth.interceptor'

/**
 * The interceptor owns `initData` as a credential, so it is also what has to
 * hear the server say the credential is dead.
 *
 * Before it did, nobody heard: a Mini App open past the window kept polling
 * every twenty seconds, every screen showed its own generic empty state, and
 * the one instruction that would have helped — close this and open it again —
 * appeared nowhere. `initData` cannot be renewed while the WebView lives, so
 * that state is terminal and has to be recognised rather than retried.
 */
describe('tmaAuthInterceptor', () => {
  const request = new HttpRequest('GET', '/api/tma/fiat-deposits/options')

  let session: SessionExpiryService
  let injector: Injector

  const run = (next: (req: HttpRequest<unknown>) => ReturnType<typeof of>) =>
    runInInjectionContext(injector, () => tmaAuthInterceptor(request, next as never))

  const expired = () =>
    new HttpErrorResponse({ status: 401, error: ERROR.TMA_AUTH.EXPIRED })

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TmaService, useValue: { initData: () => 'auth_date=1&hash=abc' } },
      ],
    })

    injector = TestBed.inject(Injector)
    session = TestBed.inject(SessionExpiryService)
  })

  it('sends the launch credential on every request', async () => {
    const next = vi.fn().mockReturnValue(of(new HttpResponse()))

    await firstValueFrom(run(next))

    expect(next.mock.calls[0][0].headers.get('x-tma-init-data')).toBe('auth_date=1&hash=abc')
  })

  it('records that the launch has aged out', async () => {
    const next = vi.fn().mockReturnValue(throwError(() => expired()))

    await expect(firstValueFrom(run(next))).rejects.toBeInstanceOf(HttpErrorResponse)

    expect(session.expired()).toBe(true)
  })

  /**
   * The other `401`s mean something is wrong with *this client* — a missing
   * header, a hash that does not verify. Telling that user to reopen the app
   * would be advice that cannot help them.
   */
  it('leaves every other 401 alone', async () => {
    const next = vi
      .fn()
      .mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 401, error: ERROR.TMA_AUTH.INVALID_SIGNATURE }))
      )

    await expect(firstValueFrom(run(next))).rejects.toBeInstanceOf(HttpErrorResponse)

    expect(session.expired()).toBe(false)
  })

  /**
   * The whole point of the latch. A screen that polls would otherwise spend one
   * round trip every twenty seconds, for as long as the app stays open, asking
   * a question whose answer cannot change without a new launch — which is
   * exactly what the production logs showed.
   */
  it('stops sending anything once the credential is known dead', async () => {
    session.markExpired()
    const next = vi.fn().mockReturnValue(of(new HttpResponse()))

    await expect(firstValueFrom(run(next))).rejects.toMatchObject({ status: 401 })

    expect(next).not.toHaveBeenCalled()
  })

  it('refuses with the server\'s own error, so callers see what they always saw', async () => {
    session.markExpired()

    await expect(firstValueFrom(run(vi.fn()))).rejects.toMatchObject({
      error: { code: ERROR.TMA_AUTH.EXPIRED.code },
    })
  })
})
