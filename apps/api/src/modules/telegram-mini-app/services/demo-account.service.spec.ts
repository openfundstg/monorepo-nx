import { ConflictException, NotFoundException } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import { DemoAccountService } from './demo-account.service'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaFiatDepositDbService } from 'src/modules/repositories/tma-fiat-deposit-db/services'

const TELEGRAM_ID = 700_100_200

const storedUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-1' },
  telegramId: TELEGRAM_ID,
  firstName: 'Олена',
  lastName: '',
  username: '',
  balance: 0,
  frozenBalance: 0,
  totalTurnover: 0,
  isActive: true,
  isDemo: false,
  referralCode: 'Z38SL69F',
  referredBy: null,
  referralBalance: 0,
  totalReferralEarned: 0,
  showNameToReferrer: false,
  ...overrides
})

/**
 * A demo account shows its owner invented figures and refuses everything they
 * send, so the rule pinned here is **which accounts may become one**: none that
 * holds money, runs a sale, or is waiting on a payment it would then be
 * unable to claim.
 */
describe('DemoAccountService', () => {
  let users: {
    findByTelegramId: jest.Mock
    isDemo: jest.Mock
    markDemoIfEmpty: jest.Mock
    unmarkDemo: jest.Mock
  }
  let sales: { countOpenByTelegramIds: jest.Mock }
  let deposits: { hasPending: jest.Mock }
  let topUps: { findActiveByTelegramId: jest.Mock }
  let service: DemoAccountService

  beforeEach(() => {
    users = {
      findByTelegramId: jest.fn().mockResolvedValue(storedUser()),
      isDemo: jest.fn().mockResolvedValue(false),
      markDemoIfEmpty: jest.fn().mockResolvedValue(storedUser({ isDemo: true })),
      unmarkDemo: jest.fn().mockResolvedValue(storedUser({ isDemo: false }))
    }
    sales = { countOpenByTelegramIds: jest.fn().mockResolvedValue({}) }
    deposits = { hasPending: jest.fn().mockResolvedValue(false) }
    topUps = { findActiveByTelegramId: jest.fn().mockResolvedValue(null) }

    service = new DemoAccountService(
      users as unknown as TmaUserDbService,
      sales as unknown as TmaSaleDbService,
      deposits as unknown as TmaDepositDbService,
      topUps as unknown as TmaFiatDepositDbService
    )
  })

  const refused = { response: ERROR.ADMIN.DEMO_ACCOUNT_NOT_EMPTY }

  it('switches an empty account over', async () => {
    await expect(service.enable(TELEGRAM_ID)).resolves.toMatchObject({ isDemo: true })
    expect(users.markDemoIfEmpty).toHaveBeenCalledWith(TELEGRAM_ID)
    expect(users.unmarkDemo).not.toHaveBeenCalled()
  })

  it.each([
    ['money on the balance', { balance: 1 }],
    ['a stake frozen in a sale', { frozenBalance: 1 }]
  ])('refuses an account with %s, and never writes', async (_, figures) => {
    users.findByTelegramId.mockResolvedValue(storedUser(figures))

    await expect(service.enable(TELEGRAM_ID)).rejects.toMatchObject(refused)
    expect(users.markDemoIfEmpty).not.toHaveBeenCalled()
  })

  it('refuses an account with a sale holding a slot', async () => {
    sales.countOpenByTelegramIds.mockResolvedValue({ [TELEGRAM_ID]: 1 })

    await expect(service.enable(TELEGRAM_ID)).rejects.toMatchObject(refused)
    expect(users.markDemoIfEmpty).not.toHaveBeenCalled()
  })

  it('refuses when money arrived between the check and the write', async () => {
    users.markDemoIfEmpty.mockResolvedValue(null)

    await expect(service.enable(TELEGRAM_ID)).rejects.toBeInstanceOf(ConflictException)
  })

  /**
   * Reserving a top-up and announcing a deposit move no balance, so the write's
   * own filter cannot see either. They are looked for once the flag is down —
   * the guard refuses new ones from then on — and the flag goes back up.
   */
  it.each([
    [
      'a hryvnia top-up waiting on its receipt',
      () => topUps.findActiveByTelegramId.mockResolvedValue({ id: 'top-up-1' })
    ],
    ['a USDT deposit waiting on its transfer', () => deposits.hasPending.mockResolvedValue(true)]
  ])('refuses an account with %s, and puts the flag back', async (_, inFlight) => {
    inFlight()

    await expect(service.enable(TELEGRAM_ID)).rejects.toMatchObject(refused)
    expect(users.unmarkDemo).toHaveBeenCalledWith(TELEGRAM_ID)
  })

  it('looks for payments in flight only once the flag is down', async () => {
    await service.enable(TELEGRAM_ID)

    const marked = users.markDemoIfEmpty.mock.invocationCallOrder[0]

    expect(marked).toBeLessThan(topUps.findActiveByTelegramId.mock.invocationCallOrder[0])
    expect(marked).toBeLessThan(deposits.hasPending.mock.invocationCallOrder[0])
  })

  it('lets a referral pot through — it cannot fund anything until it is moved', async () => {
    users.findByTelegramId.mockResolvedValue(storedUser({ referralBalance: 1_234 }))

    await expect(service.enable(TELEGRAM_ID)).resolves.toMatchObject({ isDemo: true })
  })

  /**
   * Returned as it stands, and — the reason this matters — never rolled back:
   * a flag put down by somebody else must not be lifted by a repeat of theirs.
   */
  it('leaves an account that already is one exactly as it is', async () => {
    users.findByTelegramId.mockResolvedValue(storedUser({ isDemo: true }))
    topUps.findActiveByTelegramId.mockResolvedValue({ id: 'top-up-1' })

    await expect(service.enable(TELEGRAM_ID)).resolves.toMatchObject({ isDemo: true })
    expect(users.markDemoIfEmpty).not.toHaveBeenCalled()
    expect(users.unmarkDemo).not.toHaveBeenCalled()
  })

  it('always switches an account back', async () => {
    await expect(service.disable(TELEGRAM_ID)).resolves.toMatchObject({ isDemo: false })
  })

  it('reports an unknown account as one, either way', async () => {
    users.findByTelegramId.mockResolvedValue(null)
    users.unmarkDemo.mockResolvedValue(null)

    await expect(service.enable(TELEGRAM_ID)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.disable(TELEGRAM_ID)).rejects.toBeInstanceOf(NotFoundException)
  })
})
