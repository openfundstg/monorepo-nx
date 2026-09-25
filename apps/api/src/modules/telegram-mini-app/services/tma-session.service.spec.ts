import { TrustLevel, type TmaDemoPack } from '@transacto/contracts'
import { TmaSessionService } from './tma-session.service'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { ReferralService } from './referral.service'
import type { DemoPackService } from './demo-pack.service'

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

/** Only the fields the session reads off a pack; the rest is the generator's business. */
const pack = {
  profile: {
    user: { ...storedUser(), balance: 49_382, totalTurnover: 17_492_900 },
    trustLevel: TrustLevel.EXPERIENCED,
    maxParallelOrders: 3,
    slotsAwaitingJarClosure: []
  }
} as unknown as TmaDemoPack

const telegramUser = { id: TELEGRAM_ID, first_name: 'Олена' }

describe('TmaSessionService', () => {
  let users: { findOrCreate: jest.Mock }
  let referrals: { bindFromStartParam: jest.Mock }
  let demoPacks: { build: jest.Mock }
  let service: TmaSessionService

  beforeEach(() => {
    users = {
      findOrCreate: jest.fn().mockResolvedValue({ user: storedUser(), isNewUser: false })
    }
    referrals = { bindFromStartParam: jest.fn().mockResolvedValue(undefined) }
    demoPacks = { build: jest.fn().mockResolvedValue(pack) }

    service = new TmaSessionService(
      users as unknown as TmaUserDbService,
      referrals as unknown as ReferralService,
      demoPacks as unknown as DemoPackService
    )
  })

  it('opens an ordinary account onto its own figures, and says nothing about demos', async () => {
    const session = await service.open(telegramUser, undefined)

    expect(session.user.balance).toBe(0)
    expect(session.trustLevel.level).toBe(TrustLevel.NEWBIE)
    // Absent rather than `undefined`: a key every client received would tell
    // anyone reading their own traffic that the mode exists.
    expect('demo' in session).toBe(false)
    expect(demoPacks.build).not.toHaveBeenCalled()
  })

  it('opens a demo account onto its pack, profile and level included', async () => {
    users.findOrCreate.mockResolvedValue({ user: storedUser({ isDemo: true }), isNewUser: false })

    const session = await service.open(telegramUser, undefined)

    expect(session.demo).toBe(pack)
    expect(session.user.balance).toBe(49_382)
    expect(session.trustLevel).toEqual({ level: TrustLevel.EXPERIENCED, maxParallelOrders: 3 })
  })

  it('opens a demo account as itself when its pack cannot be built, rather than not at all', async () => {
    users.findOrCreate.mockResolvedValue({ user: storedUser({ isDemo: true }), isNewUser: false })
    demoPacks.build.mockRejectedValue(new Error('rate unavailable'))

    const session = await service.open(telegramUser, undefined)

    expect(session.user.balance).toBe(0)
    expect('demo' in session).toBe(false)
  })

  it('still binds a first-time user to the link they arrived through', async () => {
    users.findOrCreate.mockResolvedValue({ user: storedUser(), isNewUser: true })

    await service.open(telegramUser, 'Z38SL69F')

    expect(referrals.bindFromStartParam).toHaveBeenCalledWith(TELEGRAM_ID, 'Z38SL69F')
  })

  it('binds nobody on a later open, whatever link it came through', async () => {
    await service.open(telegramUser, 'Z38SL69F')

    expect(referrals.bindFromStartParam).not.toHaveBeenCalled()
  })
})
