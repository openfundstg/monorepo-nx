/** Kyiv, which is what a Ukrainian bank receipt's clock is. */
const RECEIPT_TIME_ZONE = 'Europe/Kyiv'

/**
 * A wall clock printed on a receipt, as an instant.
 *
 * **Both banks print Kyiv local time with no offset on it**, and everything it
 * is compared against is UTC — the moment the payout was reserved, the pay
 * deadline. Converting with a fixed `+03:00` would be right for eight months of
 * the year and an hour out for the other four, which on a fifteen-minute window
 * is the difference between a receipt inside it and one refused as too early.
 *
 * It lives in `shared/` because the second parser needed it: monobank prints
 * `08.09.2026 15:15` and PrivatBank `08/09/2026 15:15`, the formats differ and
 * the clock does not. Two copies would be two answers about the same hour.
 */
export const fromKyivWallClock = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date | null => {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)

  if (Number.isNaN(asUtc)) return null

  return new Date(asUtc - kyivOffsetMs(asUtc))
}

/**
 * How far ahead of UTC Kyiv was at that instant, in milliseconds.
 *
 * Asked of the runtime rather than hard-coded, so summer and winter time are
 * whatever the tz database says they were. The instant passed in is the wall
 * clock read as if it were UTC, which is within an hour of the real one — near
 * enough that it lands on the correct side of every changeover except within an
 * hour of it, and a receipt written in that hour is an hour out at worst.
 */
const kyivOffsetMs = (instant: number): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: RECEIPT_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instant))

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value)
  // `formatToParts` renders midnight as hour 24 under `hour12: false`.
  const hour = read('hour') % 24

  const asKyiv = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second')
  )

  return asKyiv - Math.floor(instant / 1000) * 1000
}
