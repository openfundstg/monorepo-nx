import { SaleMethod } from '@transacto/contracts'

/** The two stored facts that decide whether a sale has a jar behind it. */
export interface SaleDestination {
  /** Transacto's credential id; `null` when the sale never got a terminal. */
  readonly cardId?: number | null
  /**
   * Absent on every sale stored before the card variant existed.
   *
   * Read as {@link SaleMethod.JAR}, which is what the backfill migration wrote
   * onto all of them — so a document that predates both is still answered
   * correctly if one is ever missed.
   */
  readonly saleMethod?: SaleMethod | null
}

/**
 * Whether this sale is backed by a jar its owner has to close.
 *
 * **`cardId !== null` is not that question, and reading it as if it were is a
 * bug that cost a user their sale slot.** Both variants get a Transacto
 * credential, so both carry a `cardId`; only one of them points that credential
 * at a bank jar. A card sale pays a person's own card, and there is nothing
 * there to close, ever.
 *
 * Four separate rules were written against `cardId`, each of them right when
 * a jar was the only destination there was:
 *
 * - a finished sale holds its slot until its jar is closed — so a finished
 *   **card** sale held one for good, with no jar its owner could go and close;
 * - a sale winding down settles only once its jar is shut — so a card sale
 *   asked to stop stayed `CLOSING` for ever and never gave the stake back;
 * - the sale's own screen asks the user to close the jar — a card seller was
 *   asked about a jar they never had;
 * - the operator's *release jar* action was offered on a sale with none.
 *
 * One predicate for all four, because four copies of "does this have a jar" is
 * four chances for one of them to answer differently from the rest.
 */
export const saleHasJar = (sale: SaleDestination): boolean =>
  (sale.cardId ?? null) !== null && (sale.saleMethod ?? SaleMethod.JAR) !== SaleMethod.CARD
