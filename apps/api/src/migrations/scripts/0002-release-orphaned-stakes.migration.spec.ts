import { ReleaseOrphanedStakesMigration } from './0002-release-orphaned-stakes.migration'
import type { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'

const TELEGRAM_ID = 5838773913

/** One page of users, then nothing — what `findPage` does at the end of a walk. */
const onePage = <T>(items: T[]) => jest.fn().mockResolvedValue({ items, total: items.length })

describe('0002-release-orphaned-stakes', () => {
  let users: { findPage: jest.Mock }
  let sales: { sumFrozenStakesByTelegramId: jest.Mock }
  let ledger: { refund: jest.Mock }
  let migration: ReleaseOrphanedStakesMigration

  const withFrozen = (frozenBalance: number, liveStakes: number) => {
    users.findPage = onePage([{ telegramId: TELEGRAM_ID, frozenBalance }])
    sales.sumFrozenStakesByTelegramId.mockResolvedValue(liveStakes)
  }

  beforeEach(() => {
    users = { findPage: onePage([]) }
    sales = { sumFrozenStakesByTelegramId: jest.fn().mockResolvedValue(0) }
    ledger = { refund: jest.fn().mockResolvedValue(undefined) }

    migration = new ReleaseOrphanedStakesMigration(
      users as unknown as TmaUserDbService,
      sales as unknown as TmaSaleDbService,
      ledger as unknown as BalanceLedgerService
    )
  })

  /** The reported case: a stake frozen for an order Mongoose then refused. */
  it('gives back everything no live order accounts for', async () => {
    withFrozen(14_247, 0)

    await expect(migration.up()).resolves.toContain('14247')
    expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, 14_247)
  })

  /** Only the difference: the running order's own stake stays frozen. */
  it('leaves the stakes of live orders alone', async () => {
    withFrozen(14_247, 10_000)

    await migration.up()

    expect(ledger.refund).toHaveBeenCalledWith(TELEGRAM_ID, 4_247)
  })

  it('touches nothing when the two figures agree', async () => {
    withFrozen(10_000, 10_000)

    await migration.up()

    expect(ledger.refund).not.toHaveBeenCalled()
  })

  /**
   * Less frozen than the open orders claim is a different fault, and
   * unfreezing is not its fix — it is reported and left exactly as it is.
   */
  it('never freezes anything to make the books agree', async () => {
    withFrozen(5_000, 10_000)

    await expect(migration.up()).resolves.toContain('1 left short')
    expect(ledger.refund).not.toHaveBeenCalled()
  })

  /** After a pass the two agree, so a second pass has nothing to do. */
  it('is safe to run twice', async () => {
    withFrozen(14_247, 0)
    await migration.up()

    withFrozen(0, 0)
    ledger.refund.mockClear()
    await migration.up()

    expect(ledger.refund).not.toHaveBeenCalled()
  })

  /** Money already handed back cannot be taken away again. */
  it('cannot be reversed', () => {
    expect((migration as { down?: unknown }).down).toBeUndefined()
  })
})
