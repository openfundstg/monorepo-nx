import { BankProvider } from '@transacto/contracts'

/**
 * What each bank's drop link may look like, and when it is finished.
 *
 * `entryDomains` is a security boundary, not a convenience: the resolver makes
 * outbound requests to whatever the user pastes, so this list is the allowlist
 * that stops the endpoint being a general-purpose URL fetcher pointed at our
 * own network. Every redirect hop is re-checked against it, because a permitted
 * host redirecting somewhere arbitrary would otherwise walk straight through.
 */
interface DropLinkRule {
  /**
   * Registrable domains the link may sit on. Matched as "equal to, or a
   * subdomain of" — never as a substring, which `payhub.com.ua.attacker.test`
   * would satisfy.
   */
  readonly entryDomains: readonly string[]
  /** True when the scraper can already read this URL as it stands. */
  readonly isCanonical: (url: URL) => boolean
}

/** Path segments, empty ones dropped — `/send/ABC/` → `['send', 'ABC']`. */
const pathSegments = (url: URL): string[] => url.pathname.split('/').filter(Boolean)

const DROP_LINK_RULES: Record<BankProvider, DropLinkRule> = {
  /**
   * Monobank has two different ids, and only one of them works.
   *
   * The link the app shares — `send.monobank.ua/jar/<sendId>` — carries the
   * *short* id, and `api.monobank.ua/bank/jar/<sendId>` answers
   * `400 invalid alias` for it. The balance API only accepts the long
   * `extJarId`, which appears as the `jar` query parameter of the stream-widget
   * URL. `extractTargetId` reads that parameter before it falls back to the
   * path, which is exactly why the check exists.
   *
   * So a share link is *not* finished: `DropLinkResolverService` exchanges its
   * sendId for the long id before anything is stored. Treating a bare path
   * segment as usable — as this did — produced terminals that never scraped.
   */
  [BankProvider.MONO]: {
    entryDomains: ['monobank.ua'],
    isCanonical: (url) => Boolean(url.searchParams.get('jar'))
  },

  /** `PrivatScraperStrategy.extractHash` takes the last path segment. */
  [BankProvider.PRIVAT]: {
    entryDomains: ['privat24.ua'],
    isCanonical: (url) => pathSegments(url).length > 0
  },

  /**
   * The only bank that genuinely needs resolving.
   *
   * `PumbScraperStrategy.extractBoxId` reads the `box_id` **query parameter**
   * and nothing else, and the link the PUMB app shares —
   * `mobile-app.pumb.ua/XXXX` — carries no parameters at all. It 301s to
   * `frames.payhub.com.ua/moneybox?box_id=…`, which is where the id lives, so
   * `pumb.ua` is an entry domain while only a `box_id` link counts as finished.
   */
  [BankProvider.PUMB]: {
    entryDomains: ['pumb.ua', 'payhub.com.ua'],
    isCanonical: (url) => Boolean(url.searchParams.get('box_id'))
  },

  /**
   * A case link is already the page the scraper reads — `/case/<publicId>` is
   * both what NovaPay shares and what carries the balance.
   *
   * So nothing needs resolving to make it *scrapeable*; the resolve step exists
   * for the other half, the card, which the page states only in the sentence it
   * renders for sharing. `isCanonical` therefore answers about the URL, as it
   * does for every other bank, and says yes.
   */
  [BankProvider.NOVAPAY]: {
    entryDomains: ['novapay.ua'],
    isCanonical: (url) => pathSegments(url).length > 1
  }
}

/** Schemes we will ever request. Blocks `file:`, `gopher:` and friends. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/** `null` rather than a throw — every caller has its own error to raise. */
export const parseDropLink = (link: string): URL | null => {
  try {
    const url = new URL(link.trim())

    return ALLOWED_PROTOCOLS.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

/**
 * Whether `hostname` is `domain` itself or a subdomain of it.
 *
 * The dot in the suffix check is what makes this safe: without it,
 * `evil-pumb.ua` and `pumb.ua.attacker.test` both pass.
 */
export const isHostWithinDomain = (hostname: string, domain: string): boolean => {
  const host = hostname.toLowerCase()
  const suffix = domain.toLowerCase()

  return host === suffix || host.endsWith(`.${suffix}`)
}

/** Whether this URL is a host we may send a request to for the given bank. */
export const isAllowedDropLinkHost = (url: URL, bank: BankProvider): boolean =>
  DROP_LINK_RULES[bank].entryDomains.some((domain) => isHostWithinDomain(url.hostname, domain))

/** Whether the scraper could read this URL as it stands, with no resolving. */
export const isCanonicalDropLink = (url: URL, bank: BankProvider): boolean =>
  DROP_LINK_RULES[bank].isCanonical(url)
