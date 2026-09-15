import {
  AdminAuditAction,
  AdminAuditTargetType,
  BalanceEntryKind,
  TerminalHistoryAlertType
} from '@transacto/contracts'
import { RenameScrollOrdersToSalesMigration } from './0004-rename-scroll-orders-to-sales.migration'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaBalanceEntryDbService } from 'src/modules/repositories/tma-balance-entry-db/services'
import type { TmaReferralDbService } from 'src/modules/repositories/tma-referral-db/services'
import type { AdminAuditLogDbService } from 'src/modules/repositories/admin-db/services'
import type { TerminalHistoryDbService } from 'src/modules/repositories/terminal-history-db/services'

/**
 * The one run this migration gets.
 *
 * It carries the whole product across a rename, on a database where the old
 * names are the only names — so what it must be tested for is not "does the
 * arithmetic add up" but "does it ask for the right old name, in the right
 * places, and does it leave the ones it cannot finish alone".
 *
 * Every old name below is written out as a literal rather than derived, which
 * is the point: the migration derives them, and a test that derived them the
 * same way would agree with a bug.
 */
describe('0004-rename-scroll-orders-to-sales', () => {
  let sales: { adoptLegacyCollection: jest.Mock }
  let entries: { renameKind: jest.Mock }
  let referrals: { renameLegacySaleIdField: jest.Mock }
  let audit: { renameEnumValue: jest.Mock }
  let history: { renameAlertType: jest.Mock }
  let migration: RenameScrollOrdersToSalesMigration

  /** What each rename was asked to look for, in call order. */
  const askedFor = (mock: jest.Mock, argument = 0): unknown[] =>
    mock.mock.calls.map((call) => call[argument])

  beforeEach(() => {
    sales = { adoptLegacyCollection: jest.fn().mockResolvedValue(true) }
    entries = { renameKind: jest.fn().mockResolvedValue(0) }
    referrals = { renameLegacySaleIdField: jest.fn().mockResolvedValue(0) }
    audit = { renameEnumValue: jest.fn().mockResolvedValue(0) }
    history = { renameAlertType: jest.fn().mockResolvedValue(0) }

    migration = new RenameScrollOrdersToSalesMigration(
      sales as unknown as TmaSaleDbService,
      entries as unknown as TmaBalanceEntryDbService,
      referrals as unknown as TmaReferralDbService,
      audit as unknown as AdminAuditLogDbService,
      history as unknown as TerminalHistoryDbService
    )
  })

  it('asks for both of the balance book’s old kinds', async () => {
    await migration.up()

    expect(askedFor(entries.renameKind)).toEqual(['SCROLL_ORDER_STAKE', 'SCROLL_ORDER_REFUND'])
    expect(askedFor(entries.renameKind, 1)).toEqual([
      BalanceEntryKind.SALE_STAKE,
      BalanceEntryKind.SALE_REFUND
    ])
  })

  it('asks for every one of the audit log’s old actions', async () => {
    await migration.up()

    const actions = audit.renameEnumValue.mock.calls.filter(([field]) => field === 'action')

    expect(actions.map(([, from]) => from)).toEqual([
      'SCROLL_ORDER_CANCELLED',
      'SCROLL_ORDER_BLOCKED',
      'SCROLL_ORDER_COMPLETED',
      'SCROLL_ORDER_RESUMED',
      'SCROLL_ORDER_RELEASED',
      'SCROLL_ORDER_JAR_RELEASED'
    ])
    expect(actions).toHaveLength(Object.values(AdminAuditAction).filter(isSaleAction).length)
  })

  /**
   * The column that was missed the first time — one field over from `action`, in
   * the same collection, rendered the same way.
   */
  it('migrates the audit log’s target type as well as its actions', async () => {
    await migration.up()

    expect(audit.renameEnumValue).toHaveBeenCalledWith(
      'targetType',
      'SCROLL_ORDER',
      AdminAuditTargetType.SALE
    )
  })

  it('asks for the terminal history’s old alert name', async () => {
    await migration.up()

    expect(history.renameAlertType).toHaveBeenCalledWith(
      'SCROLL_ORDER_COMPLETED',
      TerminalHistoryAlertType.SALE_COMPLETED
    )
  })

  /**
   * The collection decides whether the app can see anything at all, and the
   * referral field is the one with money behind it — so neither may be skipped
   * by a run that reaches the cosmetic steps.
   */
  it('moves the collection and the referral field before anything else', async () => {
    await migration.up()

    expect(sales.adoptLegacyCollection).toHaveBeenCalled()
    expect(referrals.renameLegacySaleIdField).toHaveBeenCalled()
    expect(sales.adoptLegacyCollection.mock.invocationCallOrder[0]).toBeLessThan(
      referrals.renameLegacySaleIdField.mock.invocationCallOrder[0]
    )
    expect(referrals.renameLegacySaleIdField.mock.invocationCallOrder[0]).toBeLessThan(
      entries.renameKind.mock.invocationCallOrder[0]
    )
  })

  /** A step that cannot finish stops the run; the record is written after the work. */
  it('does not report success when a step throws', async () => {
    referrals.renameLegacySaleIdField.mockRejectedValue(new Error('E11000 duplicate key'))

    await expect(migration.up()).rejects.toThrow('E11000')
    expect(entries.renameKind).not.toHaveBeenCalled()
  })

  it('counts what every step moved', async () => {
    sales.adoptLegacyCollection.mockResolvedValue(true)
    referrals.renameLegacySaleIdField.mockResolvedValue(2)
    entries.renameKind.mockResolvedValue(5)
    audit.renameEnumValue.mockResolvedValue(1)
    history.renameAlertType.mockResolvedValue(3)

    const summary = await migration.up()

    // Two kinds at five each, six actions at one each, one target, three alerts.
    expect(summary).toContain('2 referral payout(s)')
    expect(summary).toContain('10 balance entr(ies)')
    expect(summary).toContain('6 audit action(s)')
    expect(summary).toContain('3 terminal alert(s)')
    expect(summary).toContain('collection moved')
  })

  /** A second run finds a database already renamed, and says so rather than failing. */
  it('reports the collection as already moved on a re-run', async () => {
    sales.adoptLegacyCollection.mockResolvedValue(false)

    await expect(migration.up()).resolves.toContain('collection already moved')
  })

  it('never changes its own name', () => {
    expect(migration.name).toBe('0004-rename-scroll-orders-to-sales')
  })
})

/** The audit actions the rename touched — everything but the deposit ones. */
const isSaleAction = (action: AdminAuditAction): boolean => action.startsWith('SALE_')
