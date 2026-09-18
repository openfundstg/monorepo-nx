import { ServiceUnavailableException } from '@nestjs/common'
import {
  EgressChannel,
  ScraperWorkerErrorCode,
  type ScraperWorkerOutcome,
  type ScraperWorkerRequest,
  type ScraperWorkerResult
} from 'src/shared/interfaces'
import { ScraperWorkerApiService } from 'src/shared/scraper-worker/scraper-worker.api.service'
import { ScraperWorkerService } from 'src/shared/scraper-worker/scraper-worker.service'

const REQUEST: ScraperWorkerRequest = { url: 'https://ca.monobank.ua/x', channel: EgressChannel.POOL }

const ok = (upstreamStatus: number): ScraperWorkerOutcome => ({
  ok: true,
  result: { upstreamStatus, body: Buffer.from('ok') } as ScraperWorkerResult
})
const fail = (code: ScraperWorkerErrorCode): ScraperWorkerOutcome => ({ ok: false, code, status: 502 })

describe('ScraperWorkerService', () => {
  let send: jest.Mock<Promise<ScraperWorkerOutcome>, [ScraperWorkerRequest]>
  let service: ScraperWorkerService

  beforeEach(() => {
    send = jest.fn()
    const api = { isConfigured: true, send } as unknown as ScraperWorkerApiService
    service = new ScraperWorkerService(api)
  })

  it('returns a 200 without rotating', async () => {
    send.mockResolvedValueOnce(ok(200))
    const result = await service.request(REQUEST)
    expect(result.upstreamStatus).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].rotate).toBe(false)
  })

  it('treats a 400 as an answer, not a reason to rotate', async () => {
    send.mockResolvedValueOnce(ok(400))
    const result = await service.request(REQUEST)
    expect(result.upstreamStatus).toBe(400)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rotates on PROXY_REFUSED; a one-shot stays sessionless', async () => {
    send.mockResolvedValueOnce(fail(ScraperWorkerErrorCode.PROXY_REFUSED)).mockResolvedValueOnce(ok(200))
    const result = await service.request(REQUEST)
    expect(result.upstreamStatus).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0].rotate).toBe(false)
    expect(send.mock.calls[1][0].rotate).toBe(true)
    // No caller session, so none is invented — the worker advances the pool itself.
    expect(send.mock.calls[0][0].session).toBeUndefined()
    expect(send.mock.calls[1][0].session).toBeUndefined()
  })

  it('rotates on a repairable upstream status and returns the last one when exhausted', async () => {
    send.mockResolvedValue(ok(503))
    const result = await service.request(REQUEST)
    expect(result.upstreamStatus).toBe(503)
    expect(send).toHaveBeenCalledTimes(3) // PROXY_ATTEMPTS
  })

  it('carries a caller session on every attempt of a multi-call chain', async () => {
    send.mockResolvedValueOnce(fail(ScraperWorkerErrorCode.PROXY_REFUSED)).mockResolvedValueOnce(ok(200))
    await service.request({ ...REQUEST, session: 'topup:7' })
    expect(send.mock.calls[0][0].session).toBe('topup:7')
    expect(send.mock.calls[1][0].session).toBe('topup:7')
  })

  it('does not rotate on a non-retryable worker code', async () => {
    send.mockResolvedValueOnce(fail(ScraperWorkerErrorCode.CHANNEL_UNAVAILABLE))
    await expect(service.request(REQUEST)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses to run when the worker is not configured', async () => {
    const unconfigured = new ScraperWorkerService({ isConfigured: false } as unknown as ScraperWorkerApiService)
    await expect(unconfigured.request(REQUEST)).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  /**
   * **The hop to the worker is itself a Tor circuit**, and a circuit that drops
   * mid-request throws out of the transport rather than answering with a code.
   * That escaped the walk entirely: one `socket hang up` on the onion hop and a
   * seller's bank statement came back "we could not check it", with no rotation
   * attempted. It is the failure another attempt is most likely to fix, and it
   * was the only one not retried.
   */
  describe('when the worker itself cannot be reached', () => {
    const unreachable = (): Error =>
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })

    it('rotates rather than giving up', async () => {
      send.mockRejectedValueOnce(unreachable()).mockResolvedValueOnce(ok(200))

      const result = await service.request(REQUEST)

      expect(result.upstreamStatus).toBe(200)
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls[1][0].rotate).toBe(true)
    })

    it('keeps walking across several dropped circuits', async () => {
      send
        .mockRejectedValueOnce(unreachable())
        .mockRejectedValueOnce(unreachable())
        .mockResolvedValueOnce(ok(200))

      await expect(service.request(REQUEST)).resolves.toMatchObject({ upstreamStatus: 200 })
      expect(send).toHaveBeenCalledTimes(3)
    })

    /** And still gives up in the end, rather than walking for ever. */
    it('refuses once every attempt has been spent', async () => {
      send.mockRejectedValue(unreachable())

      await expect(service.request(REQUEST)).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    /** A caller that must not rotate does not get a second try either. */
    it('does not retry a call pinned to one exit', async () => {
      send.mockRejectedValue(unreachable())

      await expect(service.request(REQUEST, { maxAttempts: 1 })).rejects.toBeInstanceOf(
        ServiceUnavailableException
      )
      expect(send).toHaveBeenCalledTimes(1)
    })
  })

})
