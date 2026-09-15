import { describe, expect, it } from 'vitest'
import { BankProvider } from '@transacto/contracts'
import { TrustLevel } from '@transacto/contracts'
import type { AuthResponse, TmaUser, TrustLevelInfo } from '@transacto/contracts'
import { authActions } from '../../auth/store/auth.actions'
import { userActions } from './user.actions'
import { userReducer } from './user.reducer'
import { initialUserState } from './user.state'

const user = (overrides: Partial<TmaUser> = {}): TmaUser =>
  ({
    telegramId: 592,
    balance: 4_200,
    frozenBalance: 1_000,
    totalTurnover: 250_000,
    ...overrides
  }) as TmaUser

const trustLevel: TrustLevelInfo = {
  level: TrustLevel.NEWBIE,
  maxParallelOrders: 1
}

describe('the user slice', () => {
  /**
   * `/auth` already returns the profile, so the opening handshake fills this
   * slice rather than being followed by a second request for what it just said.
   */
  it('seeds itself from the launch handshake', () => {
    const session = { user: user(), trustLevel, isNewUser: false } as AuthResponse

    const state = userReducer(initialUserState, authActions.authenticateSuccess({ session }))

    expect(state.profile).toEqual(session.user)
    expect(state.trustLevel).toEqual(trustLevel)
  })

  /**
   * The reconciliation this slice exists to remove. Two sources feed the
   * balance — the profile and the socket — and the dashboard used to run a
   * `linkedSignal` deciding which of them was the newer on every render. Here
   * the last write is simply the state.
   */
  it('lets a pushed balance overwrite a fetched one', () => {
    const seeded = userReducer(
      initialUserState,
      userActions.loadProfileSuccess({ user: user({ balance: 4_200 }), trustLevel, slotsAwaitingJarClosure: [] })
    )

    const pushed = userReducer(seeded, userActions.balancePushed({ balance: 9_900 }))

    expect(pushed.profile?.balance).toBe(9_900)
  })

  /** …and the other way round, because a fresh read is news too. */
  it('lets a fetched balance overwrite a pushed one', () => {
    const pushed = userReducer(
      userReducer(
        initialUserState,
        userActions.loadProfileSuccess({ user: user({ balance: 4_200 }), trustLevel, slotsAwaitingJarClosure: [] })
      ),
      userActions.balancePushed({ balance: 9_900 })
    )

    const fetched = userReducer(
      pushed,
      userActions.loadProfileSuccess({ user: user({ balance: 12_000 }), trustLevel, slotsAwaitingJarClosure: [] })
    )

    expect(fetched.profile?.balance).toBe(12_000)
  })

  /**
   * A balance is a balance *of* something. An event that arrives before the
   * profile has nothing to be attached to, and inventing a user around one
   * number would put a card on screen with every other field blank.
   */
  it('ignores a push that arrives before there is a profile', () => {
    expect(userReducer(initialUserState, userActions.balancePushed({ balance: 9_900 }))).toEqual(
      initialUserState
    )
  })

  /** The push carries only the available balance; the frozen side is untouched. */
  it('leaves the frozen balance to the refetch', () => {
    const seeded = userReducer(
      initialUserState,
      userActions.loadProfileSuccess({ user: user({ frozenBalance: 1_000 }), trustLevel, slotsAwaitingJarClosure: [] })
    )

    const pushed = userReducer(seeded, userActions.balancePushed({ balance: 9_900 }))

    expect(pushed.profile?.frozenBalance).toBe(1_000)
  })

  /**
   * An empty timeline is both the initial value and an ordinary answer. Without
   * this flag the dashboard draws "you have done nothing yet" while the request
   * is still in the air.
   */
  it('marks the timeline answered even when it came back empty', () => {
    const state = userReducer(initialUserState, userActions.loadHistorySuccess({ history: [] }))

    expect(state.historyLoaded).toBe(true)
  })

  /** A failed read has answered too — otherwise the spinner never stops. */
  it('marks the timeline answered when the read failed', () => {
    expect(userReducer(initialUserState, userActions.loadHistoryFailure()).historyLoaded).toBe(true)
  })
  /**
   * The jars the dashboard has to name.
   *
   * Held in this slice rather than fetched by the screen that shows them: a
   * user blocked by an open jar is not on the create form — they are on the
   * dashboard, wondering why it says a sale is running when none is.
   */
  it('keeps the finished sales whose jars are still holding a slot', () => {
    const awaiting = [
      {
        id: '000000000000000000000001',
        publicId: '8GJPNPDY',
        bankType: BankProvider.NOVAPAY,
        endedAt: '2026-09-05T11:32:54.582Z'
      }
    ]

    const state = userReducer(
      initialUserState,
      userActions.loadProfileSuccess({
        user: user({}),
        trustLevel,
        slotsAwaitingJarClosure: awaiting
      })
    )

    expect(state.slotsAwaitingJarClosure).toEqual(awaiting)
  })

  /** An empty answer is an ordinary one: every jar is closed. */
  it('clears them when the next profile reports none', () => {
    const seeded = userReducer(
      initialUserState,
      userActions.loadProfileSuccess({
        user: user({}),
        trustLevel,
        slotsAwaitingJarClosure: [
          {
            id: '000000000000000000000001',
            publicId: '8GJPNPDY',
            bankType: BankProvider.NOVAPAY,
            endedAt: '2026-09-05T11:32:54.582Z'
          }
        ]
      })
    )

    const cleared = userReducer(
      seeded,
      userActions.loadProfileSuccess({ user: user({}), trustLevel, slotsAwaitingJarClosure: [] })
    )

    expect(cleared.slotsAwaitingJarClosure).toEqual([])
  })
})
