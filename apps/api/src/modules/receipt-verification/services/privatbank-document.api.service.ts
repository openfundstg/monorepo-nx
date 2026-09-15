import { randomUUID } from 'node:crypto'
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { parseJsonBody, ScraperWorkerService } from 'src/shared/scraper-worker'
import { readSetCookie } from 'src/shared/utils/set-cookie.util'
import {
  EgressChannel,
  ScraperWorkerMethod,
  type PrivatbankDocumentType,
  type PrivatbankFindDocumentResponse,
  type ReceiptFile
} from 'src/shared/interfaces'
import environments from 'src/environments'

const BASE_URL = 'https://privatbank.ua'
const FIND_PATH = '/pb/ajax/find-document'
const DOWNLOAD_PATH = '/pb/get-doc/download'

/** The cookie their lookup sets and their download insists on. */
const SESSION_COOKIE = 'PHPSESSID'

/** Who we are to the scraper worker, for its log lines. */
const WORKER_CONSUMER = 'PrivatBank documents'

/**
 * Sent on every call, exactly as their page sends them, and replayed verbatim by
 * the worker.
 *
 * `X-Requested-With` and the `Origin`/`Referer` pair are copied rather than
 * tidied, on the principle the panel client already follows: a request that
 * differs from the captured one differs in a way nobody has tested. The
 * `User-Agent` is a browser's own — the worker's proxy fixes the address, and
 * `axios/1.x` from a datacentre is the other half of the signal.
 *
 * **`Content-Type` and `Accept-Encoding` are deliberately absent.** The first
 * travels as the request's own `contentType`; the second is the worker's to set,
 * because it decodes the body and must only advertise what it can read. Their
 * page advertises `zstd`, which Node could not decode — the same trap the panel
 * client documents — but the worker can, so it advertises its own supported set.
 */
const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/check`,
  'X-Requested-With': 'XMLHttpRequest',
  'Accept-Language': 'uk,uk-UA;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  Priority: 'u=1, i'
} as const

/** The session a download has to be asked under. */
export interface PrivatbankDocumentGrant {
  /** The CSRF token their lookup issued. Useless without {@link cookie}. */
  readonly token: string
  /** The `PHPSESSID` set by the very response that issued the token. */
  readonly cookie: string
  /**
   * The worker session the lookup ran under. The download reuses it so both
   * leave through the same exit — the cookie is bound not just to `PHPSESSID`
   * but to the Tor circuit that opened it.
   */
  readonly session: string
}

/**
 * Everything this process says to `privatbank.ua/check`, and nothing it decides.
 *
 * Transport only, by the layering rule: it looks a code up and it downloads a
 * document. Whether that document proves anything is the adapter's question.
 *
 * **Reached through the Isolated Scraper Worker on the `TOR` channel.** Their
 * provider refuses residential-pool ranges for banking domains, so PrivatBank is
 * the one path that needs Tor; the worker holds that pool of circuits, one per
 * proxy username.
 *
 * **The session is the awkward part, and it is theirs, not ours.** Their lookup
 * answers with a CSRF token *and* sets a `PHPSESSID`, and the download refuses
 * the token without that cookie — verified by presenting a token issued to
 * another session, which answers `500` and an HTML error page. So the two travel
 * together in a {@link PrivatbankDocumentGrant}, along with the worker session
 * that keeps both legs on one exit: a cookie minted through one circuit and
 * presented through another is a session that moved address mid-conversation.
 */
@Injectable()
export class PrivatbankDocumentApiService {
  private readonly logger = new Logger(PrivatbankDocumentApiService.name)

  constructor(private readonly scraperWorker: ScraperWorkerService) {}

  private get maxBytes(): number {
    return Number(environments.RECEIPT_DOCUMENT_MAX_BYTES || String(10 * 1024 * 1024))
  }

  /**
   * Asks whether a document with this code exists.
   *
   * Returns their body and the session it belongs to — the `PHPSESSID` and the
   * worker session that will carry the download to the same exit. Their transport
   * status is `200` for every outcome that is not malformed — "found" and "not
   * found" differ only in `status` — so anything else is a failure to reach them,
   * not their answer, and it is thrown. The worker's driver has already walked
   * the pool before this line; a status here is what a live exit returned.
   */
  async findDocument(
    type: PrivatbankDocumentType,
    id: string
  ): Promise<{ body: PrivatbankFindDocumentResponse; cookie: string; session: string }> {
    // One worker session for the lookup and the download after it, so both leave
    // through the same Tor circuit.
    const session = `privat:${randomUUID()}`
    const form = new URLSearchParams({ 'document[type]': type, 'document[id]': id }).toString()

    const result = await this.scraperWorker.request(
      {
        url: `${BASE_URL}${FIND_PATH}`,
        channel: EgressChannel.TOR,
        method: ScraperWorkerMethod.POST,
        body: form,
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        headers: { ...PAGE_HEADERS, Accept: 'application/json, text/javascript, */*; q=0.01' },
        session
      },
      { consumer: WORKER_CONSUMER }
    )

    if (result.upstreamStatus !== 200)
      throw new ServiceUnavailableException(`PrivatBank lookup answered ${result.upstreamStatus}`)

    return {
      body: parseJsonBody<PrivatbankFindDocumentResponse>(result),
      cookie: readSetCookie(result.setCookie, SESSION_COOKIE) ?? '',
      session
    }
  }

  /**
   * Downloads the document a grant was issued for.
   *
   * A plain PDF, unlike monobank's, which arrives wrapped in a PKCS#7 container
   * — so there is nothing to unwrap here and the bytes go on as they came.
   *
   * **One attempt, never rotated.** The grant is bound to the session the lookup
   * opened, and that session was opened through one exit — asking again from
   * another presents a cookie minted somewhere else, which is a session moving
   * mid-conversation rather than a retry. `maxAttempts: 1` on the same worker
   * session is what holds it to that one circuit.
   */
  async downloadReceipt(id: string, grant: PrivatbankDocumentGrant): Promise<ReceiptFile> {
    const url =
      `${BASE_URL}${DOWNLOAD_PATH}/receipt/${encodeURIComponent(id)}` +
      `?csrf=${encodeURIComponent(grant.token)}`

    const result = await this.scraperWorker.request(
      {
        url,
        channel: EgressChannel.TOR,
        method: ScraperWorkerMethod.GET,
        headers: { ...PAGE_HEADERS, Accept: 'application/pdf,*/*' },
        cookie: `${SESSION_COOKIE}=${grant.cookie}`,
        session: grant.session,
        maxBytes: this.maxBytes
      },
      { consumer: WORKER_CONSUMER, maxAttempts: 1 }
    )

    if (result.upstreamStatus !== 200)
      throw new ServiceUnavailableException(`PrivatBank download answered ${result.upstreamStatus}`)

    this.logger.debug(`PrivatBank served ${result.body.length} bytes for a receipt`)

    return {
      buffer: result.body,
      fileName: `receipt-${id}.pdf`,
      mimeType: 'application/pdf'
    }
  }
}
