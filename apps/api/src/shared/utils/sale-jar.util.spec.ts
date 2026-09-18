import { SaleMethod } from '@transacto/contracts'
import { saleHasJar } from './sale-jar.util'

/**
 * The predicate that replaced four copies of `cardId !== null`.
 *
 * Every case here is one of those copies getting the answer wrong: a card sale
 * has a Transacto credential exactly as a jar sale does, and reading that as
 * "there is a jar behind this" held a seller's slot for good, left a stopped
 * sale winding down for ever, and asked a card seller to close a jar they never
 * had.
 */
describe('saleHasJar', () => {
  it('is true for a jar sale with a terminal', () => {
    expect(saleHasJar({ cardId: 100, saleMethod: SaleMethod.JAR })).toBe(true)
  })

  /** **The case the four rules got wrong.** A credential is not a jar. */
  it('is false for a card sale, which has a credential and no jar', () => {
    expect(saleHasJar({ cardId: 100, saleMethod: SaleMethod.CARD })).toBe(false)
  })

  it('is false for a sale that never got a terminal', () => {
    expect(saleHasJar({ cardId: null, saleMethod: SaleMethod.JAR })).toBe(false)
  })

  /**
   * A lean read applies no schema default, and the backfill migration wrote
   * `JAR` onto every sale that predates the variant — so a document that
   * somehow still carries nothing is one of those, and it has a jar.
   */
  it('reads a missing method as a jar sale', () => {
    expect(saleHasJar({ cardId: 100 })).toBe(true)
    expect(saleHasJar({ cardId: 100, saleMethod: null })).toBe(true)
  })

  it('is false with neither a terminal nor a method', () => {
    expect(saleHasJar({})).toBe(false)
  })
})
