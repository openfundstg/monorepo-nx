/**
 * A percentage → `2,5`.
 *
 * One decimal at most, and the same `uk-UA` locale every other figure in this
 * module fixes — for the reason `formatUsdtCents` states: the person reading
 * this in the bot reads the same number on the dashboard a tap later, and the
 * Mini App's own `formatPercent` rounds and groups exactly this way.
 *
 * The sign is not printed here. Whether a figure reads as a gain is the
 * sentence's business, and the one place this is used has already refused to
 * render anything that is not one.
 */
const PERCENT_FORMAT = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 })

export const formatPercent = (percent: number): string => PERCENT_FORMAT.format(percent)
