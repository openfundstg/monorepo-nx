import type { TourCardSide } from '../enums/tour-card-side.enum'

/** Four numbers, so a spec can build one without a `DOMRect`. */
export interface TourBox {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/** What the overlay measured, viewport-relative. */
export interface TourLayout {
  /** The safe frame (`.frame`): the viewport minus the two `--app-safe-*` insets. */
  readonly frame: TourBox
  /** The anchor, or `null` for an unanchored step or one whose element is not registered. */
  readonly anchor: TourBox | null
  /** The card's rendered height; decides whether it fits below or above. */
  readonly cardHeight: number
}

/** Where things go, frame-relative. */
export interface TourCardPlacement {
  readonly side: TourCardSide
  /** Frame-relative; the unused one is `null` so `[style.top.px]` drops the property. */
  readonly top: number | null
  readonly bottom: number | null
  /** The padded, clamped cut-out, or `null` for a full scrim. */
  readonly highlight: TourBox | null
}
