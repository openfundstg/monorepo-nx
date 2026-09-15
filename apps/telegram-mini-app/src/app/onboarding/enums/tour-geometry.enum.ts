/**
 * The tour's pixel figures, named once.
 *
 * `EDGE_PAD_PX` equals `--page-pad` in `styles/_tokens.scss`; it is the one
 * number the placement helper needs that CSS holds and TypeScript cannot read
 * without a `getComputedStyle` round trip. Change both together.
 */
export const TOUR_GEOMETRY = {
  /** Breathing room between an anchor's edge and the cut-out. */
  HIGHLIGHT_PAD_PX: 6,
  /** Between the cut-out and the card. */
  CARD_GAP_PX: 12,
  /** Vertical inset from the frame's edges the card must keep. */
  EDGE_PAD_PX: 16,
  /** The card's height until it has been measured once. */
  CARD_FALLBACK_HEIGHT_PX: 220
} as const
export type TourGeometry = typeof TOUR_GEOMETRY
