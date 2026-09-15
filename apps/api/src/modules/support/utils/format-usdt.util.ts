/**
 * USDT cents → `1 234,56`.
 *
 * The locale is fixed to `uk-UA` rather than following the user's chosen
 * language, and that is a deliberate match with the Mini App: `format.util.ts`
 * there fixes the same locale for the same reason. The person reading a balance
 * in the bot is the person reading it on the dashboard a tap later, and two
 * different groupings for one number reads as two different numbers.
 */
const USDT_FORMAT = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

export const formatUsdtCents = (cents: number): string => USDT_FORMAT.format(cents / 100)
