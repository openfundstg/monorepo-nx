import {
  DEFAULT_MIN_ORDER_KOPECKS,
  priceSale,
  SaleRemainderPolicy,
  targetForStake
} from '@transacto/contracts'
import { TmaSaleStatus } from '@transacto/contracts'
import {
  isGoalClosingTopUp,
  isRemainderRefundable,
  isSaleFunded,
  isSaleInTail,
  saleDeliveredFiat,
  saleDisposal,
  saleTailKopecks,
  settleSale
} from './sale-funding.util'

/** ₴712 target, and Transacto's ₴300 floor on a single order. */
const TARGET = 71_200
const MIN_ORDER = 30_000

describe('isSaleFunded', () => {
  describe('on matched orders', () => {
    it('closes on the exact target', () => {
      expect(
        isSaleFunded({ fiatAmount: TARGET, receivedAmount: TARGET }, MIN_ORDER)
      ).toBe(true)
    })

    // An overshoot is a fully funded order, not a reason to keep waiting.
    it('closes on more than the target', () => {
      expect(
        isSaleFunded({ fiatAmount: TARGET, receivedAmount: TARGET + 5_000 }, MIN_ORDER)
      ).toBe(true)
    })

    it('waits below the target', () => {
      expect(
        isSaleFunded({ fiatAmount: TARGET, receivedAmount: TARGET - 100 }, MIN_ORDER)
      ).toBe(false)
    })
  })

  describe('on the jar balance', () => {
    /**
     * The case the whole rule exists for. ₴500 arrived as a real order, the
     * user paid the last ₴212 in themselves because no payer is ever routed an
     * order that small, and the jar now holds its goal.
     */
    it('closes when the jar is full and only the tail is unmatched', () => {
      expect(
        isSaleFunded(
          { fiatAmount: TARGET, receivedAmount: 50_000, jarBalance: TARGET },
          MIN_ORDER
        )
      ).toBe(true)
    })

    /**
     * The bound. Without it a user could fund their own jar end to end and
     * collect the stake plus the profit for a sale that never happened.
     */
    it('refuses when more than the tail is unmatched', () => {
      expect(
        isSaleFunded(
          { fiatAmount: TARGET, receivedAmount: 0, jarBalance: TARGET },
          MIN_ORDER
        )
      ).toBe(false)
    })

    it('refuses while the jar is short of the goal', () => {
      expect(
        isSaleFunded(
          { fiatAmount: TARGET, receivedAmount: 50_000, jarBalance: TARGET - 1 },
          MIN_ORDER
        )
      ).toBe(false)
    })

    /** A tail of zero means the jar can never close an order on its own. */
    it('refuses any unmatched kopeck at a tail of zero', () => {
      expect(
        isSaleFunded(
          { fiatAmount: TARGET, receivedAmount: TARGET - 1, jarBalance: TARGET },
          0
        )
      ).toBe(false)
    })
  })

  /** Never scraped is not the same as empty, but it may only withhold. */
  it('treats an unknown balance as no help', () => {
    expect(
      isSaleFunded({ fiatAmount: TARGET, receivedAmount: 50_000, jarBalance: null }, MIN_ORDER)
    ).toBe(false)
    expect(isSaleFunded({ fiatAmount: TARGET }, MIN_ORDER)).toBe(false)
  })
})

/**
 * What a refund is measured against. Reading `receivedAmount` directly refunded
 * the whole stake to a user whose jar was holding hryvnia the matcher had not
 * been able to attribute to an order.
 */
describe('saleDeliveredFiat', () => {
  it('counts matched orders', () => {
    expect(saleDeliveredFiat({ receivedAmount: 8_700 })).toBe(8_700)
  })

  it('counts jar money that no order accounts for', () => {
    expect(
      saleDeliveredFiat({ receivedAmount: 0, openingJarBalance: 0, jarBalance: 8_700 })
    ).toBe(8_700)
  })

  /** Hryvnia the jar already held was the user's before the order existed. */
  it('measures the jar as growth, not as its balance', () => {
    expect(
      saleDeliveredFiat({ receivedAmount: 0, openingJarBalance: 50_000, jarBalance: 58_700 })
    ).toBe(8_700)
  })

  /** An unknown baseline may not become a charge. */
  it('ignores the jar when the opening balance was never scraped', () => {
    expect(saleDeliveredFiat({ receivedAmount: 0, jarBalance: 8_700 })).toBe(0)
  })

  it('takes the larger of the two measures', () => {
    expect(
      saleDeliveredFiat({ receivedAmount: 8_700, openingJarBalance: 0, jarBalance: 1_000 })
    ).toBe(8_700)
    expect(
      saleDeliveredFiat({ receivedAmount: 1_000, openingJarBalance: 0, jarBalance: 8_700 })
    ).toBe(8_700)
  })

  it('never returns a negative figure for a jar that was drained', () => {
    expect(
      saleDeliveredFiat({ receivedAmount: 0, openingJarBalance: 10_000, jarBalance: 0 })
    ).toBe(0)
  })

  it('reads an absent order as nothing delivered', () => {
    expect(saleDeliveredFiat({})).toBe(0)
  })
})

/** ₴9 267 goal, and Transacto's ₴300 floor on a single order. */
const GOAL = 926_700

describe('isGoalClosingTopUp', () => {
  /**
   * The reported bug. `TERMINAL_FULL_WARNING` tells the trader to pay in the
   * remainder; they pay in exactly ₴230; and the scraper filed it as an unknown
   * deposit — a second alert for doing what the first one asked.
   */
  it('recognises the trader paying in the last stretch', () => {
    expect(
      isGoalClosingTopUp({ goal: GOAL, balance: GOAL, unmatched: 23_000 }, MIN_ORDER)
    ).toBe(true)
  })

  /** A trader who rounds the remainder up has still closed the jar. */
  it('recognises a top-up that lands past the goal', () => {
    expect(
      isGoalClosingTopUp({ goal: GOAL, balance: GOAL + 5_000, unmatched: 23_000 }, MIN_ORDER)
    ).toBe(true)
  })

  /** A jar still short of its target has not been closed by anything. */
  it('is not a top-up while the jar is still short', () => {
    expect(
      isGoalClosingTopUp({ goal: GOAL, balance: GOAL - 1, unmatched: 23_000 }, MIN_ORDER)
    ).toBe(false)
  })

  /**
   * Transacto could have routed an order this size, so something else could
   * have put it there — and a deposit that large genuinely needs explaining.
   */
  it('is not a top-up when the unmatched amount is a routable order', () => {
    expect(
      isGoalClosingTopUp({ goal: GOAL, balance: GOAL, unmatched: MIN_ORDER + 1 }, MIN_ORDER)
    ).toBe(false)
  })

  it('accepts an unmatched amount exactly one minimum order wide', () => {
    expect(
      isGoalClosingTopUp({ goal: GOAL, balance: GOAL, unmatched: MIN_ORDER }, MIN_ORDER)
    ).toBe(true)
  })

  /** Nothing arrived, so there is nothing to account for. */
  it('is not a top-up when nothing is unmatched', () => {
    expect(isGoalClosingTopUp({ goal: GOAL, balance: GOAL, unmatched: 0 }, MIN_ORDER)).toBe(false)
  })

  /** A jar with no target can never be "closed"; those really are unknown. */
  it.each([undefined, null, 0])('is not a top-up for a goal of %p', (goal) => {
    expect(isGoalClosingTopUp({ goal, balance: GOAL, unmatched: 23_000 }, MIN_ORDER)).toBe(false)
  })
})

/**
 * The gap itself, with no policy in it.
 *
 * **Separated from `isRemainderRefundable` because being in a tail is a fact
 * and what to do about it is a choice.** The two were one function, so the
 * arithmetic was unreachable for everything that only needs the fact — parking
 * a sale, telling an operator what to transfer, drawing the gap on a screen.
 */
describe('saleTailKopecks', () => {
  const MIN = 300 * 100

  const order = (over: Record<string, unknown> = {}) => ({
    fiatAmount: 100_000,
    receivedAmount: 90_000,
    jarBalance: 90_000,
    openingJarBalance: 0,
    ...over,
  })

  it('is the gap when no order the pipeline routes could close it', () => {
    expect(saleTailKopecks(order(), MIN)).toBe(10_000)
    expect(isSaleInTail(order(), MIN)).toBe(true)
  })

  /** Whatever the policy says — the fact does not depend on the ending. */
  it.each([
    SaleRemainderPolicy.WAIT_FOR_TOP_UP,
    SaleRemainderPolicy.REFUND_TO_BALANCE,
    undefined
  ])('reads the same gap under %p', (remainderPolicy) => {
    expect(saleTailKopecks(order({ remainderPolicy }), MIN)).toBe(10_000)
  })

  /**
   * The comparison is strict, unlike `isSaleFunded`'s. A gap of exactly the
   * floor is one the pipeline can still route an order for, and calling it a
   * tail would give up on a payment that was still coming.
   */
  it('is zero when the gap is exactly one whole order', () => {
    expect(saleTailKopecks(order({ receivedAmount: 70_000, jarBalance: 70_000 }), MIN)).toBe(0)
  })

  it('is the gap one kopeck below that', () => {
    expect(saleTailKopecks(order({ receivedAmount: 70_001, jarBalance: 70_001 }), MIN)).toBe(29_999)
  })

  it('is zero once the target is reached', () => {
    expect(saleTailKopecks(order({ receivedAmount: 100_000, jarBalance: 100_000 }), MIN)).toBe(0)
    expect(saleTailKopecks(order({ receivedAmount: 120_000, jarBalance: 120_000 }), MIN)).toBe(0)
  })

  /**
   * Nothing having arrived is not a tail. A target that happens to sit below the
   * floor would otherwise be in its tail the instant it was created — and every
   * sale would be, for the moment before its first payment.
   */
  it('is zero before anything has arrived', () => {
    expect(saleTailKopecks(order({ receivedAmount: 0, jarBalance: 0 }), MIN)).toBe(0)
    expect(saleTailKopecks(order({ fiatAmount: 20_000, receivedAmount: 0, jarBalance: 0 }), MIN)).toBe(0)
  })

  /**
   * The jar's own growth counts, as it does for `saleDeliveredFiat` — a jar
   * holding money no order accounts for has still had that money reach it.
   */
  it('measures the gap against whichever record shows more', () => {
    expect(saleTailKopecks(order({ receivedAmount: 0, jarBalance: 90_000 }), MIN)).toBe(10_000)
  })
})

describe('isRemainderRefundable', () => {
  const MIN = 300 * 100

  const order = (over: Record<string, unknown> = {}) => ({
    fiatAmount: 100_000,
    receivedAmount: 90_000,
    jarBalance: 90_000,
    openingJarBalance: 0,
    remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
    ...over,
  })

  /**
   * The worked example the feature was specified with: ₴1 000 target, three
   * ₴300 orders, ₴100 left that no fourth order could ever be raised for.
   */
  it('is true for a tail smaller than any order the pipeline can route', () => {
    expect(isRemainderRefundable(order(), MIN)).toBe(true)
  })

  it('is false for an order that did not ask for it', () => {
    expect(
      isRemainderRefundable(
        order({ remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP }),
        MIN,
      ),
    ).toBe(false)
  })

  /** Every order stored before the choice existed carries no policy at all. */
  it('is false when the policy is absent', () => {
    expect(isRemainderRefundable(order({ remainderPolicy: undefined }), MIN)).toBe(false)
    expect(isRemainderRefundable(order({ remainderPolicy: null }), MIN)).toBe(false)
  })

  /**
   * The comparison is strict, unlike `isSaleFunded`'s. A gap of exactly
   * the floor is one the pipeline can still route an order for, and writing it
   * off would give up on a payment that was still coming.
   */
  it('is false when the gap is exactly one whole order', () => {
    expect(
      isRemainderRefundable(order({ receivedAmount: 70_000, jarBalance: 70_000 }), MIN),
    ).toBe(false)
  })

  it('is true one kopeck below that', () => {
    expect(
      isRemainderRefundable(order({ receivedAmount: 70_001, jarBalance: 70_001 }), MIN),
    ).toBe(true)
  })

  /**
   * Without this an order whose whole target sits under the floor would refund
   * itself the instant it was created, before a single payer had seen it.
   */
  it('is false before anything has arrived', () => {
    expect(
      isRemainderRefundable(
        order({ fiatAmount: 20_000, receivedAmount: 0, jarBalance: 0 }),
        MIN,
      ),
    ).toBe(false)
  })

  /** A funded order is not a tail; it closes down the ordinary path. */
  it('is false once the target has been reached', () => {
    expect(
      isRemainderRefundable(order({ receivedAmount: 100_000, jarBalance: 100_000 }), MIN),
    ).toBe(false)
  })

  it('is false past the target', () => {
    expect(
      isRemainderRefundable(order({ receivedAmount: 110_000, jarBalance: 110_000 }), MIN),
    ).toBe(false)
  })

  /**
   * Money can reach a jar without an order accounting for it, and
   * `saleDeliveredFiat` counts jar growth as well as matched orders. A
   * tail measured only on matched money would be refunded twice.
   */
  it('counts jar growth no order accounts for', () => {
    expect(
      isRemainderRefundable(
        order({ receivedAmount: 0, jarBalance: 90_000, openingJarBalance: 0 }),
        MIN,
      ),
    ).toBe(true)
  })

  /** A jar that already held money was not filled by this order. */
  it('measures growth from the opening balance, not the raw jar balance', () => {
    expect(
      isRemainderRefundable(
        order({ receivedAmount: 0, jarBalance: 90_000, openingJarBalance: 90_000 }),
        MIN,
      ),
    ).toBe(false)
  })
})

describe('settleSale', () => {
  /** Rate of ₴10 per USDT, so the arithmetic reads off the page. */
  const RATE = 1_000

  const order = (over: Record<string, unknown> = {}) => ({
    fiatAmount: 100_000,
    frozenUsdt: 9_800,
    exchangeRate: RATE,
    receivedAmount: 90_000,
    jarBalance: 90_000,
    openingJarBalance: 0,
    remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
    ...over,
  })

  describe('an order that waits for a top-up', () => {
    /**
     * Bit-for-bit what completion did before the choice existed. This branch is
     * deliberately not routed through the delivered figure: an order stored
     * before `openingJarBalance` existed reads zero jar growth, and its turnover
     * would be quietly reduced on completion.
     */
    it('commits the whole stake and counts the whole target', () => {
      expect(
        settleSale(
          order({
            remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
            receivedAmount: 0,
            jarBalance: null,
            openingJarBalance: null,
          }),
        ),
      ).toEqual({
        settledFiat: 100_000,
        remainderKopecks: 0,
        refundedUsdtCents: 0,
        committedUsdtCents: 9_800,
      })
    })

    it('does the same when the policy is absent', () => {
      expect(settleSale(order({ remainderPolicy: undefined })).refundedUsdtCents).toBe(0)
    })
  })

  describe('an order that refunds its tail', () => {
    /**
     * The specified example. ₴1 000 target, ₴900 received, ₴100 left — returned
     * as 10 USDT at the order's own rate of ₴10.
     */
    it('converts the tail at the order rate', () => {
      expect(settleSale(order())).toEqual({
        settledFiat: 90_000,
        remainderKopecks: 10_000,
        refundedUsdtCents: 1_000,
        committedUsdtCents: 8_800,
      })
    })

    /** The two halves must always add back up to what was frozen. */
    it('splits the stake exactly', () => {
      const settled = settleSale(order({ receivedAmount: 87_531, jarBalance: 87_531 }))

      expect(settled.committedUsdtCents + settled.refundedUsdtCents).toBe(9_800)
    })

    /** A fully filled jar has no tail, whatever policy the order carries. */
    it('refunds nothing when the target arrived in full', () => {
      expect(
        settleSale(order({ receivedAmount: 100_000, jarBalance: 100_000 })),
      ).toEqual({
        settledFiat: 100_000,
        remainderKopecks: 0,
        refundedUsdtCents: 0,
        committedUsdtCents: 9_800,
      })
    })

    /** An overshoot is still a full fill, not a negative tail. */
    it('never treats an overshoot as a remainder', () => {
      const settled = settleSale(order({ receivedAmount: 120_000, jarBalance: 120_000 }))

      expect(settled.settledFiat).toBe(100_000)
      expect(settled.remainderKopecks).toBe(0)
      expect(settled.refundedUsdtCents).toBe(0)
    })

    /**
     * The refund is clamped to the stake. A jar reporting far less than it
     * should must not hand back more USDT than was ever frozen for it.
     */
    it('never refunds more than was frozen', () => {
      const settled = settleSale(
        order({ receivedAmount: 1, jarBalance: 1, frozenUsdt: 500 }),
      )

      expect(settled.refundedUsdtCents).toBe(500)
      expect(settled.committedUsdtCents).toBe(0)
    })

    /** A rate of zero cannot price a refund; it must not produce an Infinity. */
    it('refunds nothing at a nonsensical rate', () => {
      expect(settleSale(order({ exchangeRate: 0 })).refundedUsdtCents).toBe(0)
    })
  })
})

/**
 * The promise the remainder policy makes, held as a property rather than as a
 * handful of examples.
 *
 * A user who takes the refund must never do worse than if the jar had simply
 * filled. That is not obvious from the code: the tail is converted, rounded and
 * clamped, and each of those is a place a fraction could go the wrong way. It
 * already had — rounding the refund to nearest cost up to half a cent, which on
 * a ₴1 tail was larger than the profit inside the tail and put the realised
 * return under the quoted rate.
 *
 * Every case below is one the rule can actually fire on: `isRemainderRefundable`
 * gates the sweep, so no impossible state is ever asserted about.
 */
describe('the refunded tail never costs the user their rate', () => {
  const play = (stakeUsdt: number, rate: number, deliveredKopecks: number) => {
    const fiatAmount = targetForStake(stakeUsdt, rate)
    const { requiredUsdtCents } = priceSale(fiatAmount, rate)

    const order = {
      fiatAmount,
      frozenUsdt: requiredUsdtCents,
      exchangeRate: rate,
      receivedAmount: deliveredKopecks,
      jarBalance: deliveredKopecks,
      openingJarBalance: 0,
      remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE
    }
    const settled = settleSale(order)

    // Everything in kopecks, at the order's own snapshotted rate.
    const paid = (settled.committedUsdtCents * rate) / 100
    const refundValue = (settled.refundedUsdtCents * rate) / 100

    return {
      fires: isRemainderRefundable(order, DEFAULT_MIN_ORDER_KOPECKS),
      frozen: requiredUsdtCents,
      paid,
      took: settled.settledFiat + refundValue,
      /**
       * The whole target, or what is missing from it.
       *
       * This replaced a comparison of realised return against a full fill's
       * return. That comparison measured the markup, and the markup is no
       * longer a separate quantity: one rate does the stake, the tail and the
       * value of both, so a partial fill and a full fill return the same figure
       * and the two sides collapsed into rounding noise. What survives the
       * change is the promise itself — the user ends up with the full target's
       * worth however the order finishes.
       */
      shortfall: fiatAmount - (settled.settledFiat + refundValue),
      settled
    }
  }

  /**
   * The example the feature was specified with, worked through end to end.
   *
   * One rate does every conversion now — the stake, the tail and the value of
   * both — so the arithmetic closes exactly rather than nearly. 98 USDT at ₴10
   * is a ₴980 target; ₴900 arrives, ₴80 does not, and the ₴80 comes back as the
   * 8 USDT it was sold for.
   */
  it('returns the tail whole on the specified example', () => {
    const { settled, took, fires } = play(98, 1_000, 90_000)

    expect(fires).toBe(true)
    // ₴80 left at ₴10 per USDT.
    expect(settled.refundedUsdtCents).toBe(800)
    // The whole 98 USDT staked, less the refunded tail.
    expect(settled.committedUsdtCents).toBe(9_000)
    // Jar plus refund comes to the full target, to the kopeck.
    expect(took).toBe(98_000)
  })

  /**
   * The case that exposed the leak: a ₴1 tail at ₴46.52 converts to 2.15 cents,
   * and the 0.15 rounded away was worth more than the profit inside the tail.
   */
  it('rounds a fractional tail up rather than to nearest', () => {
    const target = targetForStake(100, 4_652)
    const { settled, shortfall } = play(100, 4_652, target - 100)

    // ₴1 is 2.15 cents at this rate. Rounding to nearest gives 2 and leaves the
    // user fifteen hundredths of a cent short of the target they were quoted;
    // rounding up gives 3 and costs us the same fraction instead.
    expect(settled.refundedUsdtCents).toBe(3)
    expect(shortfall).toBeLessThanOrEqual(0)
  })

  it('holds across every rate, stake and tail the rule fires on', () => {
    const leftShort: string[] = []
    const lostMoney: string[] = []
    const splitBroken: string[] = []
    let overpaidBy = 0
    let checked = 0

    for (const rate of [1_000, 3_000, 4_137, 4_652, 5_001, 7_000]) {
      for (let stake = 10; stake <= 500; stake += 7) {
        const target = targetForStake(stake, rate)

        for (let tail = 1; tail * 100 < DEFAULT_MIN_ORDER_KOPECKS; tail += 1) {
          const delivered = target - tail * 100
          if (delivered <= 0) continue

          const result = play(stake, rate, delivered)
          if (!result.fires) continue
          checked++

          const where = `rate ${rate}, stake ${stake}, tail ₴${tail}`

          // Never short: hryvnia in the jar plus USDT handed back must cover
          // the target the user was quoted, every time.
          if (result.shortfall > 0)
            leftShort.push(`${where}: ${result.shortfall} kopecks short`)
          if (result.took < result.paid) lostMoney.push(where)
          if (result.settled.committedUsdtCents + result.settled.refundedUsdtCents !== result.frozen)
            splitBroken.push(where)

          overpaidBy = Math.max(overpaidBy, result.took - target)
        }
      }
    }

    // A guard on the guard: a sweep that quietly stopped matching anything
    // would pass every assertion below without checking a thing.
    expect(checked).toBeGreaterThan(10_000)
    expect(leftShort).toEqual([])
    expect(lostMoney).toEqual([])
    // The stake is fully accounted for on every single case.
    expect(splitBroken).toEqual([])
    // Rounding up is in the user's favour, and costs us at most one cent —
    // 70 kopecks at the highest rate in the sweep.
    expect(overpaidBy).toBeLessThanOrEqual(70)
  })
})

/**
 * The two figures an ended order is worth, whichever way it ended.
 *
 * It exists because the obvious arithmetic is wrong on one of the two endings
 * and looks right on both. `frozenUsdt - refundedRemainderUsdt` reads as "the
 * committed stake" and is only that for a completed order: `completeIfOpen`
 * writes that field and `cancelIfOpen` does not, so on a cancellation it reads
 * its default of zero and the entire stake appears spent. The earnings page
 * derived it that way and reported a user's whole stake sold for nothing.
 */
describe('saleDisposal', () => {
  /** ₴10 per USDT, so the arithmetic reads off the page. */
  const RATE = 1_000

  const ended = (over: Record<string, unknown> = {}) => ({
    status: TmaSaleStatus.COMPLETED,
    fiatAmount: 100_000,
    frozenUsdt: 10_000,
    exchangeRate: RATE,
    receivedAmount: 100_000,
    jarBalance: 100_000,
    openingJarBalance: 0,
    remainderPolicy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
    ...over,
  })

  it('gives a completed order its whole stake and its whole target', () => {
    expect(saleDisposal(ended())).toEqual({
      committedUsdtCents: 10_000,
      deliveredFiat: 100_000,
    })
  })

  /** The tail came back, so it was never disposed of. */
  it('leaves a refunded tail out of a completed order', () => {
    const disposal = saleDisposal(
      ended({
        remainderPolicy: SaleRemainderPolicy.REFUND_TO_BALANCE,
        receivedAmount: 90_000,
        jarBalance: 90_000,
      })
    )

    expect(disposal).toEqual({ committedUsdtCents: 9_000, deliveredFiat: 90_000 })
  })

  /** The case the obvious arithmetic got wrong: nothing paid in, nothing sold. */
  it('disposes of nothing when an order was stopped before anybody paid', () => {
    const disposal = saleDisposal(
      ended({
        status: TmaSaleStatus.CANCELLED,
        receivedAmount: 0,
        jarBalance: 0,
      })
    )

    expect(disposal).toEqual({ committedUsdtCents: 0, deliveredFiat: 0 })
  })

  /** Part paid: the user keeps that hryvnia, so the USDT that bought it is spent. */
  it('charges a stopped order for what it had already delivered', () => {
    const disposal = saleDisposal(
      ended({
        status: TmaSaleStatus.CANCELLED,
        receivedAmount: 40_000,
        jarBalance: 40_000,
      })
    )

    expect(disposal).toEqual({ committedUsdtCents: 4_000, deliveredFiat: 40_000 })
  })

  /**
   * Both endings read the hryvnia through {@link saleDeliveredFiat},
   * which takes the greater of what was matched and what the jar grew by — a
   * jar can hold money no settled order accounts for.
   */
  it('counts jar growth no settled order accounts for', () => {
    const disposal = saleDisposal(
      ended({
        status: TmaSaleStatus.CANCELLED,
        receivedAmount: 0,
        jarBalance: 40_000,
      })
    )

    expect(disposal.deliveredFiat).toBe(40_000)
  })

  /** A jar that already held money was not filled by this order. */
  it('ignores hryvnia the jar held before the order started', () => {
    const disposal = saleDisposal(
      ended({
        status: TmaSaleStatus.CANCELLED,
        receivedAmount: 0,
        jarBalance: 40_000,
        openingJarBalance: 40_000,
      })
    )

    expect(disposal).toEqual({ committedUsdtCents: 0, deliveredFiat: 0 })
  })
})
