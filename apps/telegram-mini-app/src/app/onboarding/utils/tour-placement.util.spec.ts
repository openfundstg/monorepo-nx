import { TourCardSide } from '../enums/tour-card-side.enum'
import { TOUR_GEOMETRY } from '../enums/tour-geometry.enum'
import type { TourBox } from '../interfaces/tour-layout.interface'
import { CENTERED_PLACEMENT, placeTourCard, toBox } from './tour-placement.util'

/**
 * A phone in Telegram's fullscreen mode: 104 px of status bar and controls
 * above the frame, 700 px of frame below them. Every anchor here is given in
 * viewport coordinates, as `getBoundingClientRect()` reports them, and every
 * result is expected frame-relative.
 */
const frame: TourBox = { top: 104, left: 0, width: 390, height: 700 }

const { HIGHLIGHT_PAD_PX: pad, CARD_GAP_PX: gap, EDGE_PAD_PX: edge } = TOUR_GEOMETRY

/** A full-width tile, as the dashboard draws one, at a given viewport top. */
const tile = (top: number, height = 80): TourBox => ({ top, left: 16, width: 358, height })

const place = (anchor: TourBox | null, cardHeight = 220) =>
  placeTourCard({ frame, anchor, cardHeight }, TOUR_GEOMETRY)

describe('placeTourCard', () => {
  it('centres the card when there is nothing to point at', () => {
    expect(place(null)).toBe(CENTERED_PLACEMENT)
  })

  it('pads the highlight and converts it to frame coordinates', () => {
    const { highlight } = place(tile(200))

    expect(highlight).toEqual({ top: 90, left: 10, width: 370, height: 92 })
  })

  it('puts the card below when there is room', () => {
    const placement = place(tile(200), 220)

    expect(placement.side).toBe(TourCardSide.BELOW)
    expect(placement.top).toBe(182 + gap)
    expect(placement.bottom).toBeNull()
  })

  /** The bottom nav: fixed at the frame's foot, nothing fits under it. */
  it('puts the card above when only above has room', () => {
    const placement = place(tile(104 + 620, 60), 220)

    expect(placement.side).toBe(TourCardSide.ABOVE)
    expect(placement.bottom).toBe(700 - (placement.highlight?.top ?? NaN) + gap)
    expect(placement.top).toBeNull()
  })

  /** The eye reads down from the thing being explained. */
  it('prefers below when both fit', () => {
    expect(place(tile(104 + 300), 100).side).toBe(TourCardSide.BELOW)
  })

  /**
   * An anchor taller than the frame: the highlight is cut to the frame on all
   * four sides and the card sits over it rather than off an edge.
   */
  it('becomes a sheet when neither side fits', () => {
    const placement = place({ top: 104 - 10, left: -20, width: 500, height: 720 }, 220)

    expect(placement.side).toBe(TourCardSide.SHEET)
    expect(placement.top).toBeNull()
    expect(placement.bottom).toBeNull()
    expect(placement.highlight).toEqual({ top: 0, left: 0, width: 390, height: 700 })
  })

  /** Half of the anchor is scrolled under the status bar; the visible half is highlighted. */
  it('clamps a half-scrolled anchor to the frame', () => {
    const { highlight } = place(tile(60, 100))

    expect(highlight?.top).toBe(0)
    expect(highlight?.height).toBe(60 - frame.top + 100 + pad)
  })

  /**
   * Exactly `cardHeight + gap` of frame left under the anchor's cut-out: the
   * card would touch the frame's foot, and the edge pad is what says it may
   * not. Without the pad this would be BELOW.
   */
  it('shrinks the room by the edge pad', () => {
    const cardHeight = 220
    const bottom = frame.height - cardHeight - gap
    const anchor = tile(frame.top + bottom - pad - 80)

    const placement = place(anchor, cardHeight)

    expect(placement.highlight?.top).toBe(bottom - 80 - 2 * pad)
    expect(frame.height - (bottom - 80 - 2 * pad + 80 + 2 * pad)).toBe(cardHeight + gap)
    expect(placement.side).not.toBe(TourCardSide.BELOW)
    expect(placement.side).toBe(TourCardSide.ABOVE)
    expect(edge).toBeGreaterThan(0)
  })
})

describe('toBox', () => {
  /** Only the four fields are read, so a plain object with `right`/`bottom` missing serves too. */
  it('keeps the four fields the placement reads', () => {
    const box = toBox({ top: 1, left: 2, width: 3, height: 4 } as DOMRectReadOnly)

    expect(box).toEqual({ top: 1, left: 2, width: 3, height: 4 })
  })
})
