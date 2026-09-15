import { BankProvider } from 'src/shared/constants'

/**
 * DI token for the list of every {@link ScraperStrategy}.
 *
 * `BankScraperService` injects the array and indexes it by `provider`; the
 * module is the single place that decides which banks are supported.
 */
export const SCRAPER_STRATEGIES = 'SCRAPER_STRATEGIES'

/**
 * Public endpoints of the banks we scrape.
 *
 * Not env config — these are third-party addresses, identical in every
 * environment, and pointing them elsewhere would mean scraping a different
 * bank. Grouped here so no URL is buried in a service.
 */
export const BANK_API = {
  MONO_JAR: (jarId: string) => `https://api.monobank.ua/bank/jar/${jarId}`,
  PUMB_BOX: (boxId: string) =>
    `https://rlyeh2.payhub.com.ua/frames/donations/info?box_id=${boxId}&link_params={}`,
  PRIVAT_INIT: (timestamp: number) =>
    `https://next.privat24.ua/api/p24/init?lang=ua&_=${timestamp}`,
  PRIVAT_ZIPLINK: 'https://next.privat24.ua/api/p24/pub/ziplink',
  PRIVAT_BALANCE: 'https://widget.privat24.ua/api/p24/pub/envelopes/pubinfo',
  /**
   * The case page itself — NovaPay publishes no API for one.
   *
   * The same URL the user pastes, which is why nothing has to be resolved
   * before a case can be scraped: the page a payer opens is the page that
   * states the balance.
   */
  NOVAPAY_CASE: (publicId: string) => `https://e-com.novapay.ua/case/${publicId}`
} as const

/**
 * How long a balance below the baseline must **keep** reading that way before
 * this pipeline believes it, per bank.
 *
 * Zero for every bank that answers from its own ledger: a drop is a drop, and
 * making a real withdrawal wait would delay the one alert that matters.
 *
 * NovaPay is the exception, and it is a defect in their service rather than a
 * policy of ours. A case page intermittently answers with a balance from about
 * a minute earlier — a cache somewhere on their side serving a stale render.
 * The figure is not corrupt, so nothing about the response says it is stale,
 * and it is not even wrong: it is what the jar held a minute ago.
 *
 * That is precisely the shape this pipeline cannot survive. A balance below the
 * baseline is how a withdrawal is recognised, and the verdict is expensive and
 * one-way: a FRAUD alert, the credential disabled on Transacto, every pending
 * order on the card failed, the loop stopped. A stale read costs a live
 * terminal, and it has.
 *
 * **Re-reading immediately does not help.** The second request lands in the
 * same cache and agrees with the first, which is why this is a duration and not
 * a retry count.
 *
 * **Three minutes, because thirty seconds was measured and was not enough.** On
 * 2026-09-06 a case that had just taken ₴820 answered `0` — its own balance
 * from two minutes earlier — and went on answering it. The window elapsed, the
 * drop was believed, and a live terminal was torn down: FRAUD raised, credential
 * disabled, ₴1 229 of already-routed orders cancelled, the sale dead for two
 * hours. The stale reading held for at least forty-four seconds; the value
 * itself was about a minute old. A window has to outlive both, so it is set well
 * clear of them rather than just past the one case we have measured.
 *
 * The usual cost of a long window — an extra three minutes of payers routed to a
 * jar somebody is draining — is not paid here: the drop pauses order routing
 * upstream the moment it is *seen*, and only the verdict waits.
 */
export const BANK_DROP_CONFIRM_MS: Readonly<Record<BankProvider, number>> = {
  [BankProvider.MONO]: 0,
  [BankProvider.PRIVAT]: 0,
  [BankProvider.PUMB]: 0,
  [BankProvider.NOVAPAY]: 180_000
}

/** Outbound request settings shared by every bank call. */
export const BANK_HTTP = {
  TIMEOUT_MS: 10_000,
  MAX_RETRIES: 3,
  /**
   * Carries the proxy sticky-session key. Read by the request interceptor to
   * pick a proxy agent, then stripped before the request leaves — the banks
   * never see it.
   */
  SESSION_HEADER: 'X-Jar-Id',
  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
} as const

/** How long a PrivatBank handshake stays valid in Redis. */
export const PRIVAT_SESSION_TTL_SECONDS = 3600
