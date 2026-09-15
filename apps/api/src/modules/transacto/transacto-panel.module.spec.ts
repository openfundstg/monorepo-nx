import { HttpService } from '@nestjs/axios'
import { Test } from '@nestjs/testing'
import { TransactoPanelModule } from './transacto-panel.module'
import { ProxyModule } from 'src/shared/proxy'

/**
 * These assert configuration, not code, because configuration is where the
 * danger is. `TransactoPanelApiService` reads `response.status` to notice an
 * expired session — but if the client follows the redirect first, that status
 * is `200` and the body is the login page. Every unit test of the service
 * would still pass while production quoted `NaN`.
 */
describe('TransactoPanelModule', () => {
  let http: HttpService

  beforeEach(async () => {
    // `ProxyModule` is @Global and comes from `AppModule` in the running app;
    // a testing module has to be handed it explicitly.
    const moduleRef = await Test.createTestingModule({
      imports: [ProxyModule, TransactoPanelModule]
    }).compile()
    http = moduleRef.get(HttpService)
  })

  it('never follows a redirect', () => {
    expect(http.axiosRef.defaults.maxRedirects).toBe(0)
  })

  /**
   * The 302 has to arrive as a response the service can inspect. Letting axios
   * throw on it would turn the one repairable failure into the same opaque
   * error as a timeout.
   */
  it('accepts 302 as a response rather than an error', () => {
    const accepts = http.axiosRef.defaults.validateStatus

    expect(accepts?.(200)).toBe(true)
    expect(accepts?.(302)).toBe(true)
  })

  it.each([301, 400, 401, 403, 404, 500, 502])('still treats %i as a failure', (status) => {
    expect(http.axiosRef.defaults.validateStatus?.(status)).toBe(false)
  })

  /**
   * Not cosmetic. This host is behind Cloudflare, and `axios/1.18.1` from a
   * datacentre address is a second signal the proxy cannot fix.
   */
  it('identifies itself as the browser the panel expects', () => {
    expect(String(http.axiosRef.defaults.headers['User-Agent'])).toContain('Mozilla/5.0')
  })

  /**
   * `zstd` is what the real browser advertises and what Cloudflare will serve.
   * Node cannot decode it, and a zstd body parses as zero table rows.
   */
  it('never advertises an encoding Node cannot decode', () => {
    expect(String(http.axiosRef.defaults.headers['Accept-Encoding'])).not.toContain('zstd')
  })

  /**
   * Axios's own proxying reads `HTTP_PROXY` from the environment and tunnels
   * HTTPS badly. The agent is attached per request instead, so a rotation
   * applies to the next call.
   */
  it('leaves proxying to the agent, not to axios', () => {
    expect(http.axiosRef.defaults.proxy).toBe(false)
  })
})
