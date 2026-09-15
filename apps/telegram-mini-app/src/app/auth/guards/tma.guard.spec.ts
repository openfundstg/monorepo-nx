import { TestBed } from '@angular/core/testing'
import { provideZonelessChangeDetection, runInInjectionContext, Injector } from '@angular/core'
import { Router, type UrlTree } from '@angular/router'
import { provideRouter } from '@angular/router'
import { Store, provideStore } from '@ngrx/store'
import { describe, expect, it, vi } from 'vitest'
import type { AuthResponse } from '@transacto/contracts'
import { authActions } from '../store/auth.actions'
import { authReducer } from '../store/auth.reducer'
import { AUTH_FEATURE } from '../store/auth.state'
import { UNAVAILABLE_PATH, anonymousGuard, tmaGuard } from './tma.guard'
import { routes } from '../../app.routes'

/**
 * The guards, and the route table they are attached to.
 *
 * The real reducer rather than a mocked store: what is being tested is that the
 * guard waits for a verdict and then reads the right one, and a store whose
 * state the test sets directly would answer that question by assumption.
 *
 * The last assertion is the one that matters most: it walks the real routes and
 * fails if any screen is reachable without the guard. That is the failure that
 * was reported — not a broken guard, but no guard at all — and it is the kind
 * that comes back the moment somebody adds a route.
 */
describe('tmaGuard', () => {
  /** Only `isNewUser` is read anywhere near this code path. */
  const session = { isNewUser: false } as AuthResponse

  const setup = () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideStore({ [AUTH_FEATURE]: authReducer })
      ]
    })

    return TestBed.inject(Store)
  }

  const run = (guard: typeof tmaGuard) =>
    runInInjectionContext(TestBed.inject(Injector), () =>
      // The guard takes a route and a state; neither is read, so the casts keep
      // the call honest without inventing fixtures for them.
      guard(null as never, null as never)
    ) as Promise<boolean | UrlTree>

  it('lets a verified launch through', async () => {
    const store = setup()
    store.dispatch(authActions.authenticateSuccess({ session }))

    expect(await run(tmaGuard)).toBe(true)
  })

  it('sends everybody else to the gate', async () => {
    const store = setup()
    store.dispatch(authActions.authenticateAnonymous())

    const result = await run(tmaGuard)

    expect(result).not.toBe(true)
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(`/${UNAVAILABLE_PATH}`)
  })

  /**
   * The guard awaits the verdict rather than reading a flag. Until `/auth`
   * answers, "not authenticated" and "not asked yet" are the same value, and
   * reading eagerly would bounce every real launch to the gate and back.
   */
  it('waits for the verdict instead of assuming one', async () => {
    const store = setup()

    const pending = run(tmaGuard)
    store.dispatch(authActions.authenticateSuccess({ session }))

    expect(await pending).toBe(true)
  })

  /**
   * Nobody else asks for the verdict — there is no app initializer dispatching
   * it, because effects are not subscribed that early. If the guard stops
   * asking, every launch waits forever on an answer nothing requested.
   */
  it('asks for a verdict when none has been sought', async () => {
    const store = setup()
    const dispatch = vi.spyOn(store, 'dispatch')

    const pending = run(tmaGuard)
    store.dispatch(authActions.authenticateAnonymous())
    await pending

    expect(dispatch).toHaveBeenCalledWith(authActions.authenticate())
  })

  /** A verdict already in hand costs no second `/auth`. */
  it('does not ask again once the verdict is in', async () => {
    const store = setup()
    store.dispatch(authActions.authenticateSuccess({ session }))

    const dispatch = vi.spyOn(store, 'dispatch')
    await run(tmaGuard)

    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('anonymousGuard', () => {
  const setup = () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideStore({ [AUTH_FEATURE]: authReducer })
      ]
    })

    return TestBed.inject(Store)
  }

  const run = () =>
    runInInjectionContext(TestBed.inject(Injector), () =>
      anonymousGuard(null as never, null as never)
    ) as Promise<boolean | UrlTree>

  it('shows the gate to somebody with no session', async () => {
    setup().dispatch(authActions.authenticateAnonymous())

    expect(await run()).toBe(true)
  })

  it('sends a verified user back into the app', async () => {
    // Otherwise a stale link tells somebody inside Telegram to open Telegram.
    setup().dispatch(
      authActions.authenticateSuccess({ session: { isNewUser: false } as AuthResponse })
    )

    expect(await run()).not.toBe(true)
  })
})

describe('the route table', () => {
  /**
   * Every screen must sit behind `tmaGuard`. The app shipped with no guard
   * anywhere, so a stranger with the URL saw the dashboard — empty, because the
   * backend refused every request, but complete.
   */
  it('guards every route except the gate', () => {
    const unguarded = routes
      .filter((route) => route.path !== UNAVAILABLE_PATH && route.path !== '**')
      .filter((route) => !route.canActivate?.includes(tmaGuard))

    expect(
      unguarded.map((route) => route.path),
      'these routes render without a verified Telegram launch'
    ).toEqual([])
  })

  it('keeps the gate reachable without one', () => {
    const gate = routes.find((route) => route.path === UNAVAILABLE_PATH)

    expect(gate, 'the gate route is missing').toBeDefined()
    expect(gate?.canActivate).toEqual([anonymousGuard])
  })

  /** The catch-all must land inside the guarded tree, not beside it. */
  it('redirects an unknown path into the guarded tree', () => {
    const fallback = routes.find((route) => route.path === '**')

    expect(fallback?.redirectTo).toBe('')
  })
})
