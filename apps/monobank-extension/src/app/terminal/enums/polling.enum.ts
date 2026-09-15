/**
 * Timings for the "is this terminal still being polled?" indicator.
 *
 * The backend re-scrapes on a ~5s loop but only broadcasts when something the
 * trader can see has changed, plus a heartbeat, so silence is normal.
 */
export const Polling = {
  /** How often the card re-evaluates freshness. */
  TICK_MS: 1000,

  /**
   * Age past which a terminal counts as no longer polling.
   *
   * **Coupled to `BROADCAST_HEARTBEAT_MS` in the backend's
   * `terminal-balance-orchestrator.service.ts`.** It has to exceed the worst
   * case there — heartbeat 15s + poll jitter 7.5s + bank timeout 10s = 32.5s —
   * or a healthy terminal blinks out whenever a bank call is slow.
   */
  STALE_AFTER_MS: 45_000,
} as const;
