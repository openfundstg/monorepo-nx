/**
 * Money and date formatting, in one place.
 *
 * These four functions were previously copy-pasted, byte for byte, into ten
 * components. Extracting them is not only tidiness: each copy silently decided
 * its own units, and the dashboard and wallet pages disagreed about whether a
 * history amount was kopecks or cents.
 *
 * The locale is deliberately fixed rather than following the selected language.
 * The only fiat in the product is the hryvnia, so a user reading the interface
 * in English still wants `1 234,56 ₴` grouped the Ukrainian way — and a pipe
 * that re-formatted on every language change would have to be impure to notice.
 */
const LOCALE = 'uk-UA';

const MONEY_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** UAH kopecks → `1 234,56`. */
export const formatUah = (kopecks: number): string =>
  (kopecks / 100).toLocaleString(LOCALE, MONEY_FORMAT);

/** USDT cents → `12,34`. */
export const formatUsdt = (cents: number): string =>
  (cents / 100).toLocaleString(LOCALE, MONEY_FORMAT);

/** UAH kopecks → `1 235`, for headline figures where decimals are noise. */
export const formatUahWhole = (kopecks: number): string =>
  (kopecks / 100).toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * UAH kopecks → `1706` or `1706.50`, for the clipboard rather than the screen.
 *
 * Deliberately not {@link formatUah}: that one groups thousands with a
 * non-breaking space and writes the decimal with a comma, both of which a
 * banking app's amount field either rejects or reads as something else. What
 * gets pasted has to be the number and nothing but the number.
 *
 * Whole hryvnia lose the `.00` — a payout's amount usually is whole, and
 * trailing zeros in a field somebody is about to check by eye are noise.
 */
export const formatUahPlain = (kopecks: number): string => {
  const uah = kopecks / 100;

  return Number.isInteger(uah) ? String(uah) : uah.toFixed(2);
};

/**
 * A percentage → `0,5`, at most one decimal and no trailing zero.
 *
 * Here rather than in the one component that needs it, because the locale
 * decision above is the whole point of this file: a hryvnia amount and a
 * percentage rendered a metre apart must not disagree about whether the
 * decimal separator is a comma.
 */
export const formatPercent = (percent: number): string =>
  percent.toLocaleString(LOCALE, { maximumFractionDigits: 1 });

/** ISO string or epoch millis → `12.08.2026, 19:54`. */
export const formatDateTime = (value: string | number | Date): string =>
  new Date(value).toLocaleString(LOCALE, DATE_FORMAT);

/**
 * A countdown, as `m:ss` — or `h:mm:ss` once there is an hour to show.
 *
 * Takes milliseconds and floors at zero: a deadline that has passed reads
 * `0:00` rather than counting upwards into negative time. The caller decides
 * what a passed deadline *means*; this only refuses to render it as a number
 * nobody can act on.
 */
export const formatRemaining = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
