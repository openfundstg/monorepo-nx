import { ServiceUnavailableException } from '@nestjs/common'
import type { HttpService } from '@nestjs/axios'
import { TronTrc20Adapter } from './tron-trc20.adapter'

const TX_ID = 'b443a46961703d0ef035c5d1c848e86e1e26718e71fc181a9cfa0e487188ac03'
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

/**
 * The real addresses from the incident. TronGrid reports them as hex; the
 * adapter must hand back the base58 forms, because that is what a wallet
 * address is written as and what the facade compares against.
 */
const SENDER_HEX = '0x89cbcb2372e1c2fbc00f24895a406a0c722c89f3'
const SENDER_BASE58 = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'
const MERCHANT_HEX = '0x7eb1170aebd7f7bc94c007ae149a0d56b46a4202'
const MERCHANT_BASE58 = 'TMX6HfC2JfpNCBbKx7G2KXxfWFpEi3zULm'

/** An axios rejection carrying an HTTP status, as the adapter narrows it. */
const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  })

const transferEvents = {
  data: {
    success: true,
    data: [
      {
        contract_address: USDT_CONTRACT,
        event_name: 'Transfer',
        block_timestamp: 1_700_000_000_000,
        result: { from: SENDER_HEX, to: MERCHANT_HEX, value: '10500000' },
      },
    ],
  },
}

const successfulTx = { data: { ret: [{ contractRet: 'SUCCESS' }] } }

describe('TronTrc20Adapter', () => {
  let get: jest.Mock
  let post: jest.Mock
  let adapter: TronTrc20Adapter

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] })
    get = jest.fn()
    post = jest.fn()
    adapter = new TronTrc20Adapter({ axiosRef: { get, post } } as unknown as HttpService)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /** Backoff sleeps on real timers would make this suite take seconds. */
  const run = async <T>(work: Promise<T>): Promise<T> => {
    const settled = work.catch((error: unknown) => ({ __thrown: error }) as never)
    await jest.runAllTimersAsync()
    const result = (await settled) as { __thrown?: unknown }
    if (result && typeof result === 'object' && '__thrown' in result) throw result.__thrown

    return result as T
  }

  describe('when the chain cannot be reached', () => {
    /**
     * The incident this exists for. TronGrid rate-limited us, the adapter
     * swallowed the 429 and returned `null`, and the facade turned `null` into
     * TX_NOT_FOUND — telling a depositor whose USDT had genuinely arrived that
     * their transaction did not exist.
     */
    it('never reports a rate limit as a missing transaction', async () => {
      get.mockRejectedValue(httpError(429))

      await expect(run(adapter.verifyTransaction(TX_ID))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
    })

    it.each([500, 502, 503, 504])('retries a %p and then gives up distinctly', async (status) => {
      get.mockRejectedValue(httpError(status))

      await expect(run(adapter.verifyTransaction(TX_ID))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
      expect(get).toHaveBeenCalledTimes(3)
    })

    it('retries a network failure with no response at all', async () => {
      get.mockRejectedValue(new Error('ETIMEDOUT'))

      await expect(run(adapter.verifyTransaction(TX_ID))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
      expect(get).toHaveBeenCalledTimes(3)
    })

    it('succeeds when a retry clears the rate limit', async () => {
      get.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce(transferEvents)
      post.mockResolvedValue(successfulTx)

      const result = await run(adapter.verifyTransaction(TX_ID))

      expect(result).toMatchObject({ txHash: TX_ID, amount: 10.5, confirmed: true })
      expect(get).toHaveBeenCalledTimes(2)
    })

    /** A malformed request stays malformed — retrying only burns more quota. */
    it('does not retry a 400', async () => {
      get.mockRejectedValue(httpError(400))

      await expect(run(adapter.verifyTransaction(TX_ID))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
      expect(get).toHaveBeenCalledTimes(1)
    })
  })

  describe('when the chain answers', () => {
    /**
     * `null` keeps its one meaning: the chain was reached and the transaction
     * genuinely is not there. That is the only case the user should be told to
     * check their TxID.
     */
    it('returns null for a transaction with no events', async () => {
      get.mockResolvedValue({ data: { success: true, data: [] } })

      await expect(run(adapter.verifyTransaction(TX_ID))).resolves.toBeNull()
    })

    it('returns null when nothing transferred USDT', async () => {
      get.mockResolvedValue({
        data: {
          success: true,
          data: [
            {
              contract_address: 'TSomeOtherToken',
              event_name: 'Transfer',
              block_timestamp: 1,
              result: { from: 'a', to: 'b', value: '1' },
            },
          ],
        },
      })

      await expect(run(adapter.verifyTransaction(TX_ID))).resolves.toBeNull()
    })

    it('parses a USDT transfer, scaling the six decimals', async () => {
      get.mockResolvedValue(transferEvents)
      post.mockResolvedValue(successfulTx)

      const result = await run(adapter.verifyTransaction(TX_ID))

      expect(result).toEqual({
        txHash: TX_ID,
        from: SENDER_BASE58,
        to: MERCHANT_BASE58,
        amount: 10.5,
        confirmed: true,
        timestamp: 1_700_000_000_000,
        tokenSymbol: 'USDT',
      })
    })

    /**
     * The bug that rejected a paid deposit: TronGrid answers in hex, the
     * merchant wallet is base58, and the adapter used to hand the hex straight
     * through — so the facade compared two encodings and always disagreed.
     */
    it('returns addresses as base58, not the hex the chain reported', async () => {
      get.mockResolvedValue(transferEvents)
      post.mockResolvedValue(successfulTx)

      const result = await run(adapter.verifyTransaction(TX_ID))

      expect(result?.to).toBe(MERCHANT_BASE58)
      expect(result?.to).not.toContain('0x')
      expect(result?.from).toBe(SENDER_BASE58)
    })

    /** Crediting on an address we cannot read would be worse than a retry. */
    it('refuses to report a transfer whose addresses cannot be decoded', async () => {
      get.mockResolvedValue({
        data: {
          success: true,
          data: [
            {
              contract_address: USDT_CONTRACT,
              event_name: 'Transfer',
              block_timestamp: 1,
              result: { from: 'garbage', to: 'garbage', value: '1' },
            },
          ],
        },
      })

      await expect(run(adapter.verifyTransaction(TX_ID))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      )
    })

    it('reports an unconfirmed transaction as unconfirmed, not missing', async () => {
      get.mockResolvedValue(transferEvents)
      post.mockResolvedValue({ data: { ret: [{ contractRet: 'REVERT' }] } })

      const result = await run(adapter.verifyTransaction(TX_ID))

      expect(result?.confirmed).toBe(false)
    })
  })

  describe('the API key', () => {
    const original = process.env.TRONGRID_API_KEY

    afterEach(() => {
      if (original === undefined) delete process.env.TRONGRID_API_KEY
      else process.env.TRONGRID_API_KEY = original
    })

    it('sends the key when one is configured', async () => {
      process.env.TRONGRID_API_KEY = 'test-key'
      get.mockResolvedValue(transferEvents)
      post.mockResolvedValue(successfulTx)

      await run(adapter.verifyTransaction(TX_ID))

      expect(get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: { 'TRON-PRO-API-KEY': 'test-key' } }),
      )
    })

    /** Without one we fall back to the shared per-IP quota — the 429 source. */
    it('sends no key header when unset', async () => {
      delete process.env.TRONGRID_API_KEY
      get.mockResolvedValue(transferEvents)
      post.mockResolvedValue(successfulTx)

      await run(adapter.verifyTransaction(TX_ID))

      expect(get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: {} }),
      )
    })
  })
})
