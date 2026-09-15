/**
 * The two `KeyboardEvent.key` values the overlay answers to.
 *
 * Strings rather than an enum because they are the DOM's own vocabulary,
 * matched verbatim — the reasoning `TelegramEvent` in `tma.service.ts` gives
 * for the SDK's event names.
 */
export const TourKey = {
  /** Dismisses the tour, as a modal dialog's contract says. */
  ESCAPE: 'Escape',
  /** Wrapped inside the card, so focus cannot leave the dialog. */
  TAB: 'Tab'
} as const
export type TourKey = (typeof TourKey)[keyof typeof TourKey]
