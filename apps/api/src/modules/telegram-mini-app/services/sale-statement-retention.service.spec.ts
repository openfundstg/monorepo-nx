import { Types } from 'mongoose'
import { BankProvider, SaleStatementStatus } from '@transacto/contracts'
import { SaleStatementRetentionService } from './sale-statement-retention.service'

const DAY_MS = 24 * 60 * 60 * 1000

const statement = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  bank: BankProvider.MONO,
  status: SaleStatementStatus.ACCEPTED,
  rejection: null,
  storedName: `${new Types.ObjectId().toHexString()}.pdf`,
  sizeBytes: 1_024,
  uploadedAt: new Date(Date.now() - 200 * DAY_MS),
  purgedAt: null,
  periodFrom: null,
  periodTo: null,
  ownerName: null,
  accountTail: null,
  ...over
})

const sale = (statements: readonly unknown[]) => ({
  _id: { toString: () => '68e1f2a3b4c5d6e7f8a9b0c1' },
  publicId: 'Z38SL69F',
  cardOrders: [{ orderId: 1, statements }]
})

/**
 * The one sweep here whose purpose is to destroy data, so what it is tested for
 * is restraint and order: that it takes only what is past its time, and that a
 * row is never marked purged before the file it names has actually gone.
 */
describe('SaleStatementRetentionService', () => {
  let saleDb: Record<string, jest.Mock>
  let storage: Record<string, jest.Mock>
  let service: SaleStatementRetentionService

  beforeEach(() => {
    saleDb = {
      findSalesWithStatementsBefore: jest.fn(async () => []),
      markStatementPurged: jest.fn(async () => true)
    }
    storage = { remove: jest.fn(async () => undefined) }
    service = new SaleStatementRetentionService(saleDb as never, storage as never)
  })

  afterEach(() => {
    delete process.env.SALE_STATEMENT_RETENTION_DAYS
  })

  it('deletes the file and then records the purge', async () => {
    const old = statement()
    saleDb.findSalesWithStatementsBefore.mockResolvedValue([sale([old])])

    await service.purgeExpiredStatements()

    expect(storage.remove).toHaveBeenCalledWith(old.storedName)
    expect(saleDb.markStatementPurged).toHaveBeenCalled()
    // **The order is the point.** A row marked purged while the file is still on
    // disk is a document nothing points at and nothing will ever remove.
    expect(storage.remove.mock.invocationCallOrder[0]).toBeLessThan(
      saleDb.markStatementPurged.mock.invocationCallOrder[0]
    )
  })

  it('records nothing when the file could not be removed', async () => {
    storage.remove.mockRejectedValue(new Error('read-only volume'))
    saleDb.findSalesWithStatementsBefore.mockResolvedValue([sale([statement()])])

    await service.purgeExpiredStatements()

    expect(saleDb.markStatementPurged).not.toHaveBeenCalled()
  })

  /** The query already filters; this is the belt, and it is cheap. */
  it('leaves a statement that is not yet past its time', async () => {
    saleDb.findSalesWithStatementsBefore.mockResolvedValue([
      sale([statement({ uploadedAt: new Date(Date.now() - DAY_MS) })])
    ])

    await service.purgeExpiredStatements()

    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('leaves a statement whose bytes are already gone', async () => {
    saleDb.findSalesWithStatementsBefore.mockResolvedValue([
      sale([statement({ purgedAt: new Date() })])
    ])

    await service.purgeExpiredStatements()

    expect(storage.remove).not.toHaveBeenCalled()
  })

  /** One failure must not strand every other document behind it. */
  it('carries on past a statement it could not purge', async () => {
    const first = statement()
    const second = statement()
    storage.remove.mockRejectedValueOnce(new Error('busy'))
    saleDb.findSalesWithStatementsBefore.mockResolvedValue([sale([first, second])])

    await service.purgeExpiredStatements()

    expect(storage.remove).toHaveBeenCalledTimes(2)
    expect(saleDb.markStatementPurged).toHaveBeenCalledTimes(1)
  })

  describe('the retention window', () => {
    it('can be shortened by configuration', async () => {
      process.env.SALE_STATEMENT_RETENTION_DAYS = '7'
      saleDb.findSalesWithStatementsBefore.mockResolvedValue([])

      await service.purgeExpiredStatements()

      const [cutoff] = saleDb.findSalesWithStatementsBefore.mock.calls[0] as [Date]
      const days = (Date.now() - cutoff.getTime()) / DAY_MS

      expect(Math.round(days)).toBe(7)
    })

    it.each(['', 'not-a-number', '0', '-1'])(
      'falls back to ninety days rather than honouring %p',
      async (value) => {
        process.env.SALE_STATEMENT_RETENTION_DAYS = value
        saleDb.findSalesWithStatementsBefore.mockResolvedValue([])

        await service.purgeExpiredStatements()

        const [cutoff] = saleDb.findSalesWithStatementsBefore.mock.calls[0] as [Date]

        expect(Math.round((Date.now() - cutoff.getTime()) / DAY_MS)).toBe(90)
      }
    )
  })

  /** A sweep that overlaps itself deletes twice. */
  it('does not run two passes at once', async () => {
    let release: () => void = () => undefined
    saleDb.findSalesWithStatementsBefore.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve([])
      })
    )

    const first = service.purgeExpiredStatements()
    await service.purgeExpiredStatements()

    expect(saleDb.findSalesWithStatementsBefore).toHaveBeenCalledTimes(1)

    release()
    await first
  })
})
