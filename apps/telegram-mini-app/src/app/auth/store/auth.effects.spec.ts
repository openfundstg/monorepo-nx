import { TestBed } from '@angular/core/testing'
import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core'
import { provideMockActions } from '@ngrx/effects/testing'
import { Subject } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import type { Action } from '@ngrx/store'
import type { AuthResponse } from '@transacto/contracts'
import { OnboardingTourService } from '../../onboarding/services/onboarding-tour.service'
import { authActions } from './auth.actions'
import { armOnboardingTour } from './auth.effects'

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
