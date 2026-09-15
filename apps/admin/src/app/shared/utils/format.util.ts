/**
 * The formatters, in one place, for `.ts` callers.
 *
 * The pipes in `shared/pipes` delegate here rather than reimplementing — that
 * duplication is what let a dashboard and a wallet page disagree about kopecks
 * versus cents in the Mini App, and there is no reason to repeat it.
 *
 * **Units are not interchangeable and the names say which is which.** Fiat is
 * UAH kopecks, crypto balances are USDT cents, and the figure a user types on
 * the deposit form is whole USDT. Three units, three functions, no guessing.
 */

const UAH = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PLAIN = new Intl.NumberFormat('uk-UA');

const DATE_TIME = new Intl.DateTimeFormat('uk-UA', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** UAH kopecks → `₴1 234,56`. */
export const formatUah = (kopecks: number | null | undefined): string =>
  kopecks === null || kopecks === undefined ? '—' : `₴${UAH.format(kopecks / 100)}`;

/** USDT cents → `1 234.56 USDT`. */
export const formatUsdt = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '—' : `${UAH.format(cents / 100)} USDT`;

/**
 * Whole USDT → `10.50 USDT`, unscaled.
 *
 * Separate from {@link formatUsdt} because the deposit collection stores the
 * figure the user typed rather than cents. Passing one to the other is a
 * hundredfold error, which is why neither takes a "unit" argument.
 */
export const formatUsdtWhole = (usdt: number | null | undefined): string =>
  usdt === null || usdt === undefined ? '—' : `${UAH.format(usdt)} USDT`;

export const formatNumber = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : PLAIN.format(value);

/** An ISO timestamp → `02.09.26, 14:31`, in the reader's timezone. */
export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? DATE_TIME.format(new Date(iso)) : '—';

/**
 * A percentage held as a fraction of one, e.g. `0.1` → `0.1%`.
 *
 * The referral rate is stored the way it is applied, not the way it reads, so
 * this deliberately does not multiply by 100 — `ratePercent: 0.1` means a tenth
 * of a percent and rendering it as `10%` would overstate every payout by two
 * orders of magnitude.
 */
export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value}%`;
