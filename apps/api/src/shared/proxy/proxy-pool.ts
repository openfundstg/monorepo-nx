import type { Logger } from '@nestjs/common'
import { HttpsProxyAgent } from 'https-proxy-agent'

/** How long after a rotation an unforced one is ignored. */
const ROTATION_COOLDOWN_MS = 5000

/**
 * A list of outbound addresses and the one policy for moving between them.
 *
 * Extracted from {@link ProxyManagerService} when a second pool appeared, and
 * extracted rather than copied for the reason that service's own comment gives:
 * two copies would be two rotation policies for one idea. The class holds the
 * mechanics — parse a list, hand out an agent, step to the next address on a
 * cooldown — and decides nothing about who is allowed to run without one.
 *
 * It is a plain class, not a provider. Each pool is owned by the service that
 * knows which environment variable fills it, and rotation state is per pool:
 * two services sharing one pool must share one instance, and two services on
 * different pools must not.
 */
export class ProxyPool {
  private readonly urls: string[]
  private activeIndex = 0
  private lastRotationTime = 0

  /**
   * @param source The environment variable this was filled from. Only ever used
   *   in log lines, and worth carrying: with more than one pool in the process,
   *   "the pool is empty" is not a diagnosis until it says which pool.
   * @param logger The owner's logger, so these lines keep appearing under the
   *   service an operator would grep for rather than under this class.
   */
  constructor(
    readonly source: string,
    raw: string,
    private readonly logger: Logger
  ) {
    this.urls = ProxyPool.parse(raw)
  }

  /**
   * Splits the configured list into usable URLs.
   *
   * Quotes are stripped because a value quoted in an env file arrives with them
   * attached often enough to be worth handling rather than diagnosing: the
   * credential then decodes with a `"` in it and every request answers `407`,
   * which reads as a wrong password. The receipt checker learnt this separately
   * and did the same thing, back when it still made outbound requests of its
   * own — an hour went into it from that side first.
   */
  private static parse(raw: string): string[] {
    return raw
      .split(',')
      .map((url) =>
        url
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .trim()
      )
      .filter(Boolean)
      .map((url) => (/^https?:\/\//.test(url) ? url : `http://${url}`))
  }

  /** How many addresses are configured. */
  get size(): number {
    return this.urls.length
  }

  /** Whether this pool can supply an agent at all. */
  get isConfigured(): boolean {
    return this.urls.length > 0
  }

  /** An agent on the current address, or nothing when the pool is empty. */
  agent(sessionId?: string): HttpsProxyAgent<string> | undefined {
    if (this.urls.length === 0) return undefined

    const url = this.urls[this.activeIndex]
    this.logger.debug(
      `Using proxy: ${this.mask(url)} from ${this.source} for session ${sessionId || 'none'}`
    )

    return new HttpsProxyAgent(url)
  }

  /**
   * Steps to the next address.
   *
   * The cooldown keeps a burst of failures from walking the whole list at once;
   * `force` is for a caller that has already decided this address is the
   * problem and is about to retry through the next one.
   */
  rotate(reason: string, force = false): void {
    if (this.urls.length <= 1) return

    const now = Date.now()
    if (!force && now - this.lastRotationTime < ROTATION_COOLDOWN_MS) return

    this.activeIndex = (this.activeIndex + 1) % this.urls.length
    this.lastRotationTime = now

    this.logger.warn(
      `Proxy rotated due to: "${reason}". ` +
        `New active index: ${this.activeIndex} / ${this.urls.length} (${this.source})`
    )
  }

  /** The address with its password removed, for a log line. */
  private mask(url: string): string {
    try {
      const parsed = new URL(url)

      return `${parsed.protocol}//${parsed.username}:***@${parsed.host}`
    } catch {
      // An unparseable URL here means HttpsProxyAgent is about to fail on it
      // too, so say which slot rather than losing the line entirely.
      return `<unparseable URL at index ${this.activeIndex} of ${this.source}>`
    }
  }
}
