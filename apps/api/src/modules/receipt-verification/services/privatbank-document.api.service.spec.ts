import { EgressChannel, ScraperWorkerMethod, type ScraperWorkerResult } from 'src/shared/interfaces'
import type { ScraperWorkerService } from 'src/shared/scraper-worker'
import { PrivatbankDocumentType } from 'src/shared/interfaces'
import { PrivatbankDocumentApiService, type PrivatbankDocumentGrant } from './privatbank-document.api.service'

const CODE = 'P24A0000000000A0000'

const result = (over: Partial<ScraperWorkerResult>): ScraperWorkerResult => ({
  upstreamStatus: 200,
  body: Buffer.from(''),
  ...over
})

/**
 * Rotation across a dead exit is the worker driver's job now, proven in its own
 * spec. What this file holds is the part unique to PrivatBank: the shape of the
 * two requests, and the session that ties the download to the exit the lookup
 * opened.
 */
describe('PrivatbankDocumentApiService', () => {
  let request: jest.Mock<Promise<ScraperWorkerResult>, [unknown, unknown?]>
  let service: PrivatbankDocumentApiService

  beforeEach(() => {
    request = jest.fn()
    service = new PrivatbankDocumentApiService({ request } as unknown as ScraperWorkerService)
  })

  describe('findDocument', () => {
    const foundBody = { status: true, token: 'tok', document_name: `receipt-${CODE}.pdf` }
    const lookup = () => service.findDocument(PrivatbankDocumentType.RECEIPT, CODE)

    it('asks over the TOR channel and returns the body, cookie and its session', async () => {
      request.mockResolvedValue(
        result({ body: Buffer.from(JSON.stringify(foundBody)), setCookie: ['PHPSESSID=abc; path=/; HttpOnly'] })
      )

      const answer = await lookup()

      const [req, options] = request.mock.calls[0]
      expect(req).toMatchObject({
        url: 'https://privatbank.ua/pb/ajax/find-document',
        channel: EgressChannel.TOR,
        method: ScraperWorkerMethod.POST,
        body: 'document%5Btype%5D=receipt&document%5Bid%5D=P24A0000000000A0000',
        contentType: 'application/x-www-form-urlencoded; charset=UTF-8'
      })
      // A captured browser header is replayed, not dropped.
      expect((req as { headers: Record<string, string> }).headers['X-Requested-With']).toBe('XMLHttpRequest')
      expect((req as { session: string }).session).toMatch(/^privat:/)
      // The lookup walks the pool (no attempt cap).
      expect((options as { maxAttempts?: number }).maxAttempts).toBeUndefined()

      expect(answer.body.status).toBe(true)
      expect(answer.cookie).toBe('abc')
      expect(answer.session).toBe((req as { session: string }).session)
    })

    it('throws when their lookup is unreachable (a non-200)', async () => {
      request.mockResolvedValue(result({ upstreamStatus: 503 }))
      await expect(lookup()).rejects.toThrow()
    })
  })

  describe('downloadReceipt', () => {
    const grant: PrivatbankDocumentGrant = { token: 'tok', cookie: 'abc', session: 'privat:fixed' }

    it('downloads on the same session and exit, without rotating', async () => {
      const pdf = Buffer.from('%PDF-1.7 receipt')
      request.mockResolvedValue(result({ body: pdf, contentType: 'application/pdf' }))

      const file = await service.downloadReceipt(CODE, grant)

      const [req, options] = request.mock.calls[0]
      expect(req).toMatchObject({
        url: `https://privatbank.ua/pb/get-doc/download/receipt/${CODE}?csrf=tok`,
        channel: EgressChannel.TOR,
        method: ScraperWorkerMethod.GET,
        cookie: 'PHPSESSID=abc',
        session: 'privat:fixed' // the exit the lookup opened
      })
      // One attempt: the cookie is bound to this exit, so a rotation would break it.
      expect((options as { maxAttempts: number }).maxAttempts).toBe(1)

      expect(file).toEqual({ buffer: pdf, fileName: `receipt-${CODE}.pdf`, mimeType: 'application/pdf' })
    })

    it('throws when the download is refused (a non-200)', async () => {
      request.mockResolvedValue(result({ upstreamStatus: 500 }))
      await expect(service.downloadReceipt(CODE, grant)).rejects.toThrow()
    })
  })
})
