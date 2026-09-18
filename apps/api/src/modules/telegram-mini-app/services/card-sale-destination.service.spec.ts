import { BadRequestException } from '@nestjs/common'
import {
  BankProvider,
  DEFAULT_MIN_ORDER_KOPECKS,
  ERROR,
  SALE_CARD_MAX_ORDERS,
  SaleMethod
} from '@transacto/contracts'
import { CardSaleDestinationService } from './card-sale-destination.service'
import type { SaleDestinationRequest } from 'src/modules/telegram-mini-app/interfaces/sale-destination-strategy.interface'

const TELEGRAM_ID = 885_140

/** Luhn-valid and invented — no real card belongs in this repository. */
const CARD = '4444333322221111'

describe('CardSaleDestinationService', () => {
  const ENV_KEYS = ['TMA_CARD_SALE_ENABLED', 'TRANSACTO_MIN_ORDER_KOPECKS'] as const

  /**
   * Deleted key by key rather than `process.env` being replaced wholesale.
   *
   * `src/environments` exports `process.env` itself, so the service reads that
   * exact object — swapping in a copy leaves it reading the old one, and a
   * "switched off" assertion then passes against a value a previous test set.
   */
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  const service = new CardSaleDestinationService()

  const request = (overrides: Partial<SaleDestinationRequest> = {}): SaleDestinationRequest => ({
    seller: { telegramId: TELEGRAM_ID, firstName: 'Роман', lastName: 'Петренко' },
    bankType: BankProvider.MONO,
    dropLink: '',
    cardNumber: CARD,
    receiverName: 'Петренко Роман Іванович',
    ...overrides
  })


  it('claims the card variant', () => {
    expect(service.method).toBe(SaleMethod.CARD)
  })

  /**
   * The card number is checked here as well as on the form, and by the *same*
   * function — `isLuhnValid` lives in the contract precisely so the two cannot
   * disagree about which numbers exist.
   *
   * Luhn refuses a card, it never confirms one. What it refuses is a single
   * mistyped or transposed digit, which on this field means a payout routed to
   * an account the seller does not hold and nothing downstream able to tell.
   */
  describe('the card number', () => {
    it.each([
      ['a transposed pair', '4444333322221' + '2' + '11'],
      ['one wrong digit', '4444333322221112'],
      ['fifteen digits', '444433332222111'],
      ['seventeen digits', '44443333222211110'],
      ['nothing at all', '']
    ])('refuses %s', async (_case, cardNumber) => {
      await expect(service.resolve(request({ cardNumber }))).rejects.toMatchObject({
        response: ERROR.SALE_CARD.INVALID_CARD_NUMBER
      })
    })

    it('accepts one a bank could have issued', async () => {
      await expect(service.resolve(request({ cardNumber: CARD }))).resolves.toBeDefined()
    })

    /** Typed with the spacing a card is printed in, which is what the mask produces. */
    it('accepts the same card as the form spells it', async () => {
      await expect(
        service.resolve(request({ cardNumber: '4444 3333 2222 1111' }))
      ).resolves.toBeDefined()
    })
  })


  describe('which banks may be named', () => {
    it.each([BankProvider.MONO, BankProvider.PRIVAT])('accepts %s', async (bankType) => {
      await expect(service.resolve(request({ bankType }))).resolves.toBeDefined()
    })

    /**
     * Not an oversight and not a copy of `SALE_ENABLED_BANKS`, which has PUMB
     * on it. Being on the card list is a promise that a disputed order has a
     * route out — a statement something can read — and PUMB has none.
     */
    it.each([BankProvider.PUMB, BankProvider.NOVAPAY])(
      'refuses %s, whose statements nothing can check',
      async (bankType) => {
        await expect(service.resolve(request({ bankType }))).rejects.toMatchObject({
          response: ERROR.SALE.BANK_UNAVAILABLE
        })
      }
    )
  })

  describe('the card', () => {
    it('accepts whatever spacing the client used, and hands over digits', async () => {
      const resolved = await service.resolve(request({ cardNumber: '4444 3333 2222 1111' }))

      expect(resolved.payoutCardNumber).toBe(CARD)
    })

    it.each(['4444333322221', '44443333222211110', 'not-a-card', ''])(
      'refuses %p',
      async (cardNumber) => {
        await expect(service.resolve(request({ cardNumber }))).rejects.toMatchObject({
          response: ERROR.SALE_CARD.INVALID_CARD_NUMBER
        })
      }
    )
  })

  describe('the recipient name', () => {
    it('takes what the seller typed, collapsed', async () => {
      const resolved = await service.resolve(
        request({ receiverName: '  Петренко   Роман  Іванович ' })
      )

      expect(resolved.receiverName).toBe('Петренко Роман Іванович')
    })

    /**
     * No fallback to the Telegram profile, which is what a jar sale does.
     *
     * That fallback names whoever *created* the sale — a fair guess once a bank
     * has vouched for the destination, and a poor one when the destination is
     * sixteen typed digits. A payer shown a name that does not match the card
     * they are paying has been given a reason to abandon the transfer.
     */
    it.each([undefined, '', '  ', 'Р'])('refuses %p rather than guessing', async (receiverName) => {
      await expect(service.resolve(request({ receiverName }))).rejects.toMatchObject({
        response: ERROR.SALE_CARD.RECEIVER_NAME_REQUIRED
      })
    })
  })

  describe('what a card destination knows', () => {
    /**
     * Three absences, and each is load-bearing rather than a gap to fill later.
     *
     * `dropLink` null keeps `cred3` off the credential entirely — an empty one
     * is a jar that does not exist rather than no jar. `cardVerifiedByBank`
     * false keeps the dead-order fraud rule switched on, since nothing vouched
     * for the account. `observedGoal` null makes the goal check unanswerable
     * rather than switched off.
     */
    it('has no jar, no witness and no goal', async () => {
      const resolved = await service.resolve(request())

      expect(resolved.dropLink).toBeNull()
      expect(resolved.cardVerifiedByBank).toBe(false)
      expect(resolved.observedGoal).toBeNull()
    })
  })

  describe('credentialLimits — what stands in for the ledger guard', () => {
    /**
     * `SaleBlockReason.LEDGER_MISMATCH` compares what was credited against what
     * a jar was observed to hold. A card sale has one record of the money, so
     * there is nothing to compare and the guard is unbuildable. These three
     * numbers are what replaces it, and each is asserted on its own so that
     * loosening one cannot pass as a refactor.
     */
    it('allows exactly one payer in flight', () => {
      expect(service.credentialLimits(10_000_00).maxOpenOrders).toBe(1)
    })

    it('caps the sale at seven transactions, upstream', () => {
      expect(service.credentialLimits(10_000_00).maxTxCountTotal).toBe(SALE_CARD_MAX_ORDERS)
    })

    /** The specified example: ₴10 000 split seven ways is ₴1 428,57 → ₴1 428. */
    it('floors the minimum to an equal seventh', () => {
      expect(service.credentialLimits(10_000_00).minAmountUah).toBe(1_428)
    })

    /** Whole hryvnia, because that is the only precision the upstream field has. */
    it('states its figures in whole hryvnia', () => {
      const limits = service.credentialLimits(10_000_00)

      expect(Number.isInteger(limits.minAmountUah)).toBe(true)
      expect(limits.maxAmountUah).toBe(10_000)
    })

    /** Under ₴2 100 an equal seventh is below the pipeline floor, which wins. */
    it('never publishes a minimum Transacto would refuse to route', () => {
      expect(service.credentialLimits(1_000_00).minAmountUah).toBe(
        DEFAULT_MIN_ORDER_KOPECKS / 100
      )
    })

    it('honours a configured floor over the default', () => {
      process.env.TRANSACTO_MIN_ORDER_KOPECKS = '50000'

      expect(service.credentialLimits(1_000_00).minAmountUah).toBe(500)
    })
  })
})
