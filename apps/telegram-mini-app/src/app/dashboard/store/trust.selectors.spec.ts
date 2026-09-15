import { describe, expect, it } from 'vitest'
import { TrustLevel } from '@transacto/contracts'
import type { TrustLevelRung } from '@transacto/contracts'
import { AUTH_FEATURE } from '../../auth/store/auth.state'
import { USER_FEATURE } from '../../user/store/user.state'
import { TRUST_FEATURE } from './trust.state'
import { selectNextRung, selectTurnoverProgress, selectTurnoverRemaining } from './trust.selectors'

const rung = (level: TrustLevel, minTurnover: number): TrustLevelRung => ({
  level,
  minTurnover,
  maxParallelOrders: 1
})

const LADDER = [
  rung(TrustLevel.NEWBIE, 0),
  rung(TrustLevel.EXPERIENCED, 10_000_000),
  rung(TrustLevel.PRO, 50_000_000)
]

/** The shape the selectors read, assembled from the two slices they span. */
const stateWith = (level: TrustLevel, totalTurnover: number, levels = LADDER) => ({
  [AUTH_FEATURE]: {},
  [TRUST_FEATURE]: { levels, loaded: true },
  [USER_FEATURE]: {
    profile: { totalTurnover },
    trustLevel: { level, maxParallelOrders: 1 },
    history: [],
    loadingProfile: false,
    loadingHistory: false,
    historyLoaded: true
  }
})

describe('where the user stands on the ladder', () => {
  it('names the rung above the current one', () => {
    expect(selectNextRung(stateWith(TrustLevel.NEWBIE, 0) as never)?.level).toBe(
      TrustLevel.EXPERIENCED
    )
  })

  it('has nothing above the top rung', () => {
    expect(selectNextRung(stateWith(TrustLevel.PRO, 60_000_000) as never)).toBeNull()
  })

  /**
   * Measured within one rung rather than across the whole ladder. The bar used
   * to weight the two milestones, so ₴76 543 of the ₴100 000 needed for the
   * next level drew as 30% — and nothing on screen explained the gap between
   * the two figures.
   */
  it('measures progress within the current rung, not across the ladder', () => {
    const halfWayToExperienced = stateWith(TrustLevel.NEWBIE, 5_000_000)

    expect(selectTurnoverProgress(halfWayToExperienced as never)).toBe(50)
  })

  it('reads full at the top of the ladder', () => {
    expect(selectTurnoverProgress(stateWith(TrustLevel.PRO, 60_000_000) as never)).toBe(100)
  })

  /** And while the ladder is still loading: there is no next rung to be part-way to. */
  it('reads full before the ladder has arrived', () => {
    expect(selectTurnoverProgress(stateWith(TrustLevel.NEWBIE, 0, []) as never)).toBe(100)
  })

  it('counts what is left to the next rung', () => {
    expect(selectTurnoverRemaining(stateWith(TrustLevel.NEWBIE, 4_000_000) as never)).toBe(6_000_000)
  })

  /** Never negative — a user past the threshold has nothing left to turn over. */
  it('never counts below zero', () => {
    expect(selectTurnoverRemaining(stateWith(TrustLevel.PRO, 60_000_000) as never)).toBe(0)
  })
})
