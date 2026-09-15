import { TestTransactionService } from './test-transaction.service'

const TEST_TXID = '6321070000000408281052630816725679445108316294833958930076765941'
const REAL_TXID = 'b1c9f0e7a4d3528196f0e7a4d3528196f0e7a4d3528196f0e7a4d3528196f0e7'
const WALLET = 'TMX6HfC2JfpNCBbKx7G2KXxfWFpEi3zULm'

/**
 * The service reads the variable once, at construction, so each case builds its
 * own instance rather than mutating a shared one.
 */
const serviceWith = (configured: string | undefined) => {
  const original = process.env.TMA_TEST_TXID

  if (configured === undefined) delete process.env.TMA_TEST_TXID
  else process.env.TMA_TEST_TXID = configured

  try {
    return new TestTransactionService()
  } finally {
    if (original === undefined) delete process.env.TMA_TEST_TXID
    else process.env.TMA_TEST_TXID = original
  }
}

describe('TestTransactionService', () => {
  describe('when no test TxID is configured', () => {
    /**
     * The point of moving the value into configuration. A deployment that never
     * sets it has no test TxID — not a hard-to-guess one.
     */
    it('is disabled, so nothing is a test TxID', () => {
      const service = serviceWith(undefined)

      expect(service.enabled).toBe(false)
      expect(service.isTestTxId(TEST_TXID)).toBe(false)
      expect(service.isTestTxId(REAL_TXID)).toBe(false)
    })

    /** An unset variable must not be matchable by submitting nothing. */
    it.each(['', '   '])('does not match the empty submission %p', (submitted) => {
      expect(serviceWith(undefined).isTestTxId(submitted)).toBe(false)
      expect(serviceWith('').isTestTxId(submitted)).toBe(false)
      expect(serviceWith('   ').isTestTxId(submitted)).toBe(false)
    })

    it('stores a TxID unchanged, since none of them are tests', () => {
      expect(serviceWith(undefined).storedTxId(TEST_TXID, 'deposit-1')).toBe(TEST_TXID)
    })
  })

  describe('when a test TxID is configured', () => {
    let service: TestTransactionService

    beforeEach(() => {
      service = serviceWith(TEST_TXID)
    })

    it('recognises exactly that TxID and nothing else', () => {
      expect(service.isTestTxId(TEST_TXID)).toBe(true)
      expect(service.isTestTxId(REAL_TXID)).toBe(false)
      expect(service.isTestTxId(`${TEST_TXID}0`)).toBe(false)
    })

    /**
     * Credits exactly what the deposit asked for. The adapter used to fabricate
     * a flat 100 000 USDT, which the facade then had to subtract back out with a
     * branch of its own before crediting anything.
     */
    it('fabricates a transaction paying the deposit its own amount', () => {
      const fabricated = service.fabricate(TEST_TXID, 25.5, WALLET)

      expect(fabricated).toEqual(
        expect.objectContaining({
          txHash: TEST_TXID,
          to: WALLET,
          amount: 25.5,
          confirmed: true,
          tokenSymbol: 'USDT'
        })
      )
    })

    /**
     * A test TxID is submitted over and over, so it cannot be stored as itself
     * without either colliding on the unique index or forcing the index off for
     * real transactions too.
     */
    it('stores a test TxID uniquely per deposit', () => {
      expect(service.storedTxId(TEST_TXID, 'deposit-1')).toBe(`${TEST_TXID}_deposit-1`)
      expect(service.storedTxId(TEST_TXID, 'deposit-2')).toBe(`${TEST_TXID}_deposit-2`)
    })

    it('stores a real TxID as itself, so double-spend detection still works', () => {
      expect(service.storedTxId(REAL_TXID, 'deposit-1')).toBe(REAL_TXID)
    })
  })
})
