import { BankProvider, SaleStatementRejection } from '@transacto/contracts'
import { StatementVerificationFacadeService } from './statement-verification.facade.service'
import {
  StatementFinding,
  isStatementFinding,
  type StatementExpectation,
  type StatementVerificationProvider
} from 'src/modules/receipt-verification/interfaces'
import type { ParsedStatement } from 'src/shared/interfaces'
import type { ReceiptCheckerApiService } from './receipt-checker.api.service'
import { parseStatement } from 'src/shared/utils'

/**
 * Only the parser is replaced. `canReadStatement` and the rest stay real —
 * they are part of what this facade's own logic is, and stubbing a barrel
 * wholesale is how a test starts passing because nothing runs.
 */
jest.mock('src/shared/utils', () => ({
  ...jest.requireActual('src/shared/utils'),
  parseStatement: jest.fn()
}))

const parsedBy = parseStatement as unknown as jest.Mock

const CARD_TAIL = '4321'
const AMOUNT = 142_800

const WINDOW_FROM = new Date('2026-09-14T10:00:00.000Z')
const WINDOW_TO = new Date('2026-09-14T12:00:00.000Z')

const expectation: StatementExpectation = {
  cardTail: CARD_TAIL,
  amountKopecks: AMOUNT,
  from: WINDOW_FROM,
  to: WINDOW_TO,
  // The ordinary case: by the time a statement is read the window has closed,
  // so everything in it can be asked for. Where it has not, see the pair of
  // tests about a window whose upper edge is still in the future.
  mustCoverTo: WINDOW_TO
}

const statement = (over: Partial<ParsedStatement> = {}): ParsedStatement => ({
  bank: BankProvider.MONO,
  ownerName: 'Петренко Роман Іванович',
  cardTail: CARD_TAIL,
  iban: 'UA000000000000000000000000000',
  periodFrom: new Date('2026-09-01T00:00:00.000Z'),
  periodTo: new Date('2026-09-30T23:59:59.999Z'),
  totalCreditedKopecks: AMOUNT,
  movements: [
    { at: new Date('2026-09-14T11:00:00.000Z'), amountKopecks: AMOUNT, currencyCode: 'UAH' }
  ],
  unreadableRows: 0,
  creditsReconciled: true,
  ...over
})

/**
 * The parser has its own spec over documents; what this file holds is the
 * judgement — the four things that must hold before a statement's rows mean
 * anything, and the one comparison that decides whether somebody's stake is
 * spent.
 */
describe('StatementVerificationFacadeService', () => {
  let parsed: ParsedStatement | null
  let provider: StatementVerificationProvider & { attest: jest.Mock }
  let service: StatementVerificationFacadeService

  const build = (providers?: readonly StatementVerificationProvider[]) =>
    new StatementVerificationFacadeService(providers ?? [provider], {
      isConfigured: true,
      extractText: jest.fn(async () => ({ text: 'irrelevant', source: 'PDF_TEXT' }))
    } as unknown as ReceiptCheckerApiService)

  beforeEach(() => {
    parsed = statement()
    provider = {
      name: 'test',
      supports: (bank: BankProvider) => bank === BankProvider.MONO,
      attest: jest.fn(async () => ({
        bank: BankProvider.MONO,
        document: { buffer: Buffer.from(''), fileName: 's.pdf', mimeType: 'application/pdf' }
      }))
    }
    // The parser is exercised in its own spec over real documents; here it is
    // the input, so the judgement can be tested on shapes a document could take.
    parsedBy.mockImplementation(() => parsed)

    service = build()
  })

  afterEach(() => jest.clearAllMocks())

  const verify = (over: Partial<StatementExpectation> = {}) =>
    service.verify(
      {
        bank: BankProvider.MONO,
        uploaded: { buffer: Buffer.from(''), fileName: 's.pdf', mimeType: 'application/pdf' }
      },
      { ...expectation, ...over }
    )

  describe('what has to hold before the rows mean anything', () => {
    it('finds the credit when all four hold', async () => {
      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.CREDITED)
    })

    /**
     * One Transacto order can be paid by several transfers, so what arrived for
     * it is the total of the credits in its window. A check looking for a single
     * movement of the whole amount reported every split payment as money that
     * never came — the one conclusion this design exists to make impossible.
     */
    it('finds the credit when it arrived in two transfers', async () => {
      parsed = statement({
        movements: [
          { at: new Date('2026-09-14T10:30:00.000Z'), amountKopecks: 40_000, currencyCode: 'UAH' },
          {
            at: new Date('2026-09-14T11:30:00.000Z'),
            amountKopecks: AMOUNT - 40_000,
            currencyCode: 'UAH'
          }
        ]
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.CREDITED)
    })

    /**
     * Part of it is not it. The seller's denial stands and an operator settles
     * the rest — spending their stake for a payment that came up short is the
     * error that cannot be taken back.
     */
    it('does not find the credit when the transfers fall short of the order', async () => {
      parsed = statement({
        movements: [
          { at: new Date('2026-09-14T10:30:00.000Z'), amountKopecks: 40_000, currencyCode: 'UAH' }
        ]
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })

    /** Credits outside the window belong to another order, or to nobody. */
    it('ignores a credit that lands outside the window', async () => {
      parsed = statement({
        movements: [
          { at: new Date('2026-09-14T13:00:00.000Z'), amountKopecks: AMOUNT, currencyCode: 'UAH' }
        ]
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })

    /** A statement for another card says nothing about this one. */
    it('refuses a statement for a different account', async () => {
      parsed = statement({ cardTail: '9999' })

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.WRONG_ACCOUNT
      })
    })

    /**
     * **The failure this whole design exists to prevent.** A document that stops
     * before the credit would have landed proves nothing about the part it
     * misses, and reading that as "no credit found" would settle a dispute on a
     * document that never covered it.
     */
    it.each([
      ['starting after the window', { periodFrom: new Date('2026-09-14T11:00:00.000Z') }],
      ['ending before the window', { periodTo: new Date('2026-09-14T11:00:00.000Z') }]
    ])('refuses a period %s', async (_, over) => {
      parsed = statement(over)

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.PERIOD_TOO_SHORT
      })
    })

    /**
     * **A document cannot cover time that has not happened yet.**
     *
     * The window ends at the deadline plus three hours of grace for a bank
     * posting late, so when a seller is asked for a statement that edge is
     * normally still in the future. This check used to demand a document
     * reaching it, and a bank issues whole days — so an order whose deadline
     * fell after 21:00 Kyiv had a window ending tomorrow, and every same-day
     * statement was refused as too short however complete it was. Verified
     * against a real one: it covered its whole day, all rows read, credits
     * reconciled, and it proved nothing.
     */
    it('accepts a document that reaches the present but not the window’s future edge', async () => {
      parsed = statement({ periodTo: new Date('2026-09-14T11:00:00.000Z') })

      await expect(
        verify({ mustCoverTo: new Date('2026-09-14T11:00:00.000Z') })
      ).resolves.toMatchObject({ finding: expect.anything() })
    })

    /** And the requirement itself is still a requirement, not a formality. */
    it('still refuses a document that stops short of the present', async () => {
      parsed = statement({ periodTo: new Date('2026-09-14T10:59:59.999Z') })

      await expect(
        verify({ mustCoverTo: new Date('2026-09-14T11:00:00.000Z') })
      ).resolves.toMatchObject({ rejection: SaleStatementRejection.PERIOD_TOO_SHORT })
    })

    /** A row that looked like a row and did not parse is why this can be asked. */
    it('refuses a statement with a row it could not read', async () => {
      parsed = statement({ unreadableRows: 1 })

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.UNREADABLE
      })
    })

    /**
     * `apps/receipt-checker` reads at most ten pages and statements are longer.
     * A dropped page leaves no anchor to count as unreadable — only the bank's
     * own period total still disagrees.
     */
    it.each([
      ['do not add up', { creditsReconciled: false }],
      ['cannot be reconciled at all', { creditsReconciled: null, totalCreditedKopecks: null }]
    ])('refuses a statement whose credits %s', async (_, over) => {
      parsed = statement(over)

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.UNREADABLE
      })
    })

    /**
     * The order of the checks is what the sender is told. A statement for the
     * wrong account says so, rather than reporting a conclusion reached on the
     * wrong document and then discarded.
     */
    it('names the wrong account even when nothing would have been found anyway', async () => {
      parsed = statement({ cardTail: '9999', movements: [] })

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.WRONG_ACCOUNT
      })
    })
  })

  describe('matching the credit', () => {
    it('says the denial stands when the document holds no such credit', async () => {
      parsed = statement({ movements: [], totalCreditedKopecks: 0, creditsReconciled: true })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })

    /**
     * **No tolerance, and the asymmetry is the reason.** Too strict refuses to
     * settle an order and an operator sorts it out; too loose matches an
     * unrelated credit of about the right size and spends a seller's stake for
     * hryvnia they never received.
     */
    it.each([AMOUNT - 1, AMOUNT + 1])('does not match %p against the exact amount', async (amountKopecks) => {
      parsed = statement({
        movements: [
          { at: new Date('2026-09-14T11:00:00.000Z'), amountKopecks, currencyCode: 'UAH' }
        ],
        totalCreditedKopecks: amountKopecks
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })

    it.each([
      ['before', '2026-09-14T09:59:59.000Z'],
      ['after', '2026-09-14T12:00:01.000Z']
    ])('does not match a credit %s the window', async (_, at) => {
      parsed = statement({
        movements: [{ at: new Date(at), amountKopecks: AMOUNT, currencyCode: 'UAH' }]
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })

    /** A debit of the same size is not a credit, and the sign is what says so. */
    it('does not match an outgoing payment of the same size', async () => {
      parsed = statement({
        movements: [
          { at: new Date('2026-09-14T11:00:00.000Z'), amountKopecks: -AMOUNT, currencyCode: 'UAH' }
        ],
        totalCreditedKopecks: 0
      })

      const result = await verify()

      expect(isStatementFinding(result) && result.finding).toBe(StatementFinding.NOT_CREDITED)
    })
  })

  describe('when nothing could be established', () => {
    it("passes a provider's refusal through as it stands", async () => {
      provider.attest.mockResolvedValue({ rejection: SaleStatementRejection.NOT_REGISTERED })

      await expect(verify()).resolves.toEqual({
        rejection: SaleStatementRejection.NOT_REGISTERED,
        statement: null
      })
    })

    /**
     * Never the sender's fault, and it must not read as one: the dependency was
     * unwell, not their document.
     */
    it('reports an unexpected failure as the verifier being unavailable', async () => {
      provider.attest.mockRejectedValue(new Error('ETIMEDOUT'))

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE
      })
    })

    /**
     * A bank on `CARD_SALE_ENABLED_BANKS` with no provider is a promise the
     * product made and cannot keep — refused, loudly, and never passed.
     */
    it('refuses a bank nothing can vouch for', async () => {
      service = build([])

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.VERIFIER_UNAVAILABLE
      })
    })

    it('refuses a document whose layout could not be read', async () => {
      parsed = null

      await expect(verify()).resolves.toMatchObject({
        rejection: SaleStatementRejection.UNREADABLE
      })
    })
  })

  describe('supports', () => {
    it.each([BankProvider.MONO])('is true for %s', (bank) => {
      expect(service.supports(bank)).toBe(true)
    })

    it.each([BankProvider.PUMB, BankProvider.NOVAPAY])('is false for %s', (bank) => {
      expect(service.supports(bank)).toBe(false)
    })
  })
})
