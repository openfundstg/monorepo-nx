import { TestBed } from '@angular/core/testing'
import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core'
import { provideMockActions } from '@ngrx/effects/testing'
import { Subject } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { Action } from '@ngrx/store'
import type { AuthResponse } from '@transacto/contracts'
import { OnboardingTourService } from '../../onboarding/services/onboarding-tour.service'
import { MetaPixelService } from '../../shared/services/meta-pixel.service'
import { PixelStandardEvent } from '../../shared/enums/pixel-event.enum'
import { authActions } from './auth.actions'
import { armOnboardingTour, suspendAnalyticsForDemo, trackRegistration } from './auth.effects'

/**
 * The one moment the app learns an account is new, turned into the promise of
 * a tour. Worth pinning on its own: `isNewUser` is true on exactly one `/auth`
 * in an account's life, so a filter the wrong way round would either owe the
 * tour to every launch or to none.
 */
describe('armOnboardingTour', () => {
  const setup = () => {
    const actions = new Subject<Action>()
    const markPending = vi.fn()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideMockActions(() => actions),
        { provide: OnboardingTourService, useValue: { markPending } }
      ]
    })

    runInInjectionContext(TestBed.inject(Injector), () => armOnboardingTour()).subscribe()

    return { actions, markPending }
  }

  const session = (isNewUser: boolean): AuthResponse => ({ isNewUser }) as AuthResponse

  it('owes a brand-new account its tour', () => {
    const { actions, markPending } = setup()

    actions.next(authActions.authenticateSuccess({ session: session(true) }))

    expect(markPending).toHaveBeenCalledTimes(1)
  })

  it('leaves a returning account alone', () => {
    const { actions, markPending } = setup()

    actions.next(authActions.authenticateSuccess({ session: session(false) }))
    actions.next(authActions.authenticateAnonymous())

    expect(markPending).not.toHaveBeenCalled()
  })
})

/**
 * A demo account is a promoter recording the app, and the pixel reports into
 * the ad account that measures their campaign. It has to fall silent before
 * the first screen reports a view — which is why it happens on `/auth`.
 */
describe('suspendAnalyticsForDemo', () => {
  const setup = () => {
    const actions = new Subject<Action>()
    const suspend = vi.fn()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideMockActions(() => actions),
        { provide: MetaPixelService, useValue: { suspend } }
      ]
    })

    runInInjectionContext(TestBed.inject(Injector), () => suspendAnalyticsForDemo()).subscribe()

    return { actions, suspend }
  }

  it('silences the pixel for a demo account', () => {
    const { actions, suspend } = setup()

    actions.next(
      authActions.authenticateSuccess({
        session: { isNewUser: false, demo: {} } as unknown as AuthResponse
      })
    )

    expect(suspend).toHaveBeenCalledTimes(1)
  })

  it('leaves it alone for everybody else', () => {
    const { actions, suspend } = setup()

    actions.next(authActions.authenticateSuccess({ session: { isNewUser: true } as AuthResponse }))

    expect(suspend).not.toHaveBeenCalled()
  })
})

describe('trackRegistration', () => {
  const setup = () => {
    const actions = new Subject<Action>()
    const trackConversion = vi.fn()

    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideMockActions(() => actions),
        { provide: MetaPixelService, useValue: { trackConversion } }
      ]
    })

    runInInjectionContext(TestBed.inject(Injector), () => trackRegistration()).subscribe()

    return { actions, trackConversion }
  }

  it('counts a new account once', () => {
    const { actions, trackConversion } = setup()

    actions.next(authActions.authenticateSuccess({ session: { isNewUser: true } as AuthResponse }))

    expect(trackConversion).toHaveBeenCalledWith(PixelStandardEvent.COMPLETE_REGISTRATION)
  })

  it('never counts a demo account, whichever effect runs first', () => {
    const { actions, trackConversion } = setup()

    actions.next(
      authActions.authenticateSuccess({
        session: { isNewUser: true, demo: {} } as unknown as AuthResponse
      })
    )

    expect(trackConversion).not.toHaveBeenCalled()
  })
})
