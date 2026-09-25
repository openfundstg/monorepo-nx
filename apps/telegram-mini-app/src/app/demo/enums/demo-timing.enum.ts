/**
 * How long an answer from the pack takes, in milliseconds.
 *
 * Never instant. A screen that paints the moment it is tapped does not look
 * like this app — the loading states it has were designed for a network — and
 * a sale that is created before the finger has left the button reads as a
 * recording, not as a product. Still far quicker than the round trip over Tor
 * it stands in for, which is the reason the pack exists.
 */
export const DemoLatencyMs = {
  /** A screen reading its figures. */
  READ: 250,
  /** A button that would have started something. */
  WRITE: 900
} as const
export type DemoLatencyMs = (typeof DemoLatencyMs)[keyof typeof DemoLatencyMs]
