/**
 * UAH kopecks → `1 234,56`.
 *
 * The same fixed `uk-UA` grouping as {@link formatUsdtCents}, and for the same
 * reason: the hryvnia figure the bot prints is the hryvnia figure the Mini App
 * prints a tap later, and two groupings for one number read as two numbers.
 */
const UAH_FORMAT = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export const formatUahKopecks = (kopecks: number): string => UAH_FORMAT.format(kopecks / 100)
