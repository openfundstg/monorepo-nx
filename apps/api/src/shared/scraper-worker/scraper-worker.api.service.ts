import { HttpService } from '@nestjs/axios'
import { Injectable, Logger } from '@nestjs/common'
import { HttpProxyAgent } from 'http-proxy-agent'
import environments from 'src/environments'
import {
  ScraperWorkerErrorCode,
  type ScraperWorkerOutcome,
  type ScraperWorkerRequest,
  type ScraperWorkerResult
} from 'src/shared/interfaces'

const SCRAPE_PATH = '/scrape'

/** A generous ceiling above the worker's own 16 MB body cap, so axios never truncates first. */
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ScraperWorkerErrorCode))

/**
 * Everything this process says to the Isolated Scraper Worker, and nothing it
 * decides. Transport only, by the layering rule: it builds the request, sends it
 * over Tor, and reports what came back — whether to rotate and retry is the
 * driver's question.
 *
 * **The origin reaches the worker only over Tor.** The request goes to the
 * worker's `.onion` address through the same `tor` container the PrivatBank
 * scrape already uses (`SCRAPER_WORKER_PROXY_URL`, an HTTP tunnel), so this
 * machine never learns the worker's IP and the worker never learns this one's.
 *
 * A non-200 from the worker is *its* refusal — a dead exit, a channel it does
 * not hold — and is returned as `ok: false`, not thrown. Only failing to reach
 * the worker at all throws: there is no fallback, because a direct request is
 * exactly what the worker exists to prevent.
 */
@Injectable()
export class ScraperWorkerApiService {
  private readonly logger = new Logger(ScraperWorkerApiService.name)
  private cachedAgent: HttpProxyAgent<string> | undefined

  constructor(private readonly httpService: HttpService) {}

  /** Whether the worker URL, token and Tor tunnel are all configured. */
  get isConfigured(): boolean {
    return Boolean(
      environments.SCRAPER_WORKER_URL && environments.SCRAPER_WORKER_TOKEN && environments.SCRAPER_WORKER_PROXY_URL
    )
  }

  private get timeoutMs(): number {
    return Number(environments.SCRAPER_WORKER_TIMEOUT_MS || '40000')
  }

  /** The Tor tunnel to the onion, built once. */
  private get agent(): HttpProxyAgent<string> {
    return (this.cachedAgent ??= new HttpProxyAgent(environments.SCRAPER_WORKER_PROXY_URL))
  }

  async send(request: ScraperWorkerRequest): Promise<ScraperWorkerOutcome> {
    const response = await this.httpService.axiosRef.post<ArrayBuffer>(
      `${environments.SCRAPER_WORKER_URL}${SCRAPE_PATH}`,
      request,
      {
        timeout: this.timeoutMs,
        responseType: 'arraybuffer',
        // Only over Tor, and never through axios's own env proxy handling.
        httpAgent: this.agent,
        proxy: false,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
        headers: {
          Authorization: `Bearer ${environments.SCRAPER_WORKER_TOKEN}`,
          'Content-Type': 'application/json'
        },
        // The worker's status is ours to interpret, not axios's to throw on.
        validateStatus: () => true
      }
    )

    if (response.status === 200) return { ok: true, result: this.parseResult(response.data, response.headers) }

    return { ok: false, code: this.parseCode(response.data), status: response.status }
  }

  private parseResult(data: ArrayBuffer, headers: Record<string, unknown>): ScraperWorkerResult {
    const setCookie = this.header(headers, 'x-upstream-set-cookie')

    return {
      upstreamStatus: Number(this.header(headers, 'x-upstream-status')),
      contentType: this.header(headers, 'x-upstream-content-type'),
      location: this.header(headers, 'x-upstream-location'),
      // The worker base64s the newline-joined Set-Cookie header(s); split once
      // here so every caller gets the array `readSetCookie` expects.
      setCookie: setCookie === undefined ? undefined : Buffer.from(setCookie, 'base64').toString('utf8').split('\n'),
      body: Buffer.from(data)
    }
  }

  private parseCode(data: ArrayBuffer): ScraperWorkerErrorCode {
    try {
      const { code } = JSON.parse(Buffer.from(data).toString('utf8')) as { code?: unknown }
      if (typeof code === 'string' && KNOWN_CODES.has(code)) return code as ScraperWorkerErrorCode
    } catch {
      // A worker error body that is not `{ code }` is itself a fault; fall through.
    }
    this.logger.error('Scraper worker returned an unrecognised error body')

    return ScraperWorkerErrorCode.INTERNAL
  }

  private header(headers: Record<string, unknown>, name: string): string | undefined {
    const value = headers[name]

    return typeof value === 'string' ? value : undefined
  }
}
