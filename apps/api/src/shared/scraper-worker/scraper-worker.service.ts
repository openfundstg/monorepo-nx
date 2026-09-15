import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  ScraperWorkerErrorCode,
  type ScraperWorkerRequest,
  type ScraperWorkerResult
} from 'src/shared/interfaces'
import { PROXY_ATTEMPTS, PROXY_REPAIRABLE_STATUSES } from 'src/shared/utils'
import { ScraperWorkerApiService } from 'src/shared/scraper-worker/scraper-worker.api.service'

/**
 * Worker failures worth another exit: the exit could not deliver (`PROXY_REFUSED`
 * / `UPSTREAM_TIMEOUT`) or the worker was momentarily full (`BUSY`). Every other
 * `ok: false` — an unknown channel, a rejected request — is our own bug and
 * retrying only spends time repeating it.
 */
const RETRYABLE_CODES: ReadonlySet<ScraperWorkerErrorCode> = new Set([
  ScraperWorkerErrorCode.PROXY_REFUSED,
  ScraperWorkerErrorCode.UPSTREAM_TIMEOUT,
  ScraperWorkerErrorCode.BUSY
])

export interface ScraperWorkerRequestOptions {
  /**
   * Upstream statuses that mean "try another exit", not "this is the answer".
   * Defaults to {@link PROXY_REPAIRABLE_STATUSES} — a WAF turning the address
   * away. A `404` or a `400` is an answer and must **not** be here, or an exit is
   * spent to hear the same thing.
   */
  readonly rotateOnUpstreamStatuses?: readonly number[]
  /**
   * How many exits to walk. Defaults to {@link PROXY_ATTEMPTS}. Pass `1` for a
   * call that must not rotate — the second leg of a session chain, whose cookie
   * was minted through one exit and is meaningless through any other.
   */
  readonly maxAttempts?: number
  /** Who is calling, for the log line. */
  readonly consumer?: string
}

/**
 * The origin's egress brain, driving the worker.
 *
 * **The worker holds the proxies; this holds the policy.** It decides *when* to
 * rotate — the same rule the local pool used ({@link PROXY_ATTEMPTS} addresses,
 * {@link PROXY_REPAIRABLE_STATUSES}) — and drives the worker's exit affinity
 * through `session` + `rotate`, while the worker only carries a request out and
 * steps to the next exit when told. So a compromise of the throwaway box costs
 * the proxy list, never the logic that has learned each destination's quirks.
 *
 * A multi-call chain (a document lookup then its download) passes its own stable
 * `session` so both legs leave from one exit; a one-shot call gets a fresh
 * session per walk.
 */
@Injectable()
export class ScraperWorkerService {
  private readonly logger = new Logger(ScraperWorkerService.name)

  constructor(private readonly api: ScraperWorkerApiService) {}

  /**
   * One request, walked across up to {@link PROXY_ATTEMPTS} exits when the
   * failure is about the exit. Returns the worker's result — including a target
   * `4xx`/`5xx`, which is an answer, not a failure of ours; only the worker
   * itself refusing in a way no exit fixes throws.
   */
  async request(request: ScraperWorkerRequest, options: ScraperWorkerRequestOptions = {}): Promise<ScraperWorkerResult> {
    if (!this.api.isConfigured)
      throw new ServiceUnavailableException('Scraper worker is not configured — refusing to call directly')

    const consumer = options.consumer ?? 'scraper worker'
    const rotateOn = options.rotateOnUpstreamStatuses ?? PROXY_REPAIRABLE_STATUSES
    const attempts = options.maxAttempts ?? PROXY_ATTEMPTS

    // `request.session` is passed through untouched: only a caller's multi-call
    // chain sets one, so both its legs share an exit. A one-shot leaves it unset,
    // and the worker then advances the pool on every call — rotating the walk
    // without pinning an exit it would have to remember for a request that will
    // not come back.
    for (let index = 0; index < attempts; index++) {
      const isLast = index === attempts - 1
      const outcome = await this.api.send({ ...request, rotate: index > 0 })

      if (outcome.ok) {
        if (isLast || !rotateOn.includes(outcome.result.upstreamStatus)) return outcome.result
        this.rotating(consumer, request.channel, `upstream ${outcome.result.upstreamStatus}`, index + 2)
        continue
      }

      if (isLast || !RETRYABLE_CODES.has(outcome.code))
        throw new ServiceUnavailableException(`Scraper worker could not complete a ${consumer} request: ${outcome.code}`)
      this.rotating(consumer, request.channel, `worker ${outcome.code}`, index + 2)
    }

    // Unreachable — the final attempt always returns or throws above.
    throw new ServiceUnavailableException(`Scraper worker exhausted its attempts for a ${consumer} request`)
  }

  private rotating(consumer: string, channel: string, reason: string, nextAttempt: number): void {
    this.logger.warn(
      `A ${consumer} request failed in a way another exit may fix (${reason}, channel ${channel}); ` +
        `rotating — attempt ${nextAttempt} of ${PROXY_ATTEMPTS}`
    )
  }
}
