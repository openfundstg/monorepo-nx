import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common'
import * as crypto from 'crypto'
import { WebhookSignatureGuard } from './webhook-signature.guard'
import type { ExecutionContext } from '@nestjs/common'
import type { TraderDbService } from 'src/modules/repositories/trader-db/services'

const TRADER_ID = 592
const API_TOKEN = 'a-traders-api-token'

const body = () => ({
  event: 'order.created',
  trader_id: TRADER_ID,
  order: { id: 1_615_180, order_id: 'ORD-1615180', amount: 304, status_id: 2 },
})

const sign = (payload: unknown) =>
  crypto.createHmac('sha256', API_TOKEN).update(Buffer.from(JSON.stringify(payload))).digest('hex')

const contextFor = (request: Record<string, unknown>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext

describe('WebhookSignatureGuard logging', () => {
  let traders: { findByTraderId: jest.Mock }
  let guard: WebhookSignatureGuard
  let log: jest.SpyInstance
  let warn: jest.SpyInstance
  let error: jest.SpyInstance

  beforeEach(() => {
    traders = {
      findByTraderId: jest.fn().mockResolvedValue({ traderId: TRADER_ID, apiToken: API_TOKEN, isActive: true }),
    }
    guard = new WebhookSignatureGuard(traders as unknown as TraderDbService)

    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  const run = (request: Record<string, unknown>) => guard.canActivate(contextFor(request))

  /** The whole point: a delivery is announced before anything can reject it. */
  it('announces a delivery before validating it', async () => {
    const payload = body()

    await run({ body: payload, headers: { 'x-signature': sign(payload) } })

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Webhook delivery'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('order=1615180'))
  })

  /**
   * These used to be silent — a misconfigured sender produced no log line at
   * all, so a delivery that never arrived and one rejected at the door looked
   * identical from the outside.
   */
  it('logs the delivery even when it carries no trader_id', async () => {
    await expect(run({ body: { event: 'order.created' }, headers: {} })).rejects.toBeInstanceOf(
      BadRequestException,
    )

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Webhook delivery'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no usable trader_id'))
  })

  it('logs a delivery with no signature header', async () => {
    await expect(run({ body: body(), headers: {} })).rejects.toBeInstanceOf(BadRequestException)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no X-Signature'))
  })

  it('names the trader when it is unknown', async () => {
    traders.findByTraderId.mockResolvedValue(null)

    await expect(
      run({ body: body(), headers: { 'x-signature': 'whatever' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`unknown trader ${TRADER_ID}`))
  })

  it('names the trader when it is inactive', async () => {
    traders.findByTraderId.mockResolvedValue({ traderId: TRADER_ID, apiToken: API_TOKEN, isActive: false })

    await expect(
      run({ body: body(), headers: { 'x-signature': 'whatever' } }),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is inactive'))
  })

  describe('on a signature mismatch', () => {
    const runMismatch = () => run({ body: body(), headers: { 'x-signature': 'not-the-signature' } })

    it('logs the rejection', async () => {
      await expect(runMismatch()).rejects.toBeInstanceOf(UnauthorizedException)

      expect(error).toHaveBeenCalledWith(expect.stringContaining('signature mismatch'))
    })

    /**
     * The expected signature is an HMAC over a body the sender chose, keyed
     * with the trader's `apiToken`. Printing it hands out a valid signature for
     * that exact payload, and enough of them are a foothold on the token.
     */
    it('never prints the signature it computed', async () => {
      const expected = sign(body())

      await expect(runMismatch()).rejects.toBeInstanceOf(UnauthorizedException)

      const printed = error.mock.calls.flat().join(' ')
      expect(printed).toContain('not-the-signature')
      expect(printed).not.toContain(expected)
    })
  })
})
