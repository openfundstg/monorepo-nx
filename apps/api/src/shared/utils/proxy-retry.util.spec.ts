import { AxiosError, AxiosHeaders } from 'axios'
import {
  describeRefusal,
  isRepairableThroughAnotherProxy,
  PROXY_REPAIRABLE_STATUSES
} from './proxy-retry.util'

const httpFailure = (
  status: number,
  data?: unknown,
  responseHeaders: Record<string, string> = {}
): AxiosError => {
  const error = new AxiosError('failed', 'ERR_BAD_RESPONSE')
  error.response = {
    status,
    statusText: '',
    data,
    headers: new AxiosHeaders(responseHeaders),
    config: { headers: new AxiosHeaders() }
  }

  return error
}

const transportFailure = (code: string): AxiosError => new AxiosError('failed', code)

describe('isRepairableThroughAnotherProxy', () => {
  /**
   * The one that put this file here: PrivatBank answered `503` to every lookup
   * through the pool while answering `200` to the same request made directly.
   */
  it.each(PROXY_REPAIRABLE_STATUSES)('retries a %i, which is about the address', (status) => {
    expect(isRepairableThroughAnotherProxy(httpFailure(status))).toBe(true)
  })

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'])(
    'retries %s, which is an exit that went away',
    (code) => {
      expect(isRepairableThroughAnotherProxy(transportFailure(code))).toBe(true)
    }
  )

  /**
   * Deliberately narrow. Retrying an answer from a new address only spends an
   * IP to be told the same thing — which on a rate-limited pool is how a real
   * outage gets manufactured out of a bad request.
   */
  it.each([400, 401, 404, 409, 422, 500])('never retries a %i, which is an answer', (status) => {
    expect(isRepairableThroughAnotherProxy(httpFailure(status))).toBe(false)
  })

  it('ignores anything that is not an HTTP failure', () => {
    expect(isRepairableThroughAnotherProxy(new Error('nope'))).toBe(false)
    expect(isRepairableThroughAnotherProxy(null)).toBe(false)
  })
})

describe('describeRefusal', () => {
  /**
   * The distinction an operator actually needs: a WAF serves a page and names
   * itself, a dead exit serves nothing, and both arrive here as `503`.
   */
  it('reports the size of a refusal', () => {
    expect(describeRefusal(httpFailure(503, 'x'.repeat(1200)))).toContain('503, 1200 bytes')
  })

  /**
   * The question a bare `503` cannot answer on its own. PrivatBank returned one
   * with an empty body through the proxy pool while answering `200` directly,
   * and "who said this" is what decides whether to look at them, at whatever is
   * in front of them, or at the proxy.
   */
  it('names who answered, when they say', () => {
    const refusal = httpFailure(503, '', { server: 'nginx' })

    expect(describeRefusal(refusal)).toContain('from server=nginx')
  })

  /**
   * **The shape that cost a day.** Reproduced against a proxy that refuses every
   * tunnel: a proxy declining `CONNECT` answers on the socket the request was
   * about to use, so Node parses its reply as the destination's. axios reports
   * `503`, `ERR_BAD_RESPONSE` and an empty body — read literally, "PrivatBank
   * refused us", while PrivatBank was answering `200` to anyone asking directly.
   */
  it('names an empty error status for what it is', () => {
    const refused = httpFailure(503, '', { 'content-length': '0' })

    expect(describeRefusal(refused)).toContain('a proxy refusing the tunnel')
  })

  /** A real refusal from a real host says who it is, and is not misread as one. */
  it('does not call a served refusal a tunnel failure', () => {
    const served = httpFailure(503, '<html>maintenance</html>', { server: 'nginx' })

    expect(describeRefusal(served)).not.toContain('refusing the tunnel')
    expect(describeRefusal(served)).toContain('server=nginx')
  })

  /** Nor a status that no proxy would produce on a tunnel it declined. */
  it('does not call a 404 a tunnel failure', () => {
    expect(describeRefusal(httpFailure(404, ''))).not.toContain('refusing the tunnel')
  })

  /**
   * When nothing identifies the server, which headers arrived at all is the
   * only remaining evidence — and it is decisive. A real HTTP server sends a
   * `date` and a length; a refusal manufactured closer to home sends almost
   * nothing. Names only: a value here could be a session cookie.
   */
  it('falls back to which headers arrived, when none of them names a server', () => {
    const refusal = httpFailure(503, 'something', { date: 'Mon, 08 Sep 2026 15:03:13 GMT' })

    expect(describeRefusal(refusal)).toContain('headers present: date')
  })

  it.each(['awswaf', 'cloudflare', 'captcha'])('says when a body mentions %s', (marker) => {
    expect(describeRefusal(httpFailure(503, `<html>${marker.toUpperCase()}</html>`))).toContain(
      `mentions ${marker}`
    )
  })

  it('says so when there was no body at all', () => {
    expect(describeRefusal(httpFailure(503))).toBe('503, no body')
  })

  /**
   * Never the body itself. A refusal page is somebody else's HTML and can be a
   * hundred kilobytes of it.
   */
  it('never quotes the body', () => {
    const secretish = 'PROXY-USER-bca2fc38500a456a'

    expect(describeRefusal(httpFailure(403, secretish))).not.toContain(secretish)
  })
})
