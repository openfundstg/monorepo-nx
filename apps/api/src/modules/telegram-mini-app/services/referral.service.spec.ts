import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ReferralService } from './referral.service'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import type { BalanceLedgerService } from './balance-ledger.service'

const REFERRER_ID = 111
const REFERRED_ID = 222

/** ₴46.52 per USDT, the configured production rate, in kopecks. */
const RATE = 4652

const storedUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-1' },
  telegramId: REFERRER_ID,
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
  balance: 0,
  frozenBalance: 0,
  totalTurnover: 0,
  isActive: true,
  referralCode: 'Z38SL69F',
  referredBy: null,
  referralBalance: 0,
  totalReferralEarned: 0,
  showNameToReferrer: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

const storedOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'order-1' },
  publicId: 'ABCD1234',
  telegramId: REFERRED_ID,
  fiatAmount: 1_000_000,
  exchangeRate: RATE,
  ...overrides,
})

describe('ReferralService', () => {
  let users: {
    findByTelegramId: jest.Mock
    findByReferralCode: jest.Mock
    findByReferrer: jest.Mock
    ensureReferralCode: jest.Mock
    bindReferrer: jest.Mock
    creditReferralBalance: jest.Mock
    transferReferralToBalance: jest.Mock
    setNameVisibility: jest.Mock
  }
  let earnings: { record: jest.Mock; sumByReferred: jest.Mock }
  let orders: { countCompletedByTelegramId: jest.Mock }
  let gateway: { emitBalanceUpdated: jest.Mock; emitReferralBalanceUpdated: jest.Mock }
  let balanceLedger: { transferReferral: jest.Mock }
  let service: ReferralService

  const env = { ...process.env }

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
    process.env.TELEGRAM_BOT_USERNAME = 'transacto_bot'
    delete process.env.REFERRAL_RATE_PERCENT

    users = {
      findByTelegramId: jest.fn().mockResolvedValue(storedUser()),
      findByReferralCode: jest.fn().mockResolvedValue(null),
      findByReferrer: jest.fn().mockResolvedValue([]),
      ensureReferralCode: jest.fn(async (user: unknown) => user),
      bindReferrer: jest.fn().mockResolvedValue(storedUser()),
      creditReferralBalance: jest
        .fn()
        .mockResolvedValue({ referralBalance: 21, totalReferralEarned: 21 }),
      setNameVisibility: jest.fn().mockResolvedValue(undefined),
    }
    earnings = {
      record: jest.fn().mockResolvedValue({ _id: { toString: () => 'earning-1' } }),
      sumByReferred: jest.fn().mockResolvedValue([]),
    }
    orders = { countCompletedByTelegramId: jest.fn().mockResolvedValue(0) }
    gateway = { emitBalanceUpdated: jest.fn(), emitReferralBalanceUpdated: jest.fn() }
    // The transfer moves money onto the spendable balance, so it goes through
    // the book rather than straight at the repository.
    balanceLedger = {
      transferReferral: jest.fn().mockResolvedValue({ referralBalance: 0, balance: 21 }),
    }

    service = new ReferralService(
      users as unknown as TmaUserDbService,
      earnings as unknown as TmaReferralDbService,
      orders as unknown as TmaSaleDbService,
      gateway as unknown as TmaGateway,
      balanceLedger as unknown as BalanceLedgerService,
    )
  })

  afterEach(() => {
    process.env = { ...env }
  })

  describe('creditForSale', () => {
    /**
     * The headline number of the whole feature. ₴10 000,00 sold at 0.1% is
     * ₴10,00 of reward, which at ₴46.52/USDT is 0.21 USDT — 21 cents.
     *
     * Pinned because the arithmetic collapses a ×100 against a ÷100 and so
     * *looks* like it is missing a conversion; an "obvious" correction here
     * would silently move every payout by two orders of magnitude.
     */
    it('pays 0.1% of the sold volume, converted at the order rate', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referredBy: REFERRER_ID }),
      )

      await service.creditForSale(storedOrder() as never)

      expect(earnings.record).toHaveBeenCalledWith(
        expect.objectContaining({
          referrerTelegramId: REFERRER_ID,
          referredTelegramId: REFERRED_ID,
          amount: 21,
          fiatAmount: 1_000_000,
          exchangeRate: RATE,
          ratePercent: 0.1,
        }),
      )
      expect(users.creditReferralBalance).toHaveBeenCalledWith(REFERRER_ID, 21)
    })

    it('pays nothing when the seller has no referrer', async () => {
      users.findByTelegramId.mockResolvedValue(storedUser({ referredBy: null }))

      await service.creditForSale(storedOrder() as never)

      expect(earnings.record).not.toHaveBeenCalled()
      expect(users.creditReferralBalance).not.toHaveBeenCalled()
    })

    /**
     * The ledger's unique index on `saleId` is the idempotency key. A
     * `null` from `record` means this order already paid, and the balance must
     * not move again — otherwise a re-entered completion path pays twice.
     */
    it('does not credit twice when the order already produced a payout', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referredBy: REFERRER_ID }),
      )
      earnings.record.mockResolvedValue(null)

      await service.creditForSale(storedOrder() as never)

      expect(users.creditReferralBalance).not.toHaveBeenCalled()
    })

    it('skips sub-cent cuts rather than recording a zero row', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referredBy: REFERRER_ID }),
      )

      // ₴1,00 at 0.1% is a fiftieth of a cent.
      await service.creditForSale(storedOrder({ fiatAmount: 100 }) as never)

      expect(earnings.record).not.toHaveBeenCalled()
    })

    /**
     * This runs after the user's own frozen balance has already been committed,
     * so throwing here would report a settled sale as a failure.
     */
    it('never throws, whatever the database does', async () => {
      users.findByTelegramId.mockRejectedValue(new Error('mongo is down'))

      await expect(service.creditForSale(storedOrder() as never)).resolves.toBeUndefined()
    })

    it('leaves the balance alone when the ledger row was written but the credit failed', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referredBy: REFERRER_ID }),
      )
      users.creditReferralBalance.mockRejectedValue(new Error('write concern'))

      await expect(service.creditForSale(storedOrder() as never)).resolves.toBeUndefined()
      expect(gateway.emitReferralBalanceUpdated).not.toHaveBeenCalled()
    })
  })

  describe('redeemCode', () => {
    it('binds the caller to the code owner', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referralCode: 'MYOWNCOD' }),
      )
      users.findByReferralCode.mockResolvedValue(storedUser({ telegramId: REFERRER_ID }))

      await service.redeemCode(REFERRED_ID, 'Z38SL69F')

      expect(users.bindReferrer).toHaveBeenCalledWith(REFERRED_ID, REFERRER_ID)
    })

    it('refuses a caller who already has a referrer', async () => {
      users.findByTelegramId.mockResolvedValue(storedUser({ referredBy: 999 }))

      await expect(service.redeemCode(REFERRED_ID, 'Z38SL69F')).rejects.toBeInstanceOf(
        ConflictException,
      )
    })

    it('refuses the caller their own code', async () => {
      users.findByTelegramId.mockResolvedValue(storedUser({ referralCode: 'Z38SL69F' }))

      await expect(service.redeemCode(REFERRER_ID, 'Z38SL69F')).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    /**
     * Without this an established account could be moved under a referrer once
     * its volume — and therefore the cut it would generate — is already known.
     */
    it('refuses a caller who has already completed a sale', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referralCode: 'MYOWNCOD' }),
      )
      orders.countCompletedByTelegramId.mockResolvedValue(1)

      await expect(service.redeemCode(REFERRED_ID, 'Z38SL69F')).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(users.bindReferrer).not.toHaveBeenCalled()
    })

    it('rejects a code nobody owns', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referralCode: 'MYOWNCOD' }),
      )
      users.findByReferralCode.mockResolvedValue(null)

      await expect(service.redeemCode(REFERRED_ID, 'NOSUCHCD')).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    /** Two taps on the button race; only the first may bind. */
    it('reports a lost race as already-referred rather than succeeding', async () => {
      users.findByTelegramId.mockResolvedValue(
        storedUser({ telegramId: REFERRED_ID, referralCode: 'MYOWNCOD' }),
      )
      users.findByReferralCode.mockResolvedValue(storedUser({ telegramId: REFERRER_ID }))
      users.bindReferrer.mockResolvedValue(null)

      await expect(service.redeemCode(REFERRED_ID, 'Z38SL69F')).rejects.toBeInstanceOf(
        ConflictException,
      )
    })
  })

  describe('bindFromStartParam', () => {
    it('binds a user who arrived through a link', async () => {
      users.findByReferralCode.mockResolvedValue(storedUser({ telegramId: REFERRER_ID }))

      await service.bindFromStartParam(REFERRED_ID, 'Z38SL69F')

      expect(users.bindReferrer).toHaveBeenCalledWith(REFERRED_ID, REFERRER_ID)
    })

    it('ignores a code that matches nobody', async () => {
      users.findByReferralCode.mockResolvedValue(null)

      await service.bindFromStartParam(REFERRED_ID, 'GARBAGE1')

      expect(users.bindReferrer).not.toHaveBeenCalled()
    })

    it('ignores a user linking to themselves', async () => {
      users.findByReferralCode.mockResolvedValue(storedUser({ telegramId: REFERRED_ID }))

      await service.bindFromStartParam(REFERRED_ID, 'Z38SL69F')

      expect(users.bindReferrer).not.toHaveBeenCalled()
    })

    /** This runs inside authentication — a bad code must not block a login. */
    it('never throws', async () => {
      users.findByReferralCode.mockRejectedValue(new Error('mongo is down'))

      await expect(service.bindFromStartParam(REFERRED_ID, 'Z38SL69F')).resolves.toBeUndefined()
    })
  })

  describe('transferToBalance', () => {
    it('moves the money and announces both balances', async () => {
      const result = await service.transferToBalance(REFERRER_ID, 21)

      expect(balanceLedger.transferReferral).toHaveBeenCalledWith(REFERRER_ID, 21)
      expect(result).toEqual({ referralBalance: 0, balance: 21 })
      // The dashboard renders the spendable balance and the referral page the
      // other; a client sitting on either must see its figure move.
      expect(gateway.emitBalanceUpdated).toHaveBeenCalledWith(REFERRER_ID, 21)
      expect(gateway.emitReferralBalanceUpdated).toHaveBeenCalledTimes(1)
    })

    it.each([0, -100, 12.5])('rejects %p as an amount', async (amount) => {
      await expect(service.transferToBalance(REFERRER_ID, amount)).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(balanceLedger.transferReferral).not.toHaveBeenCalled()
    })
  })

  describe('getSummary', () => {
    const invited = [
      storedUser({
        telegramId: 301,
        username: 'zoe',
        showNameToReferrer: true,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
      storedUser({
        telegramId: 302,
        username: 'hidden',
        showNameToReferrer: false,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      }),
      storedUser({
        telegramId: 303,
        username: 'newcomer',
        showNameToReferrer: true,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      }),
    ]

    beforeEach(() => {
      users.findByReferrer.mockResolvedValue(invited)
      earnings.sumByReferred.mockResolvedValue([
        { referredTelegramId: 302, earned: 900, soldVolume: 40_000_000 },
        { referredTelegramId: 301, earned: 100, soldVolume: 5_000_000 },
      ])
    })

    it('sorts by earnings, with people who never sold last', async () => {
      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.referrals.map((entry) => entry.earned)).toEqual([900, 100, 0])
    })

    it('hides the name of anyone who did not opt in, but keeps their earnings', async () => {
      const summary = await service.getSummary(REFERRER_ID)

      const [top, second] = summary.referrals
      expect(top.displayName).toBeNull()
      expect(top.earned).toBe(900)
      expect(top.maskedId).toMatch(/^[0-9A-F]{6}$/)
      expect(second.displayName).toBe('@zoe')
    })

    /** The label has to survive a reload, or the list reshuffles identities. */
    it('gives the same referral the same masked id every time', async () => {
      const [first, second] = await Promise.all([
        service.getSummary(REFERRER_ID),
        service.getSummary(REFERRER_ID),
      ])

      expect(first.referrals[0].maskedId).toBe(second.referrals[0].maskedId)
    })

    /** Two referrers sharing a referral must not be able to compare notes. */
    it('gives different referrers different masked ids for the same person', async () => {
      const mine = await service.getSummary(REFERRER_ID)

      users.findByTelegramId.mockResolvedValue(storedUser({ telegramId: 999 }))
      const theirs = await service.getSummary(999)

      expect(mine.referrals[0].maskedId).not.toBe(theirs.referrals[0].maskedId)
    })

    it('builds a startapp deep link, not a bot-chat link', async () => {
      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.link).toBe('https://t.me/transacto_bot?startapp=Z38SL69F')
    })

    it('tolerates the bot username being configured with an @', async () => {
      process.env.TELEGRAM_BOT_USERNAME = '@transacto_bot'

      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.link).toBe('https://t.me/transacto_bot?startapp=Z38SL69F')
    })

    it('closes manual redemption once the caller has a referrer', async () => {
      users.findByTelegramId.mockResolvedValue(storedUser({ referredBy: 777 }))

      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.canRedeemCode).toBe(false)
      // Echoed back as the code they joined with, never as a person.
      expect(summary.invitedBy).toBe('Z38SL69F')
    })

    it('closes manual redemption once the caller has sold', async () => {
      orders.countCompletedByTelegramId.mockResolvedValue(1)

      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.canRedeemCode).toBe(false)
    })

    it('totals the volume across every referral', async () => {
      const summary = await service.getSummary(REFERRER_ID)

      expect(summary.totalVolume).toBe(45_000_000)
    })
  })
})
