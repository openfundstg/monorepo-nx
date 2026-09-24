/**
 * What a sale form showed before the rate under it moved.
 *
 * Captured at the moment of the move rather than rebuilt afterwards: once the
 * new rate lands, every figure on the form is recomputed from it, and the only
 * record of what the user was looking at a moment ago is this one. The figures
 * after the move are not here — they are the form's own, live.
 */
export interface SaleRateChange {
  /** Kopecks per USDT the form was priced at. */
  readonly rateKopecks: number;
  /** The hryvnia total it showed, in kopecks — zero when nothing was entered yet. */
  readonly targetKopecks: number;
  /** The USDT that total would have staked, in cents. */
  readonly stakeCents: number;
}
