import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { HttpsProxyAgent } from 'https-proxy-agent'
import { ERROR } from '@transacto/contracts'
import { ProxyPool } from 'src/shared/proxy/proxy-pool'
import environments from 'src/environments'

/**
 * The pool of outbound IPs, shared by everything that talks to somebody whose
 * WAF is watching.
 *
 * It lives in `shared/` rather than in `bank-scraper/`, where it was written,
 * because it is not about banks: it holds proxy URLs and rotates between them,
 * and the Transacto panel needs exactly the same thing for exactly the same
 * reason. Two copies would be two rotation policies for one pool of addresses.
 *
 * Nothing here is bank- or panel-specific. Who is allowed to run without a
 * proxy is the caller's decision — {@link getAgent} is best-effort and
 * {@link requiredAgent} refuses.
 *
 * The mechanics live in {@link ProxyPool}, extracted when PrivatBank once needed
 * a pool of its own. Both that second pool and every bank path this one carried
 * are gone now — all bank egress moved to the Isolated Scraper Worker — so this
 * pool is the **Transacto panel's alone**, kept here because the panel is a
 * logged-in write session and stays on the origin by design. What stays with it
 * is the policy it answers for: `PROXY_REQUIRED`.
 */
@Injectable()
export class ProxyManagerService {
  private readonly logger = new Logger(ProxyManagerService.name)
  private readonly pool = new ProxyPool('PROXY_URLS', environments.PROXY_URLS || '', this.logger)

  constructor() {
    if (this.pool.isConfigured)
      this.logger.log(`Initialized ProxyManagerService with ${this.pool.size} proxy URLs.`)
    else this.logger.warn('No PROXY_URLS configured. Requests will run without proxies.')
  }

  /** Whether any proxy is configured at all. */
  get isConfigured(): boolean {
    return this.pool.isConfigured
  }

  /**
   * The agent for a caller that must not go out directly.
   *
   * Fails closed, and that is the whole point: a caller that asked for a proxy
   * and silently got `undefined` would keep working — from our own address,
   * which is the outcome the proxy exists to prevent and the one nobody
   * notices until the address is blocked.
   *
   * The guard is `PROXY_REQUIRED`, so a developer with no proxy still runs
   * while production refuses to.
   */
  requiredAgent(consumer: string): HttpsProxyAgent<string> | undefined {
    const agent = this.getAgent(consumer)
    if (agent) return agent

    if (environments.PROXY_REQUIRED === 'true') {
      this.logger.error(`${consumer} requires a proxy and PROXY_URLS is empty — refusing to call`)
      throw new ServiceUnavailableException(ERROR.CONFIG.MISSING_PROXY)
    }

    this.logger.warn(`${consumer} is going out directly: no proxy configured`)

    return undefined
  }

  getAgent(sessionId?: string): HttpsProxyAgent<string> | undefined {
    // We don't inject session IDs into the username because this Proxy-Seller
    // package uses port-based rotation (e.g. ports 10000-10149 provide
    // different IPs). Sticky sessions are naturally maintained by the pool's
    // active index.
    return this.pool.agent(sessionId)
  }

  rotateProxy(reason: string, force = false): void {
    this.pool.rotate(reason, force)
  }
}
