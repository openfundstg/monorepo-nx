import { HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { parseJsonBody, ScraperWorkerService } from 'src/shared/scraper-worker'
import {
  EgressChannel,
  ScraperWorkerMethod,
  type MonobankCaError,
  type MonobankCaVerifyRequest,
  type MonobankCaVerifyResponse,
  type ReceiptFile
} from 'src/shared/interfaces'

const BASE_URL = 'https://ca.monobank.ua'
const VERIFY_PATH = '/siteapi/verify'

/** Who we are to the scraper worker, for its log lines. */
const WORKER_CONSUMER = 'monobank signature check'

/**
 * A ceiling on their answer.
 *
 * Their success body is around forty kilobytes, most of it the ETSI validation
 * report as base64 XML. This is generous next to that and small enough that a
 * response which is not theirs cannot be read into memory unbounded.
 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/**
 * Sent on every call, as their page sends them, and replayed verbatim by the
 * worker.
 *
 * Copied rather than tidied, on the rule this repo already follows for the
 * Transacto panel and PrivatBank: a request that differs from the captured one
 * differs in a way nobody has tested. The `User-Agent` is a browser's own
 * because the worker's proxy fixes the address and `axios/1.x` from a datacentre
 * would be the other half of the signal.
 *
 * **`x-captcha` is deliberately absent.** Their page sends one; the endpoint
 * answers `200` without it, verified against a real receipt. Sending an invented
 * token would be worse than sending none — it is a field they may one day start
 * checking, and a wrong value fails where an absent one does not.
 *
 * **`Content-Type` and `Accept-Encoding` are deliberately absent here.** The
 * first travels as the request's own `contentType`; the second is the worker's
 * to set, because it decodes the body and must only advertise what it can read.
 */
const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/verify/`,
  Accept: '*/*',
  'Accept-Language': 'uk,uk-UA;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6',
  'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  Priority: 'u=1, i'
} as const

/**
 * Everything this process says to monobank's certification service, and nothing
 * it decides.
 *
 * Transport only, by the layering rule: it hands over a file and returns what
 * came back. Whether the answer proves anything — whether the signature holds,
 * and whether the signer is actually the bank — is the adapter's question.
 *
 * **Their `400` is an answer, not a failure**, and that is why it is returned
 * rather than thrown. A body that is not a signed container at all comes back
 * as `{"errCode":"BAD_REQUEST"}`, which is them telling us something true about
 * the upload: it is a screenshot, or a re-printed PDF, or anything else with no
 * signature on it. A caller that saw an exception there would record a user's
 * ordinary mistake as an outage and send it to an operator.
 */
@Injectable()
export class MonobankCaApiService {
  constructor(private readonly scraperWorker: ScraperWorkerService) {}

  /**
   * Their verdict on one uploaded container.
   *
   * The bytes go up exactly as they arrived: a qualified signature is over
   * those precise bytes, and anything that re-encoded them first would be
   * handing over a document the service must refuse. The base64 is the JSON
   * body's, not a re-encoding of the container — the worker relays it whole.
   *
   * Reached through the Isolated Scraper Worker on the `POOL` channel: their CA
   * answers from residential addresses and refuses Tor exits. The worker holds
   * the pool and rotates on a refusal; this service keeps the one bank-specific
   * rule — **their `400` is an answer, not a failure.** A body that is not a
   * signed container comes back as `{"errCode":"BAD_REQUEST"}`, telling us the
   * upload is a screenshot or a re-printed PDF, so it is returned; any other
   * status is a real failure the worker's rotation could not get past.
   */
  async verify(file: ReceiptFile): Promise<MonobankCaVerifyResponse | MonobankCaError> {
    const body: MonobankCaVerifyRequest = {
      files: [Buffer.from(file.buffer).toString('base64')]
    }

    const result = await this.scraperWorker.request(
      {
        url: `${BASE_URL}${VERIFY_PATH}`,
        channel: EgressChannel.POOL,
        method: ScraperWorkerMethod.POST,
        body: JSON.stringify(body),
        contentType: 'application/json',
        headers: PAGE_HEADERS,
        maxBytes: MAX_RESPONSE_BYTES
      },
      { consumer: WORKER_CONSUMER }
    )

    // 200 is their verdict; 400 is their refusal of an unsigned file, which is
    // the answer this caller most needs to read. Anything else is not an answer.
    if (result.upstreamStatus !== HttpStatus.OK && result.upstreamStatus !== HttpStatus.BAD_REQUEST) {
      throw new ServiceUnavailableException(
        `monobank signature check answered ${result.upstreamStatus}`
      )
    }

    return parseJsonBody<MonobankCaVerifyResponse | MonobankCaError>(result)
  }
}
