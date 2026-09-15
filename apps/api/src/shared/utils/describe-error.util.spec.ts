import { AxiosError, AxiosHeaders } from 'axios'
import { describeError, describeErrors } from 'src/shared/utils/describe-error.util'

/** A real trader credential is exactly what must never come back out. */
const API_TOKEN = '235b5f9a6b5a3dcd17165fbb2267c44256fb8d8ff809109dc1b9bf83e06b0e1a'

/** As axios builds it for a failed Transacto call — headers and all. */
const transactoFailure = (status: number) =>
  new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    {
      method: 'get',
      url: 'credentials_list',
      headers: new AxiosHeaders({
        Accept: 'application/json',
        'X-API-TOKEN': API_TOKEN,
      }),
    },
    null,
    {
      status,
      statusText: 'Bad Gateway',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: '',
    },
  )

describe('describeError', () => {
  /**
   * The whole reason this exists. `logger.error(msg, axiosError)` serialises
   * `config`, which carries `X-API-TOKEN` — so one upstream 502 printed a live
   * trader credential in plaintext, on a path that runs every minute.
   */
  it('never lets the API token out', () => {
    const line = describeError(transactoFailure(502))

    expect(line).not.toContain(API_TOKEN)
    expect(line).not.toContain('X-API-TOKEN')
  })

  it('says which call failed and how', () => {
    expect(describeError(transactoFailure(502))).toBe(
      'GET credentials_list → 502 (ERR_BAD_RESPONSE): Request failed with status code 502',
    )
  })

  it('reports a request that never got a response', () => {
    const offline = new AxiosError('socket hang up', 'ECONNRESET', {
      method: 'post',
      url: 'orders_execute',
      headers: new AxiosHeaders({ 'X-API-TOKEN': API_TOKEN }),
    })

    const line = describeError(offline)

    expect(line).toContain('no response')
    expect(line).not.toContain(API_TOKEN)
  })

  it('degrades to the message for an ordinary error', () => {
    expect(describeError(new Error('mongo is down'))).toBe('mongo is down')
  })

  /** A logging helper that throws turns an incident into a worse one. */
  it.each([undefined, null, 'a string', 42, { nested: true }])('survives %p', (thrown) => {
    expect(() => describeError(thrown)).not.toThrow()
  })
})

describe('describeErrors', () => {
  it('numbers each failure as it was tried', () => {
    const line = describeErrors([transactoFailure(502), new Error('mongo is down')])

    expect(line).toContain('[0] GET credentials_list → 502')
    expect(line).toContain('[1] mongo is down')
  })

  it('never lets the API token out of a batch either', () => {
    expect(describeErrors([transactoFailure(502), transactoFailure(503)])).not.toContain(API_TOKEN)
  })

  it('is empty for no failures', () => {
    expect(describeErrors([])).toBe('')
  })
})
