import { TourCardSide } from '../enums/tour-card-side.enum'
import type { TourGeometry } from '../enums/tour-geometry.enum'
import type { TourBox, TourCardPlacement, TourLayout } from '../interfaces/tour-layout.interface'

/** The four fields the placement reads, so jsdom's zero-rects and plain objects both serve. */
export const toBox = (rect: DOMRectReadOnly): TourBox => ({
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height
})

/** Nothing to point at: full scrim, card in the middle. The welcome step, and any step whose anchor is missing. */
export const CENTERED_PLACEMENT: TourCardPlacement = {
  side: TourCardSide.CENTER,
  top: null,
  bottom: null,
  highlight: null
}

/**
 * Where the card goes, given where the anchor is.
 *
 * Room-based, not "upper half → below": a 220 px card under a tile whose foot
 * sits 150 px above the nav does not fit, whichever half the tile is in. Below
 * is preferred because the eye reads down from the thing being explained;
 * above when only above has room; and when neither does — an anchor taller
 * than the frame, or a frame shorter than a card — the card becomes a sheet at
 * the frame's foot, over the highlight, rather than sliding off an edge.
 *
 * Every figure returned is frame-relative. The highlight is padded and then
 * clamped to the frame, so a half-scrolled anchor still yields a box the scrim
 * can be cut around.
 */
export const placeTourCard = (
  { frame, anchor, cardHeight }: TourLayout,
  geometry: TourGeometry
): TourCardPlacement => {
  if (!anchor) return CENTERED_PLACEMENT

  const pad = geometry.HIGHLIGHT_PAD_PX
  const left = Math.max(0, anchor.left - frame.left - pad)
  const right = Math.min(frame.width, anchor.left - frame.left + anchor.width + pad)
  const top = Math.max(0, anchor.top - frame.top - pad)
  const bottom = Math.min(frame.height, anchor.top - frame.top + anchor.height + pad)
  const highlight: TourBox = {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }

  const gap = geometry.CARD_GAP_PX
  const edge = geometry.EDGE_PAD_PX
  const roomBelow = frame.height - bottom - gap - edge
  const roomAbove = top - gap - edge

  if (roomBelow >= cardHeight) {
    return { side: TourCardSide.BELOW, top: bottom + gap, bottom: null, highlight }
  }
  if (roomAbove >= cardHeight) {
    return { side: TourCardSide.ABOVE, top: null, bottom: frame.height - top + gap, highlight }
  }

  return { side: TourCardSide.SHEET, top: null, bottom: null, highlight }
}
