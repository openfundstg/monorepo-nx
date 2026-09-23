/**
 * Why a sale is standing still until a bank statement arrives.
 *
 * **A statement is asked for in three situations and only two of them stop
 * anything**, which is the whole reason this exists. A seller who declared a
 * small shortfall on a payment that was executed anyway is not blocked: payers
 * keep being routed, the sale keeps filling, and the document is only needed
 * before the remainder is released at the end. Putting an upload box on screen
 * for that read as a demand, and the ones that *were* demands looked exactly
 * the same.
 *
 * So the block is drawn only for these two, and each names its own sentence —
 * the two stoppages have nothing in common from the seller's side, and one
 * message covering both could only be vague about both.
 *
 * The member's value is its translation key's suffix, so the template builds
 * the key by concatenation rather than keeping a `switch` in step with this.
 */
export enum StatementBlockReason {
  /**
   * A payment is disputed, so the terminal takes no new payers.
   *
   * The seller said nothing arrived, or declared a figure far enough short that
   * the order was not executed. Routing stops while that question is open —
   * a second payer landing money on an unanswered payment turns "did this ₴300
   * arrive" into "did some money arrive", which nobody can answer about a card
   * that sees more than one transfer a day.
   */
  ROUTING_STOPPED = 'routing_stopped',
  /**
   * The sale is in its tail and the last claim has not been through a statement.
   *
   * Nothing is left to route — the gap is smaller than the pipeline's order
   * floor — and the remainder is held until the bank's own record settles what
   * really landed. From the seller's side this is the quietest failure there
   * is: the bar stops, no payment arrives, and nothing says why.
   */
  TAIL_HELD = 'tail_held'
}
