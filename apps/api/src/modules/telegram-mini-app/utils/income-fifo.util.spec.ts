import { matchSalesToLots, type UsdtLot, type UsdtSale } from './income-fifo.util'

const at = (minute: number): Date => new Date(Date.UTC(2026, 8, 1, 12, minute))

/** 100 USDT that cost ₴4 600 — a hryvnia top-up at 46.00. */
const paidLot = (overrides: Partial<UsdtLot> = {}): UsdtLot => ({
  usdtCents: 10_000,
  costUah: 460_000,
  at: at(0),
  ...overrides
})

/** 100 USDT from somewhere we cannot see. */
const ownLot = (overrides: Partial<UsdtLot> = {}): UsdtLot => ({
  usdtCents: 10_000,
  costUah: null,
  at: at(0),
  ...overrides
})

/** 100 USDT sold for ₴4 700 — a sale at 47.00. */
const sale = (overrides: Partial<UsdtSale> = {}): UsdtSale => ({
  usdtCents: 10_000,
  receivedUah: 470_000,
  at: at(10),
  ...overrides
})

/**
 * The arithmetic the whole income page rests on.
 *
 * Its job is to keep two claims apart: what a user *earned*, which needs both
 * legs of a trade, and what they merely *received*, which is all we can say
 * about USDT somebody bought on an exchange we cannot see. Every case below is
 * a way of getting those two mixed up.
 */
describe('matchSalesToLots', () => {
  it('has nothing to say before the first sale', () => {
    const result = matchSalesToLots([paidLot()], [])

    expect(result.fromFiat.soldUsdtCents).toBe(0)
    expect(result.fromOwnUsdt.soldUsdtCents).toBe(0)
    expect(result.fromFiat.profitUah).toBe(0)
  })

  /** ₴4 700 out, ₴4 600 in: the spread, and both ends observed. */
  it('states the profit when both legs are payments we watched', () => {
    const result = matchSalesToLots([paidLot()], [sale()])

    expect(result.fromFiat).toEqual({
      soldUsdtCents: 10_000,
      spentUah: 460_000,
      receivedUah: 470_000,
      profitUah: 10_000
    })
    expect(result.fromOwnUsdt.soldUsdtCents).toBe(0)
  })

  /**
   * The case the whole split exists for. We know what it fetched; what it cost
   * was settled on an exchange nobody here can see, so no profit is claimed.
   */
  it('claims no profit on USDT the user brought in themselves', () => {
    const result = matchSalesToLots([ownLot()], [sale()])

    expect(result.fromOwnUsdt).toEqual({
      soldUsdtCents: 10_000,
      receivedUah: 470_000,
      averageSellRate: 4_700
    })
    expect(result.fromFiat.profitUah).toBe(0)
    expect(result.fromFiat.receivedUah).toBe(0)
  })

  /**
   * Both, in one sale. Subtracting totals would report ₴4 700 of profit on
   * ₴4 600 of spending — right by accident on the half it could see and pure
   * invention on the other.
   */
  it('splits one sale across the two kinds of lot it drew on', () => {
    const result = matchSalesToLots(
      [paidLot({ usdtCents: 5_000, costUah: 230_000, at: at(0) }), ownLot({ at: at(1) })],
      [sale({ usdtCents: 10_000, receivedUah: 470_000 })]
    )

    expect(result.fromFiat).toEqual({
      soldUsdtCents: 5_000,
      spentUah: 230_000,
      receivedUah: 235_000,
      profitUah: 5_000
    })
    expect(result.fromOwnUsdt.soldUsdtCents).toBe(5_000)
    expect(result.fromOwnUsdt.receivedUah).toBe(235_000)
  })

  /**
   * Unsold USDT is not a loss. Totals would report one: ₴4 600 spent against
   * ₴2 350 received reads as a user down ₴2 250, when they are up ₴150 and
   * still holding half of what they bought.
   */
  it('counts only the part of a lot that was actually sold', () => {
    const result = matchSalesToLots(
      [paidLot()],
      [sale({ usdtCents: 5_000, receivedUah: 235_000 })]
    )

    expect(result.fromFiat).toEqual({
      soldUsdtCents: 5_000,
      spentUah: 230_000,
      receivedUah: 235_000,
      profitUah: 5_000
    })
  })

  /** Oldest lot first, and the second sale gets what the first left behind. */
  it('drains lots in the order they arrived', () => {
    const result = matchSalesToLots(
      [
        paidLot({ usdtCents: 5_000, costUah: 200_000, at: at(0) }),
        paidLot({ usdtCents: 5_000, costUah: 300_000, at: at(1) })
      ],
      [
        sale({ usdtCents: 5_000, receivedUah: 235_000, at: at(5) }),
        sale({ usdtCents: 5_000, receivedUah: 235_000, at: at(6) })
      ]
    )

    // ₴2 000 then ₴3 000 — the dear lot second, which is what FIFO means.
    expect(result.fromFiat.spentUah).toBe(500_000)
    expect(result.fromFiat.profitUah).toBe(-30_000)
  })

  /**
   * A lot that arrived after the order was created cannot have funded it — the
   * stake was checked against the balance at that moment. Ordering by the
   * ending instead would let a top-up made *during* a long order pay for it.
   */
  it('never funds a sale from a lot that arrived after it', () => {
    const result = matchSalesToLots(
      [paidLot({ at: at(20) })],
      [sale({ at: at(10) })]
    )

    // Unmatched, so costless — never matched to the later lot.
    expect(result.fromOwnUsdt.soldUsdtCents).toBe(10_000)
    expect(result.fromFiat.soldUsdtCents).toBe(0)
  })

  /**
   * A user whose history predates this book has USDT nothing here can account
   * for. It is costless — never a guessed basis, and never a crash.
   */
  it('treats USDT it cannot account for as costless rather than inventing a price', () => {
    const result = matchSalesToLots([], [sale()])

    expect(result.fromOwnUsdt.soldUsdtCents).toBe(10_000)
    expect(result.fromOwnUsdt.receivedUah).toBe(470_000)
    expect(result.fromFiat.spentUah).toBe(0)
  })

  /**
   * A sale below what its USDT cost. The spread is built to prevent it, and a
   * page that could not render one would be lying by construction.
   */
  it('reports a loss as a loss', () => {
    const result = matchSalesToLots(
      [paidLot({ costUah: 480_000 })],
      [sale({ receivedUah: 470_000 })]
    )

    expect(result.fromFiat.profitUah).toBe(-10_000)
  })

  /** Only the committed half left the balance; the refunded half never moved. */
  it('accounts for the committed part of a sale and no more', () => {
    const result = matchSalesToLots(
      [paidLot()],
      // A ₴4 700 order that filled halfway: 50 USDT committed, ₴2 350 received.
      [sale({ usdtCents: 5_000, receivedUah: 235_000 })]
    )

    expect(result.fromFiat.soldUsdtCents).toBe(5_000)
  })

  /** The average is weighted by size, not by how many sales there were. */
  it('weights the average sell rate by the USDT behind it', () => {
    const result = matchSalesToLots(
      [ownLot({ usdtCents: 30_000 })],
      [
        sale({ usdtCents: 10_000, receivedUah: 400_000, at: at(5) }),
        sale({ usdtCents: 20_000, receivedUah: 1_000_000, at: at(6) })
      ]
    )

    // ₴14 000 over 300 USDT — 46.67, not the 45.00 an unweighted mean gives.
    expect(result.fromOwnUsdt.averageSellRate).toBe(4_667)
  })

  /** The caller's lots are theirs; a matcher that drained them would work once. */
  it('does not consume the array it was handed', () => {
    const lots = [paidLot()]

    matchSalesToLots(lots, [sale()])

    expect(lots).toEqual([paidLot()])
  })
})
