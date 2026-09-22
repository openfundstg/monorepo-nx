import { TmaSaleStatus } from '@transacto/contracts'
import { SaleTailSweepService } from './sale-tail-sweep.service'
import type { SaleSettlementService } from './sale-settlement.service'
import type { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'

const sale = (id: string, overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => id },
  publicId: id.toUpperCase(),
  status: TmaSaleStatus.AWAITING_FIAT,
  fiatAmount: 96_000,
  receivedAmount: 90_000,
  jarBalance: null,
  openingJarBalance: null,
  ...overrides
})

/**
 * The pass that picks up a tail nothing else will ever look at again.
 *
 * Every other path that notices one is driven by something happening — an order
 * settling, a jar being scraped, a statement accepted. A sale already sitting on
 * a gap under the floor has no further order coming and no payer to scrape for,
 * so on a card sale nothing happens to it ever again. Every such sale at the
 * moment this shipped would have waited for good.
 */
describe('SaleTailSweepService', () => {
  let db: Record<string, jest.Mock>
  let settlement: Record<string, jest.Mock>
  let service: SaleTailSweepService

  const originalMinOrder = process.env.TRANSACTO_MIN_ORDER_KOPECKS

  beforeEach(() => {
    process.env.TRANSACTO_MIN_ORDER_KOPECKS = '30000'

    db = { findOpenWithMoney: jest.fn(async () => [sale('order-1')]) }
    settlement = { settleIfFinished: jest.fn(async () => false) }

    service = new SaleTailSweepService(
      db as unknown as TmaSaleDbService,
      settlement as unknown as SaleSettlementService
    )
  })

  afterEach(() => {
    if (originalMinOrder === undefined) delete process.env.TRANSACTO_MIN_ORDER_KOPECKS
    else process.env.TRANSACTO_MIN_ORDER_KOPECKS = originalMinOrder
  })

  /** It decides nothing of its own — it only makes sure the question gets asked. */
  it('re-examines a sale sitting on an unfillable gap', async () => {
    await service.sweepTails()

    expect(settlement.settleIfFinished).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ receivedAmount: 90_000 })
    )
  })

  it('leaves a sale whose gap a payer could still fill', async () => {
    db.findOpenWithMoney.mockResolvedValue([sale('order-1', { receivedAmount: 50_000 })])

    await service.sweepTails()

    expect(settlement.settleIfFinished).not.toHaveBeenCalled()
  })

  it('leaves a sale that has already reached its target', async () => {
    db.findOpenWithMoney.mockResolvedValue([sale('order-1', { receivedAmount: 96_000 })])

    await service.sweepTails()

    expect(settlement.settleIfFinished).not.toHaveBeenCalled()
  })

  it('does nothing at all when no sale is in a tail', async () => {
    db.findOpenWithMoney.mockResolvedValue([])

    await expect(service.sweepTails()).resolves.toBeUndefined()

    expect(settlement.settleIfFinished).not.toHaveBeenCalled()
  })

  /** One failure must not strand every other sale waiting behind it. */
  it('carries on past a sale it could not re-examine', async () => {
    db.findOpenWithMoney.mockResolvedValue([sale('order-1'), sale('order-2')])
    settlement.settleIfFinished.mockRejectedValueOnce(new Error('mongo is down'))

    await expect(service.sweepTails()).resolves.toBeUndefined()

    expect(settlement.settleIfFinished).toHaveBeenCalledTimes(2)
  })

  /** A settlement moves money and must not overlap itself. */
  it('skips a pass while one is still running', async () => {
    let release: () => void = () => undefined
    db.findOpenWithMoney.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve([]) })
    )

    const first = service.sweepTails()
    await service.sweepTails()

    expect(db.findOpenWithMoney).toHaveBeenCalledTimes(1)

    release()
    await first
  })

  /** The pass runs on the scraper's clock; a failure here must not stop it. */
  it('swallows a database failure', async () => {
    db.findOpenWithMoney.mockRejectedValue(new Error('mongo is down'))

    await expect(service.sweepTails()).resolves.toBeUndefined()
  })

  /** …and releases the guard, so the next tick is not locked out for good. */
  it('runs again after a failed pass', async () => {
    db.findOpenWithMoney.mockRejectedValueOnce(new Error('mongo is down'))

    await service.sweepTails()
    await service.sweepTails()

    expect(db.findOpenWithMoney).toHaveBeenCalledTimes(2)
  })
})
