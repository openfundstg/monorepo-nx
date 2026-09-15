import { TestBed } from '@angular/core/testing'
import {
  ApplicationRef,
  Injector,
  provideZonelessChangeDetection,
  runInInjectionContext,
  signal
} from '@angular/core'
import { provideMockActions } from '@ngrx/effects/testing'
import { Subject } from 'rxjs'
import { describe, expect, it } from 'vitest'
import type { Action } from '@ngrx/store'
import type { BalanceUpdateEvent } from '@transacto/contracts'
import { WsService } from '../../realtime/services/ws.service'
import { userActions } from './user.actions'
import { balancePush, refreshAfterBalancePush } from './user.effects'

/**
 * The socket-to-store bridge.
 *
 * Worth a test of its own because it fails silently: `toObservable` needs an
 * injection context, and if it stops getting one the app keeps running with a
 * balance that simply never moves until the user reopens it — which is the exact
 * bug this whole path was built to fix.
 */
describe('the balance push', () => {
  const setup = (balanceUpdated: ReturnType<typeof signal<BalanceUpdateEvent | null>>) => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: WsService, useValue: { balanceUpdated } }
      ]
    })

    const emitted: Action[] = []
    runInInjectionContext(TestBed.inject(Injector), () => balancePush()).subscribe((action) =>
      emitted.push(action)
    )

    return emitted
  }

  /**
   * `toObservable` delivers through an `effect`, so nothing reaches the store
   * until change detection has run — which in a zoneless test means asking for
   * it. This is the app's real behaviour too: the action lands a tick after the
   * socket message, not during it.
   */
  it('turns a socket event into an action', async () => {
    const balanceUpdated = signal<BalanceUpdateEvent | null>(null)
    const emitted = setup(balanceUpdated)

    balanceUpdated.set({ balance: 9_900 } as BalanceUpdateEvent)
    await TestBed.inject(ApplicationRef).whenStable()

    expect(emitted).toEqual([userActions.balancePushed({ balance: 9_900 })])
  })

  /** Nothing has happened yet; the empty signal is not a balance of zero. */
  it('says nothing before an event has arrived', async () => {
    const emitted = setup(signal<BalanceUpdateEvent | null>(null))
    await TestBed.inject(ApplicationRef).whenStable()

    expect(emitted).toEqual([])
  })

  /**
   * `WsService` latches the last event for the app's lifetime, so one from
   * earlier in the session is present before this subscribes — and is applied
   * rather than lost.
   */
  it('applies an event that arrived before it was listening', async () => {
    const balanceUpdated = signal<BalanceUpdateEvent | null>({
      balance: 4_200
    } as BalanceUpdateEvent)

    const emitted = setup(balanceUpdated)
    await TestBed.inject(ApplicationRef).whenStable()

    expect(emitted).toEqual([userActions.balancePushed({ balance: 4_200 })])
  })
})

/**
 * The event carries the available balance and nothing else, but whatever moved
 * it moved the frozen side and the timeline too. Refreshing only the card left
 * the row that explains the new figure missing until the next visit.
 */
describe('what a pushed balance triggers', () => {
  it('re-reads both the profile and the timeline', () => {
    TestBed.resetTestingModule()
    const actions = new Subject<Action>()
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideMockActions(() => actions)]
    })

    const emitted: Action[] = []
    runInInjectionContext(TestBed.inject(Injector), () => refreshAfterBalancePush()).subscribe(
      (action) => emitted.push(action)
    )

    actions.next(userActions.balancePushed({ balance: 9_900 }))

    expect(emitted).toEqual([userActions.loadProfile(), userActions.loadHistory()])
  })
})
