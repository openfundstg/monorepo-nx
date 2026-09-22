import { SaleMethod } from '@transacto/contracts'
import { SalePayoutTargetService } from './sale-payout-target.service'
import type { TmaServiceTraderService } from './tma-service-trader.service'
import type { TransactoApiService } from 'src/modules/transacto/services/transacto-api.service'

const CARD_ID = 30_323
const JAR_LINK = 'https://next.privat24.ua/money-transfer/share/abc'

/** Invented and Luhn-valid — see the root `CLAUDE.md`. */
const CARD = '4441110000005500'

const cardSale = (overrides: Record<string, unknown> = {}) => ({
  publicId: 'Z38SL69F',
  saleMethod: SaleMethod.CARD,
  cardId: CARD_ID,
  dropLink: '',
  ...overrides
})

const jarSale = (overrides: Record<string, unknown> = {}) => ({
  publicId: '8GJPNPDY',
  saleMethod: SaleMethod.JAR,
  cardId: CARD_ID,
  dropLink: JAR_LINK,
  ...overrides
})

/**
 * The only thing in this product that reaches for a whole card number.
 *
 * It exists so that "reaching for one" is a single file — and everything below
 * is about the containment: it is read rather than recalled, it is handed over
 * and kept nowhere, and a failure names the sale instead of the destination.
 */
describe('SalePayoutTargetService', () => {
  let transacto: { getTerminalsList: jest.Mock }
  let serviceTrader: { resolve: jest.Mock }
  let service: SalePayoutTargetService

  beforeEach(() => {
    transacto = {
      getTerminalsList: jest
        .fn()
        .mockResolvedValue([
          { card_id: 999, cred: '5375414122223333' },
          { card_id: CARD_ID, cred: CARD }
        ])
    }
    serviceTrader = { resolve: jest.fn().mockResolvedValue({ traderId: 7, apiToken: 'token' }) }

    service = new SalePayoutTargetService(
      transacto as unknown as TransactoApiService,
      serviceTrader as unknown as TmaServiceTraderService
    )
  })

  describe('a jar sale', () => {
    /** The link is on the document, and it is public — payers are sent to it. */
    it('is the jar link, with nothing asked upstream', async () => {
      await expect(service.resolve(jarSale())).resolves.toBe(JAR_LINK)

      expect(transacto.getTerminalsList).not.toHaveBeenCalled()
    })

    it.each([['', 'empty'], ['   ', 'blank'], [null, 'absent']])(
      'is null when the link is %p (%s)',
      async (dropLink) => {
        await expect(service.resolve(jarSale({ dropLink }))).resolves.toBeNull()
      }
    )

    /** Every sale stored before the method existed is a jar sale. */
    it.each([undefined, null])('reads a missing method as a jar sale (%p)', async (saleMethod) => {
      await expect(service.resolve(jarSale({ saleMethod }))).resolves.toBe(JAR_LINK)
    })
  })

  describe('a card sale', () => {
    /**
     * Read rather than recalled: the number went upstream as the credential's
     * `cred` at creation and was never written down on this side. That is the
     * arrangement this method is careful not to undo.
     */
    it('is the card Transacto holds for the credential', async () => {
      await expect(service.resolve(cardSale())).resolves.toBe(CARD)
    })

    it('picks the sale’s own credential out of the list', async () => {
      await expect(service.resolve(cardSale({ cardId: 999 }))).resolves.toBe('5375414122223333')
    })

    it('is null for a sale with no credential yet', async () => {
      await expect(service.resolve(cardSale({ cardId: null }))).resolves.toBeNull()

      expect(transacto.getTerminalsList).not.toHaveBeenCalled()
    })

    it('is null when Transacto lists no card for it', async () => {
      transacto.getTerminalsList.mockResolvedValue([{ card_id: CARD_ID, cred: null }])

      await expect(service.resolve(cardSale())).resolves.toBeNull()
    })

    it('is null when the credential is not in the list at all', async () => {
      transacto.getTerminalsList.mockResolvedValue([])

      await expect(service.resolve(cardSale())).resolves.toBeNull()
    })

    /**
     * `null` is an answer, not a failure. The alert that asks for this is still
     * worth sending without a destination — the sum and the sale are what make
     * it actionable — so nothing here throws.
     */
    it('answers null rather than throwing when Transacto is unreachable', async () => {
      transacto.getTerminalsList.mockRejectedValue(new Error('ETIMEDOUT'))

      await expect(service.resolve(cardSale())).resolves.toBeNull()
    })

    it('answers null rather than throwing when there is no service trader', async () => {
      serviceTrader.resolve.mockRejectedValue(new Error('no service trader configured'))

      await expect(service.resolve(cardSale())).resolves.toBeNull()
    })
  })
})
