import { AdminSaleAction, TmaSaleStatus } from '@transacto/contracts'
import {
  allowedSaleActions,
  isSaleActionAllowed
} from 'src/modules/admin/utils/sale-actions.util'

/**
 * These assertions mirror preconditions that live in the settlement services,
 * which is the point: the panel used to decide for itself and got all three
 * wrong on a blocked order — one answered 409, and the other two succeeded at
 * the HTTP level while doing nothing, because their guarded update matched no
 * document.
 */
/**
 * A sale with a jar nothing has reported closed — the state `RELEASE_JAR`
 * exists for. Every other test passes no jar, so the action is absent from
 * them, which is what the existing expectations assert.
 */
const withOpenJar = (status: TmaSaleStatus) => ({
  status,
  cardId: 28_788,
  jarClosedAt: null
})

describe('allowedSaleActions', () => {
  it('offers everything on a live order', () => {
    expect(allowedSaleActions({ status: TmaSaleStatus.AWAITING_FIAT })).toEqual([
      AdminSaleAction.CANCEL,
      AdminSaleAction.BLOCK,
      AdminSaleAction.COMPLETE
    ])
  })

  /**
   * An order already winding down has no second stop button —
   * `SaleCancelService.isOpen` excludes `CLOSING` deliberately — but it
   * can still be blocked or settled.
   */
  it('withholds only cancelling from an order that is winding down', () => {
    const allowed = allowedSaleActions({ status: TmaSaleStatus.CLOSING })

    expect(allowed).not.toContain(AdminSaleAction.CANCEL)
    expect(allowed).toContain(AdminSaleAction.BLOCK)
    expect(allowed).toContain(AdminSaleAction.COMPLETE)
  })

  /**
   * A blocked order accepts the two halves of a human review and nothing else.
   *
   * The three settlement paths all refuse it — that is the regression this file
   * was written for, when the panel offered all three and one answered 409
   * while two silently did nothing. `RESUME` and `RELEASE` exist precisely
   * because refusing everything left the stake frozen for good.
   */
  it('offers only the two review actions on a blocked order', () => {
    expect(allowedSaleActions({ status: TmaSaleStatus.BLOCKED })).toEqual([
      AdminSaleAction.RESUME,
      AdminSaleAction.RELEASE
    ])
  })

  /** And the review actions apply to nothing else — there is no block to lift. */
  it('offers the review actions on no other status', () => {
    for (const status of Object.values(TmaSaleStatus)) {
      if (status === TmaSaleStatus.BLOCKED) continue

      const allowed = allowedSaleActions({ status })
      expect(allowed).not.toContain(AdminSaleAction.RESUME)
      expect(allowed).not.toContain(AdminSaleAction.RELEASE)
    }
  })

  /**
   * The escape hatch for a jar the bank will not report closed. Offered only on
   * a sale that is actually holding a slot: with no jar, or one already
   * recorded as closed, there is nothing for it to release.
   */
  describe('releasing a slot a finished sale is still holding', () => {
    it.each([TmaSaleStatus.COMPLETED, TmaSaleStatus.CANCELLED])(
      'offers it on %s while the jar is open',
      (status) => {
        expect(allowedSaleActions(withOpenJar(status))).toEqual([
          AdminSaleAction.RELEASE_JAR
        ])
      }
    )

    it('withholds it once the jar is recorded as closed', () => {
      expect(
        allowedSaleActions({
          ...withOpenJar(TmaSaleStatus.COMPLETED),
          jarClosedAt: new Date()
        })
      ).toEqual([])
    })

    /** No terminal was ever created, so there is no jar to vouch for. */
    it('withholds it on a sale that never had a jar', () => {
      expect(
        allowedSaleActions({ ...withOpenJar(TmaSaleStatus.CANCELLED), cardId: null })
      ).toEqual([])
    })

    it('offers it on no status where the jar outlives nothing', () => {
      for (const status of Object.values(TmaSaleStatus)) {
        if (status === TmaSaleStatus.COMPLETED || status === TmaSaleStatus.CANCELLED)
          continue

        expect(allowedSaleActions(withOpenJar(status))).not.toContain(
          AdminSaleAction.RELEASE_JAR
        )
      }
    })
  })

  it('offers nothing on a finished order whose jar is not holding a slot', () => {
    for (const status of [
      TmaSaleStatus.COMPLETED,
      TmaSaleStatus.CANCELLED,
      TmaSaleStatus.FAILED
    ])
      expect(allowedSaleActions({ status })).toEqual([])
  })

  it('answers for every status the contract defines', () => {
    // A status added later must be considered here rather than falling through
    // to "everything allowed" — which is what a lookup with a default would do.
    for (const status of Object.values(TmaSaleStatus))
      expect(() => allowedSaleActions({ status })).not.toThrow()
  })
})

describe('isSaleActionAllowed', () => {
  it('agrees with the set the row is rendered from', () => {
    for (const status of Object.values(TmaSaleStatus)) {
      const allowed = allowedSaleActions({ status })

      for (const action of Object.values(AdminSaleAction))
        expect(isSaleActionAllowed(action, { status })).toBe(allowed.includes(action))
    }
  })
})
