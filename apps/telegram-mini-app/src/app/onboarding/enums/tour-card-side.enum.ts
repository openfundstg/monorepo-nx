/** Where the card sits relative to the highlight. */
export enum TourCardSide {
  /** No highlight: the card sits in the middle of the frame. */
  CENTER = 'center',
  BELOW = 'below',
  ABOVE = 'above',
  /** Neither side has room: pinned to the frame's foot, over the highlight. */
  SHEET = 'sheet'
}
