import { TrustLevel } from '@transacto/contracts'
import { NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH, TRUST_LEVELS, getTrustLevel } from './tma.constants'

/** Turnover crosses the wire in UAH kopecks, and so do the thresholds. */
const uah = (amount: number) => amount * 100

describe('getTrustLevel', () => {
  it.each([
    ['a brand new user', 0, TrustLevel.NEWBIE],
    ['the reported ₴76 543 of turnover', uah(76_543), TrustLevel.NEWBIE],
    ['one kopeck short of EXPERIENCED', uah(100_000) - 1, TrustLevel.NEWBIE],
    ['exactly EXPERIENCED', uah(100_000), TrustLevel.EXPERIENCED],
    ['comfortably EXPERIENCED', uah(250_000), TrustLevel.EXPERIENCED],
    ['one kopeck short of PRO', uah(500_000) - 1, TrustLevel.EXPERIENCED],
    ['exactly PRO', uah(500_000), TrustLevel.PRO],
    ['far past PRO', uah(9_000_000), TrustLevel.PRO],
  ])('reads %s as %s', (_label, turnover, expected) => {
    expect(getTrustLevel(turnover).level).toBe(expected)
  })

  it('carries the level’s own parallel-order allowance', () => {
    expect(getTrustLevel(uah(250_000)).maxParallelOrders).toBe(
      TRUST_LEVELS[TrustLevel.EXPERIENCED].maxParallelOrders,
    )
  })

  /**
   * The numbers themselves, pinned. They are a commercial decision rather than
   * a derivation, so the only thing that can defend them is writing them down:
   * one at a time for a new user, three once they have turned over ₴100 000,
   * five past ₴500 000.
   */
  it.each([
    [TrustLevel.NEWBIE, 1],
    [TrustLevel.EXPERIENCED, 3],
    [TrustLevel.PRO, 5],
  ])('allows %s exactly %i at once', (level, allowance) => {
    expect(TRUST_LEVELS[level].maxParallelOrders).toBe(allowance)
  })

  /** A level that allowed none would lock a user out of the product entirely. */
  it('never allows fewer than one', () => {
    for (const level of Object.values(TrustLevel)) {
      expect(TRUST_LEVELS[level].maxParallelOrders).toBeGreaterThanOrEqual(1)
    }
  })

  /** More turnover must never buy fewer slots. */
  it('never narrows as the ladder is climbed', () => {
    const ladder = [TrustLevel.NEWBIE, TrustLevel.EXPERIENCED, TrustLevel.PRO]

    for (const [index, level] of ladder.slice(1).entries()) {
      expect(TRUST_LEVELS[level].maxParallelOrders).toBeGreaterThan(
        TRUST_LEVELS[ladder[index]].maxParallelOrders,
      )
    }
  })

  /**
   * The thresholds used to be written out a second time inside this function as
   * `turnoverUah >= 100_000` literals, which made `minTurnover` decorative:
   * editing it changed nothing. The Mini App's progress bar mirrors
   * `minTurnover`, so the badge and the bar would have disagreed the moment
   * anyone edited it.
   */
  it('is driven by TRUST_LEVELS rather than by literals of its own', () => {
    for (const level of Object.values(TrustLevel)) {
      const { minTurnover } = TRUST_LEVELS[level]

      expect(getTrustLevel(minTurnover).level).toBe(level)
      if (minTurnover > 0) expect(getTrustLevel(minTurnover - 1).level).not.toBe(level)
    }
  })

  /** Nothing below the floor, so a negative can never fall through to undefined. */
  it('never reports less than NEWBIE', () => {
    expect(getTrustLevel(-1).level).toBe(TrustLevel.NEWBIE)
  })
})

/**
 * Pinned, and deliberately not part of a level.
 *
 * The hryvnia top-up ceiling used to hang off `TRUST_LEVELS[NEWBIE]`, which
 * tied it to turnover — a bar a genuine user clears only after ₴100 000 of
 * business, long after they have proved the only thing the ceiling asks about.
 * It is lifted by a first credited deposit instead, which is a question the
 * ladder cannot answer, so it lives on its own.
 */
describe('NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH', () => {
  it('is ₴2 000, in kopecks', () => {
    expect(NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH).toBe(uah(2_000))
  })

  it('is not a property of any trust level', () => {
    for (const level of Object.values(TrustLevel)) {
      expect(TRUST_LEVELS[level]).not.toHaveProperty('maxFiatDepositUah')
    }
  })
})
