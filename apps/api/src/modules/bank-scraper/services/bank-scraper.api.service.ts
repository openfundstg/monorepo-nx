import { ERROR } from '@transacto/contracts'
import { BadGatewayException, HttpException, Injectable, Logger } from '@nestjs/common'
import { EgressChannel, ScraperWorkerMethod } from 'src/shared/interfaces'
import { parseJsonBody, ScraperWorkerService } from 'src/shared/scraper-worker'
import type { PrivatSessionData } from 'src/modules/bank-scraper/interfaces'
import { BANK_API, BANK_HTTP } from 'src/modules/bank-scraper/constants'
import { bankHttpErrorForStatus, extractPrivatRefEnv, parseNovaPayCase, toBankHttpError } from 'src/shared/utils'
import { readSetCookie } from 'src/shared/utils/set-cookie.util'
import type {
  MonoRawResponse,
  NovaPayCaseData,
  PrivatInitResponse,
  PrivatRawResponse,
  PrivatZipLinkResponse,
  PumbRawResponse,
  ScraperWorkerRequest,
  ScraperWorkerResult
} from 'src/shared/interfaces'

/** Readable form of whatever was thrown, for the log line only. */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The browser identity every bank capture was taken with, replayed by the
 * worker. `Accept-Encoding` is deliberately absent — the worker owns it, since
 * it decodes the body.
 */
const BANK_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': BANK_HTTP.USER_AGENT,
  Accept: 'application/json'
}

/** The one field each caller varies; the rest of a scrape is the same every time. */
type BankScrape = Pick<ScraperWorkerRequest, 'url' | 'method' | 'body' | 'contentType' | 'cookie' | 'session'>

/**
 * Every outbound call to a bank, and nothing else.
 *
 * Transport only: build the request, hand back the parsed body. It maps HTTP
 * status codes onto `ERROR` codes because the status *is* transport, but it
 * makes no decision about what to do next — that belongs to the strategies and
 * to `ScraperExecutionService`, which reads the status off the exception to
 * choose between backing off, retrying and declaring a jar dead.
 *
 * **Every bank request goes out through the Isolated Scraper Worker on the
 * `POOL` channel**, so this process never opens the socket to a bank. The
 * proxy pool and the rotation policy that were an axios instance's job here now
 * live in the worker and its origin-side driver: the driver walks the pool on a
 * refusal, and each call carries the jar/box/hash as its worker `session` so a
 * bank keeps one exit across a handshake. What stays this class's job is the one
 * bank-specific thing the worker cannot know — that a status is an `ERROR`.
 */
@Injectable()
export class BankScraperApiService {
  private readonly logger = new Logger(BankScraperApiService.name)

  constructor(private readonly scraperWorker: ScraperWorkerService) {}

  // ---------------------------------------------------------------- Monobank

  /**
   * Reads a Monobank jar. Amounts come back in kopecks.
   *
   * @throws HttpException carrying the bank's status — 404 when the jar is gone,
   *   429/403 when we are rate-limited or WAF-blocked.
   */
  async fetchMonoJar(jarId: string): Promise<MonoRawResponse> {
    try {
      const result = await this.scrape({
        url: BANK_API.MONO_JAR(jarId),
        method: ScraperWorkerMethod.POST,
        body: '{}',
        contentType: 'application/json',
        session: jarId
      })
      return parseJsonBody<MonoRawResponse>(result)
    } catch (error) {
      this.logger.error(`Failed to fetch Monobank jar ${jarId}: ${describe(error)}`)
      throw this.asBankError(error)
    }
  }

  // -------------------------------------------------------------------- PUMB

  /**
   * Reads a PUMB donation box. See `adaptPumbBalance` for the encoding.
   *
   * @throws HttpException carrying the bank's status, same as every other bank.
   */
  async fetchPumbBox(boxId: string): Promise<PumbRawResponse> {
    try {
      const result = await this.scrape({
        url: BANK_API.PUMB_BOX(boxId),
        method: ScraperWorkerMethod.GET,
        session: boxId
      })
      return parseJsonBody<PumbRawResponse>(result)
    } catch (error) {
      this.logger.error(`Error scraping PUMB balance for box_id ${boxId}: ${describe(error)}`)
      throw this.asBankError(error)
    }
  }

  // ----------------------------------------------------------------- NovaPay

  /**
   * Reads a NovaPay case by fetching its page and digging the state out of it.
   *
   * The one bank here whose "API" is HTML. The worker returns the page as bytes
   * and the parser needs it as it arrived, so it is decoded and read whole.
   *
   * @throws HttpException carrying NovaPay's status, same as every other bank —
   *   plus `ERROR.SCRAPER.PROCESSING_FAILED` when the page came back without a
   *   state to read, which is what a redirect to an error page looks like.
   */
  async fetchNovaPayCase(publicId: string): Promise<NovaPayCaseData> {
    let html: string

    try {
      const result = await this.scrape({
        url: BANK_API.NOVAPAY_CASE(publicId),
        method: ScraperWorkerMethod.GET,
        session: publicId
      })
      html = result.body.toString('utf8')
    } catch (error) {
      this.logger.error(`Failed to fetch NovaPay case ${publicId}: ${describe(error)}`)
      throw this.asBankError(error)
    }

    const data = parseNovaPayCase(html)

    if (data === null) {
      // Loud, and without the body: the page is somebody else's markup and a
      // change to it is otherwise silent — the scrape would simply stop working.
      this.logger.error(`NovaPay case ${publicId} answered without a readable state`)
      throw new BadGatewayException({
        ...ERROR.SCRAPER.PROCESSING_FAILED,
        details: 'The NovaPay case page carried no __NOVA_DATA__ state'
      })
    }

    return data
  }

  // ------------------------------------------------------------- PrivatBank

  /**
   * Step 1 of the PrivatBank handshake.
   *
   * `pubkey` arrives as a Set-Cookie header rather than in the body, so it is
   * read here — cookie plumbing is transport, not business logic. The worker
   * returns it decoded; every later step in this handshake shares the same
   * worker `session` (the hash), so they leave through the one exit that set it.
   */
  async initPrivatSession(hash: string): Promise<{ xref?: string; pubkey: string }> {
    const timestamp = Date.now()
    const result = await this.scrape({
      url: BANK_API.PRIVAT_INIT(timestamp),
      method: ScraperWorkerMethod.POST,
      body: JSON.stringify({ lang: 'ua', _: timestamp }),
      contentType: 'application/json',
      session: hash
    })

    const data = parseJsonBody<PrivatInitResponse>(result)

    return {
      xref: data?.data?.xref,
      pubkey: readSetCookie(result.setCookie, 'pubkey') ?? ''
    }
  }

  /** Step 2 — exchanges the share hash for the envelope reference. */
  async fetchPrivatZipLink(
    hash: string,
    xref: string,
    pubkey: string
  ): Promise<PrivatZipLinkResponse> {
    const result = await this.scrape({
      url: BANK_API.PRIVAT_ZIPLINK,
      method: ScraperWorkerMethod.POST,
      body: JSON.stringify({ action: 'get', hash, type: 'sharing', xref }),
      contentType: 'application/json',
      cookie: `pubkey=${pubkey}`,
      session: hash
    })

    return parseJsonBody<PrivatZipLinkResponse>(result)
  }

  /**
   * The envelope's public record, for a link that has no terminal yet.
   *
   * Runs the same three calls `PrivatScraperStrategy` runs. All three share the
   * hash as their worker session, so the handshake keeps one exit across its
   * steps — the coherence the sticky proxy agent used to give it.
   *
   * Lives here rather than being re-implemented in the Mini App's resolver so
   * there is one statement of PrivatBank's handshake — the endpoints already
   * are shared constants, and the sequence should be too.
   */
  async fetchPrivatEnvelope(hash: string): Promise<PrivatRawResponse> {
    const { xref, pubkey } = await this.initPrivatSession(hash)
    if (!xref || !pubkey) {
      throw new BadGatewayException({
        ...ERROR.SCRAPER.PROCESSING_FAILED,
        details: 'PrivatBank returned no xref or pubkey (step 1)'
      })
    }

    const refEnv = extractPrivatRefEnv(await this.fetchPrivatZipLink(hash, xref, pubkey))
    if (!refEnv) {
      throw new BadGatewayException({
        ...ERROR.SCRAPER.PROCESSING_FAILED,
        details: 'PrivatBank returned no refEnv (step 2)'
      })
    }

    return this.fetchPrivatBalance({ hash, pubkey, xref, refEnv })
  }

  /** Step 3 — the balance itself, using an established session. */
  async fetchPrivatBalance(session: PrivatSessionData): Promise<PrivatRawResponse> {
    const result = await this.scrape({
      url: BANK_API.PRIVAT_BALANCE,
      method: ScraperWorkerMethod.POST,
      body: JSON.stringify({ refEnv: session.refEnv, xref: session.xref, _: Date.now() }),
      contentType: 'application/json',
      cookie: `pubkey=${session.pubkey}`,
      session: session.hash
    })

    return parseJsonBody<PrivatRawResponse>(result)
  }

  // ----------------------------------------------------------------- worker

  /**
   * One scrape through the worker, with a bank's status turned into the
   * `ERROR` the rest of the stack reads. A `2xx` is the only answer that
   * returns; anything else — or a transport failure the worker's pool walk
   * could not get past — is thrown as an {@link HttpException} carrying the
   * status, exactly as the axios path did.
   */
  private async scrape(spec: BankScrape): Promise<ScraperWorkerResult> {
    let result: ScraperWorkerResult
    try {
      result = await this.scraperWorker.request(
        { channel: EgressChannel.POOL, headers: BANK_HEADERS, ...spec },
        { consumer: 'bank scrape' }
      )
    } catch (error) {
      // The driver walked the pool and still could not deliver — a
      // network-class failure with no status of the bank's own.
      throw bankHttpErrorForStatus(undefined, describe(error))
    }

    if (result.upstreamStatus < 200 || result.upstreamStatus >= 300)
      throw bankHttpErrorForStatus(result.upstreamStatus)

    return result
  }

  private asBankError(error: unknown): HttpException {
    return error instanceof HttpException ? error : toBankHttpError(error)
  }
}
