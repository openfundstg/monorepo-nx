import { KOPECKS_PER_UAH, saleCardOrderFloorKopecks } from '@transacto/contracts'

/** How a card sale's credential is tuned at one moment in that sale's life. */
export interface CardCredentialWindow {
  /** UAH kopecks still outstanding against the target. */
  readonly remainingKopecks: number
  /** How many of the seven slots have not been used. */
  readonly ordersLeft: number
  /**
   * The smallest order that may be routed, in kopecks — or `0` when none can
   * be: the slots are gone, or what is left is under the pipeline's floor.
   */
  readonly minKopecks: number
  /** The same figure in whole hryvnia, which is the only precision upstream has. */
  readonly minAmountUah: number
  /** The largest order that may be routed, in whole hryvnia. */
  readonly maxAmountUah: number
}

/**
 * What a card sale's credential should allow, given where the sale stands.
 *
 * **One function because there is one rule, asked at two moments.** A terminal
 * is created with an equal share of the whole target across all seven slots, and
 * re-tuned after every settlement with an equal share of what is left across the
 * slots that are free — and creation is simply the case where nothing has
 * arrived and every slot is free. They were written twice, in the strategy that
 * creates the credential and the service that maintains it, and two copies of an
 * arithmetic that decides how money is routed is one copy too many.
 *
 * The kopeck-to-hryvnia conversions live here for the same reason. The division
 * is exact rather than a second rounding — `saleCardOrderFloorKopecks` has
 * already floored to whole hryvnia — and the ceiling on the maximum is
 * deliberate: rounding a remainder down would publish a cap below what the sale
 * still needs and strand the difference.
 */
export const cardCredentialWindow = (
  remainingKopecks: number,
  ordersLeft: number,
  floorKopecks: number
): CardCredentialWindow => {
  const minKopecks = saleCardOrderFloorKopecks(remainingKopecks, floorKopecks, ordersLeft)

  return {
    remainingKopecks,
    ordersLeft,
    minKopecks,
    minAmountUah: minKopecks / KOPECKS_PER_UAH,
    maxAmountUah: Math.ceil(remainingKopecks / KOPECKS_PER_UAH)
  }
}
