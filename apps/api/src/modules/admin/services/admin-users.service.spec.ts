import { ConflictException, NotFoundException } from '@nestjs/common'
import { AdminAuditAction, ERROR } from '@transacto/contracts'
import { AdminUsersService } from './admin-users.service'
import type { AdminAuditService } from './admin-audit.service'
import type { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaDepositDbService } from 'src/modules/repositories/tma-deposit-db/services'
import type { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import type { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'
import type { DemoAccountService } from 'src/modules/telegram-mini-app/services/demo-account.service'

const TELEGRAM_ID = 700_100_200
const ADMIN = { username: 'operator' }
const IP = '127.0.0.1'

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
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  ...overrides
})

/**
 * The operator's half of a demo switch. Who may become a demo is
 * `DemoAccountService`'s rule; what is pinned here is that the panel audits
 * exactly the switches that happened — no more, and none that were refused.
 */
describe('AdminUsersService.setDemo', () => {
  let users: { findByTelegramId: jest.Mock }
  let demoAccounts: { enable: jest.Mock; disable: jest.Mock }
  let audit: { record: jest.Mock }
  let gateway: { emit: jest.Mock }
  let service: AdminUsersService

  beforeEach(() => {
    users = { findByTelegramId: jest.fn().mockResolvedValue(storedUser()) }
    demoAccounts = {
      enable: jest.fn().mockResolvedValue(storedUser({ isDemo: true })),
      disable: jest.fn().mockResolvedValue(storedUser({ isDemo: false }))
    }
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    gateway = { emit: jest.fn() }

    service = new AdminUsersService(
      users as unknown as TmaUserDbService,
      { countOpenByTelegramIds: jest.fn().mockResolvedValue({}) } as unknown as TmaSaleDbService,
      {} as TmaDepositDbService,
      {} as TmaReferralDbService,
      audit as unknown as AdminAuditService,
      gateway as unknown as AdminGateway,
      {} as BalanceLedgerService,
      demoAccounts as unknown as DemoAccountService
    )
  })

  const setDemo = (isDemo: boolean) =>
    service.setDemo(TELEGRAM_ID, { isDemo, reason: 'рекламна кампанія' }, ADMIN, IP)

  it('switches through the service that owns the rule, audits it and pushes the row', async () => {
    const row = await setDemo(true)

    expect(demoAccounts.enable).toHaveBeenCalledWith(TELEGRAM_ID)
    expect(row.isDemo).toBe(true)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.USER_DEMO_ENABLED,
        targetId: String(TELEGRAM_ID),
        reason: 'рекламна кампанія'
      })
    )
    expect(gateway.emit).toHaveBeenCalled()
  })

  it('switches back the same way', async () => {
    users.findByTelegramId.mockResolvedValue(storedUser({ isDemo: true }))

    const row = await setDemo(false)

    expect(demoAccounts.disable).toHaveBeenCalledWith(TELEGRAM_ID)
    expect(row.isDemo).toBe(false)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AdminAuditAction.USER_DEMO_DISABLED })
    )
  })

  /**
   * A stale row, or two operators at once: the account is already where the
   * switch would put it. The trail must not claim a decision that never took
   * effect — it is the only record of whose campaign an account was for.
   */
  it.each([
    ['on', true],
    ['off', false]
  ])('records nothing when the demo is already %s', async (_, isDemo) => {
    users.findByTelegramId.mockResolvedValue(storedUser({ isDemo }))

    const row = await setDemo(isDemo)

    expect(row.isDemo).toBe(isDemo)
    expect(demoAccounts.enable).not.toHaveBeenCalled()
    expect(demoAccounts.disable).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
    expect(gateway.emit).not.toHaveBeenCalled()
  })

  it('audits nothing the rule refused', async () => {
    demoAccounts.enable.mockRejectedValue(new ConflictException(ERROR.ADMIN.DEMO_ACCOUNT_NOT_EMPTY))

    await expect(setDemo(true)).rejects.toBeInstanceOf(ConflictException)
    expect(audit.record).not.toHaveBeenCalled()
    expect(gateway.emit).not.toHaveBeenCalled()
  })

  it('reports an unknown account as one', async () => {
    users.findByTelegramId.mockResolvedValue(null)

    await expect(setDemo(true)).rejects.toBeInstanceOf(NotFoundException)
  })
})
