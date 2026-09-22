/**
 * One rendered row of the live timeline.
 *
 * Built in a `computed()` rather than in the template so the amount is
 * formatted exactly once per snapshot, and so `@for` gets a `track` value that
 * does not change as newer events arrive.
 */
export interface SaleTimelineEntry {
  /** `SALE_EVENT.<type>` — the enum member *is* the translation key. */
  readonly key: string;
  /**
   * Pre-formatted interpolation values; the dictionary never sees a number.
   *
   * `declared` is read by one sentence — the statement correction, which says
   * what arrived *instead of* what the seller had given us. Every other entry
   * carries it unread, which costs a string and keeps the mapping one shape.
   */
  readonly params: { readonly amount: string; readonly declared: string };
  /** Epoch milliseconds, for the `dateTime` pipe. */
  readonly at: number;
  /**
   * Stable identity. Events carry no id, so this is composed from the fields
   * that cannot change once the server has written the entry — including the
   * index in the *server's* oldest-first order, which is append-only and
   * therefore does not shift when a new event lands.
   */
  readonly trackId: string;
}
