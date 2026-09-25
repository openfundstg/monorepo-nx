import {
  BalanceEntryKind,
  CENTS_PER_USDT,
  SaleEventType,
  SaleMethod,
  TmaSaleStatus,
  isLuhnValid,
  priceStake,
  type BalanceHistoryEntry,
  type TmaDemoPack
} from '@transacto/contracts'
import { DAY_MS, HOUR_MS, getTrustLevel, trustLadder } from 'src/shared/constants'
import { DemoHistoryShape } from 'src/modules/telegram-mini-app/constants'
import { buildDemoPack, type DemoPackInput } from './demo-pack.util'
import { referralRewardCents } from './referral-reward.util'

const NOW = Date.UTC(2026, 8, 25, 12, 0)

const input = (overrides: Partial<DemoPackInput> = {}): DemoPackInput => ({
  telegramId: 700_100_200,
  identity: { firstName: 'Олена', lastName: '', username: '', showNameToReferrer: false },
  now: NOW,
  buyRate: 4_566,
  sellRate: 4_681,
  referral: { code: 'Z38SL69F', link: 'deep-link-carrying-Z38SL69F', ratePercent: 0.1 },
  walletAddress: 'T_WALLET_NOT_A_REAL_ADDRESS',
  depositExpiryMinutes: 60,
  payWindowMinutes: 15,
  minOrderKopecks: 30_000,
  ...overrides
})

/** Enough accounts that a rule holding for one seed by luck would be caught. */
const ACCOUNTS = Array.from({ length: 25 }, (_, index) => 100_000_007 + index * 7_919_317)

/** What one row of the history did to the spendable balance. */
const balanceMovedBy = (entry: BalanceHistoryEntry): number => {
  switch (entry.type) {
    case 'deposit':
      return entry.cryptoAmount * CENTS_PER_USDT
    case 'fiat_deposit':
    case 'balance_movement':
      return entry.cryptoCents
    case 'sale':
      return entry.status === TmaSaleStatus.COMPLETED ? -entry.stakeUsdtCents : 0
  }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const oldestFirst = (pack: TmaDemoPack): readonly BalanceHistoryEntry[] =>
  pack.history.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))

/**
 * A demo account's screens are drawn from here, and a viewer can add them up.
 *
 * So what is tested is not what the story says but that it is **one** story:
 * the balance is what the history leaves, the level is what the turnover
 * earns, the referral pot is the earnings less the transfers on the timeline,
 * and every figure was priced by the arithmetic the real product uses.
 */
describe('buildDemoPack', () => {
  it('tells one account the same story on every open', () => {
    expect(buildDemoPack(input())).toEqual(buildDemoPack(input()))
  })

  it('tells different accounts different stories', () => {
    const mine = buildDemoPack(input())
    const theirs = buildDemoPack(input({ telegramId: 700_100_201 }))

    expect(theirs.history).not.toEqual(mine.history)
  })

  it('draws every date back from the moment it is opened, so the story never ages', () => {
    const today = buildDemoPack(input())
    const inThreeDays = buildDemoPack(input({ now: NOW + 3 * DAY_MS }))

    expect(inThreeDays.history.map((entry) => Date.parse(entry.createdAt) - 3 * DAY_MS)).toEqual(
      today.history.map((entry) => Date.parse(entry.createdAt))
    )
    expect(inThreeDays.profile.user.balance).toBe(today.profile.user.balance)
  })

  it('ends a few hours ago, and never in the future', () => {
    const pack = buildDemoPack(input())
    const newest = Date.parse(pack.history[0].createdAt)

    expect(newest).toBeLessThan(NOW)
    expect(NOW - newest).toBeLessThanOrEqual(DemoHistoryShape.LAST_TOP_UP_MAX_HOURS * HOUR_MS)
  })

  /**
   * Nine in the morning to ten at night in Kyiv, every row — the newest one
   * too, which is the first a dashboard shows. A sale at four in the morning is
   * the kind of detail a viewer remembers.
   */
  it.each([
    ['at midday', NOW],
    ['at six in the morning, Kyiv time', Date.UTC(2026, 8, 25, 3, 0)],
    ['just after ten at night, Kyiv time', Date.UTC(2026, 8, 25, 19, 30)]
  ])('keeps the whole history in waking hours, recorded %s', (_, now) => {
    const { history } = buildDemoPack(input({ now }))

    for (const entry of history) {
      const at = Date.parse(entry.createdAt)
      const hour = new Date(at).getUTCHours()

      expect(at).toBeLessThan(now)
      expect(hour).toBeGreaterThanOrEqual(DemoHistoryShape.DAYTIME_START_HOUR_UTC)
      expect(hour).toBeLessThan(
        DemoHistoryShape.DAYTIME_START_HOUR_UTC + DemoHistoryShape.DAYTIME_HOURS
      )
    }
  })

  describe.each(ACCOUNTS)('for account %i', (telegramId) => {
    const pack = buildDemoPack(input({ telegramId }))

    it('shows the balance its history adds up to', () => {
      const added = sum(pack.history.map(balanceMovedBy))

      expect(pack.profile.user.balance).toBe(added)
      expect(pack.saleConfig.balance).toBe(added)
      expect(pack.profile.user.frozenBalance).toBe(0)
    })

    it('never sells more than it held at the time', () => {
      const lowest = oldestFirst(pack).reduce(
        (running, entry) => {
          const balance = running.balance + balanceMovedBy(entry)

          return { balance, lowest: Math.min(running.lowest, balance) }
        },
        { balance: 0, lowest: 0 }
      ).lowest

      expect(lowest).toBeGreaterThanOrEqual(0)
    })

    it('reaches the level its turnover earns', () => {
      const turnover = sum(
        pack.history.flatMap((entry) => (entry.type === 'sale' ? [entry.amount] : []))
      )

      expect(pack.profile.user.totalTurnover).toBe(turnover)
      expect(pack.profile.trustLevel).toBe(getTrustLevel(turnover).level)
      expect(pack.saleConfig.maxParallelOrders).toBe(getTrustLevel(turnover).maxParallelOrders)
    })

    it('prices every sale the way the sale form does', () => {
      for (const { sale } of pack.sales)
        expect(priceStake(sale.frozenUsdt, sale.exchangeRate).targetKopecks).toBe(sale.fiatAmount)
    })

    it('fills every sale, in payments the pipeline would have routed', () => {
      for (const { sale, progress } of pack.sales) {
        const matched = progress.events.filter(
          (event) => event.type === SaleEventType.PAYMENT_MATCHED
        )

        expect(sum(matched.map((event) => event.amount ?? 0))).toBe(sale.fiatAmount)
        expect(progress.events.at(-1)?.type).toBe(SaleEventType.COMPLETED)
        expect(progress.deliveredAmount).toBe(progress.targetAmount)
        expect(progress.canCancel).toBe(false)

        if (sale.saleMethod === SaleMethod.CARD) {
          const orders = progress.cardOrders ?? []

          expect(sum(orders.map((order) => order.amount))).toBe(sale.fiatAmount)
          for (const order of orders)
            expect(order.amount).toBeGreaterThanOrEqual(progress.cardMinOrderKopecks ?? 0)
          expect(sale.payoutCardTail).toMatch(/^\d{4}$/)
        } else {
          for (const payment of matched)
            expect(payment.amount).toBeGreaterThanOrEqual(input().minOrderKopecks)
          expect(progress.jarBalance).toBe(sale.fiatAmount)
        }
      }
    })

    it('pays its referral earnings at the real rate', () => {
      const { referrals, totalEarned, totalVolume } = pack.referral

      for (const referral of referrals)
        expect(referral.earned).toBe(referralRewardCents(referral.soldVolume, 4_681, 0.1))
      expect(totalEarned).toBe(sum(referrals.map((referral) => referral.earned)))
      expect(totalVolume).toBe(sum(referrals.map((referral) => referral.soldVolume)))
      expect(referrals.map((referral) => referral.earned)).toEqual(
        referrals.map((referral) => referral.earned).toSorted((left, right) => right - left)
      )
    })

    it('keeps in the pot what the transfers on its timeline did not move', () => {
      const transferred = sum(
        pack.history.flatMap((entry) =>
          entry.type === 'balance_movement' && entry.kind === BalanceEntryKind.REFERRAL_TRANSFER
            ? [entry.cryptoCents]
            : []
        )
      )

      expect(pack.referral.balance).toBe(pack.referral.totalEarned - transferred)
      expect(pack.referral.balance).toBeGreaterThanOrEqual(0)
      expect(pack.profile.user.referralBalance).toBe(pack.referral.balance)
      expect(pack.profile.user.totalReferralEarned).toBe(pack.referral.totalEarned)
    })

    /**
     * The check a viewer can make with two screens open: the 🎁 rows on the
     * timeline against who had joined by each date. No transfer may move more
     * than everybody who had joined by then has earned in all their time since.
     */
    it('never transfers more than the referrals who had joined could have earned', () => {
      const transfers = oldestFirst(pack).filter(
        (entry) =>
          entry.type === 'balance_movement' && entry.kind === BalanceEntryKind.REFERRAL_TRANSFER
      )

      transfers.reduce((moved, entry) => {
        const movedSoFar = moved + (entry.type === 'balance_movement' ? entry.cryptoCents : 0)
        const couldHaveEarned = sum(
          pack.referral.referrals
            .filter((referral) => referral.joinedAt < entry.createdAt)
            .map((referral) => referral.earned)
        )

        expect(movedSoFar).toBeLessThanOrEqual(couldHaveEarned)

        return movedSoFar
      }, 0)
    })

    it('has a page behind every row a user can open', () => {
      const saleIds = new Set(pack.sales.map(({ sale }) => sale._id))
      const depositIds = new Set(pack.deposits.map((deposit) => deposit._id))
      const topUpIds = new Set(pack.fiatDeposits.map((deposit) => deposit.id))

      for (const entry of pack.history) {
        if (entry.type === 'sale') expect(saleIds.has(entry.id)).toBe(true)
        if (entry.type === 'deposit') expect(depositIds.has(entry.id)).toBe(true)
        if (entry.type === 'fiat_deposit') expect(topUpIds.has(entry.id)).toBe(true)
      }
    })

    it('accounts for every cent it sold on the income page', () => {
      const sold = sum(pack.sales.map(({ sale }) => sale.frozenUsdt))

      expect(pack.income.fromFiat.soldUsdtCents + pack.income.fromOwnUsdt.soldUsdtCents).toBe(sold)
    })

    it('shows a recipient card no bank will send money to', () => {
      expect(pack.recipientCard).toMatch(/^\d{16}$/)
      expect(isLuhnValid(pack.recipientCard)).toBe(false)
    })
  })

  it('quotes the live rates, the real wallet and the ladder everyone sees', () => {
    const pack = buildDemoPack(input())

    expect(pack.saleConfig.sellRate).toBe(4_681)
    expect(pack.fiatOptions.exchangeRate).toBe(4_566)
    expect(pack.depositConfig).toEqual({
      walletAddress: 'T_WALLET_NOT_A_REAL_ADDRESS',
      exchangeRate: 4_566,
      expiryMinutes: 60
    })
    expect(pack.trustLadder).toEqual(trustLadder())
  })

  it('keeps the promoter’s own code and link, so the link recruits for them', () => {
    const { referral } = buildDemoPack(input())

    expect(referral.code).toBe('Z38SL69F')
    expect(referral.link).toBe('deep-link-carrying-Z38SL69F')
    expect(referral.canRedeemCode).toBe(false)
  })

  it('offers top-up amounts cheapest first, with no first-deposit ceiling', () => {
    const { fiatOptions } = buildDemoPack(input())
    const amounts = fiatOptions.options.map((option) => option.amountUah)

    expect(amounts.length).toBeGreaterThan(0)
    expect(amounts).toEqual(amounts.toSorted((left, right) => left - right))
    expect(fiatOptions.maxAmountUah).toBeNull()
    expect(fiatOptions.activeDepositId).toBeNull()
  })
})
