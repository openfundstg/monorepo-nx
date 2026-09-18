import { TmaSaleStatus } from '@transacto/contracts'
import { acceptsNewPayers } from './sale-status.util'

/**
 * Which sales a terminal may be switched back on for.
 *
 * The list matters in one direction only: anything that *resumes* routing has
 * to ask first. A dispute is not the only thing that switches routing off — a
 * seller stopping a sale with payments outstanding leaves it `CLOSING` with
 * routing down on purpose — and settling the dispute afterwards would hand the
 * sale back to new payers after its owner had ended it.
 */
describe('acceptsNewPayers', () => {
  it.each([TmaSaleStatus.CREATED, TmaSaleStatus.TERMINAL_READY, TmaSaleStatus.AWAITING_FIAT])(
    'lets payers into a sale that is %s',
    (status) => {
      expect(acceptsNewPayers({ status })).toBe(true)
    }
  )

  /** `CLOSING` keeps its terminal in service, and deliberately not its routing. */
  it.each([
    TmaSaleStatus.CLOSING,
    TmaSaleStatus.COMPLETED,
    TmaSaleStatus.CANCELLED,
    TmaSaleStatus.FAILED,
    TmaSaleStatus.BLOCKED
  ])('keeps them out of a sale that is %s', (status) => {
    expect(acceptsNewPayers({ status })).toBe(false)
  })
})
