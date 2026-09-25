import {
  SaleCardOrderState,
  SaleEventType,
  SaleStatementRejection,
  SaleStatementStatus,
  TmaSaleStatus,
  BankProvider,
  SaleMethod
} from '@transacto/contracts'
import { StatementFinding } from 'src/modules/receipt-verification'
import { SaleStatementService } from './sale-statement.service'

const TELEGRAM_ID = 885_140
const SALE_ID = '68e1f2a3b4c5d6e7f8a9b0c1'
const ORDER_ID = 2_105_304
const AMOUNT = 30_000

/** Structure only: every figure below is invented. */
const cardOrder = (overrides: Record<string, unknown> = {}) => ({
  orderId: ORDER_ID,
  amount: AMOUNT,
  state: SaleCardOrderState.DISPUTED,
  arrivedAt: new Date('2026-09-20T14:52:00Z'),
  confirmDeadlineAt: new Date('2026-09-20T14:57:00Z'),
  answeredAt: new Date('2026-09-20T14:52:55Z'),
  statements: [],
  ...overrides
})

const sale = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => SALE_ID },
  publicId: 'XT8GFXJJ',
  telegramId: TELEGRAM_ID,
  saleMethod: SaleMethod.CARD,
  status: TmaSaleStatus.AWAITING_FIAT,
  bankType: BankProvider.PRIVAT,
  payoutCardTail: '8065',
  receiverNameSource: null,
  fiatAmount: 96_000,
  receivedAmount: 90_000,
  statementCheckpointAt: null,
  cardOrders: [cardOrder()],
  ...overrides
})

/** A parsed statement, as the facade hands one back beside its verdict. */
const parsed = (overrides: Record<string, unknown> = {}) => ({
  bank: BankProvider.PRIVAT,
  ownerName: 'Петренко Роман Іванович',
  cardTail: '8065',
  iban: 'UA000000000000000000000000000',
  periodFrom: new Date('2026-09-19T21:00:00.000Z'),
  periodTo: new Date('2026-09-20T20:59:59.999Z'),
  totalCreditedKopecks: AMOUNT,
  movements: [{ at: new Date('2026-09-20T14:52:00Z'), amountKopecks: AMOUNT, currencyCode: '980' }],
  unreadableRows: 0,
  creditsReconciled: true,
  ...overrides
})

const file = () => ({
  buffer: Buffer.from('%PDF-1.5 a statement'),
  fileName: 'statement.pdf',
  mimeType: 'application/pdf'
})

describe('SaleStatementService', () => {
  let db: Record<string, jest.Mock>
  let storage: Record<string, jest.Mock>
  let verification: Record<string, jest.Mock>
  let cardOrders: Record<string, jest.Mock>
  let progress: Record<string, jest.Mock>
  let service: SaleStatementService

  /** The order the upload is addressed to, in whatever state the test needs. */
  const withOrder = (
    overrides: Record<string, unknown> = {},
    saleOverrides: Record<string, unknown> = {}
  ) => {
    const order = cardOrder(overrides)
    const stored = sale({ cardOrders: [order], ...saleOverrides })

    cardOrders.resolve.mockResolvedValue({ sale: stored, cardOrder: order })
    db.pushStatement.mockResolvedValue(stored)
    db.findById.mockResolvedValue(stored)

    return stored
  }

  beforeEach(() => {
    db = {
      pushStatement: jest.fn(async () => sale()),
      appendEvent: jest.fn(async () => sale()),
      markStatementParsed: jest.fn(async () => sale()),
      applyStatementCheckpoint: jest.fn(async () => sale()),
      corroborateEvents: jest.fn(async () => 0),
      findById: jest.fn(async () => sale())
    }
    storage = {
      save: jest.fn(async () => `${SALE_ID}.pdf`),
      remove: jest.fn(async () => undefined)
    }
    verification = {
      supports: jest.fn(() => true),
      verify: jest.fn(async () => ({ finding: StatementFinding.CREDITED, statement: parsed() }))
    }
    cardOrders = {
      resolve: jest.fn(async () => ({ sale: sale(), cardOrder: cardOrder() })),
      confirmFromStatement: jest.fn(async () => sale()),
      denyFromStatement: jest.fn(async () => sale()),
      // What the figures now mean, asked once the checkpoint has moved them.
      reconsiderFunding: jest.fn(async (moved: unknown) => moved)
    }
    progress = { emit: jest.fn(async () => undefined) }

    service = new SaleStatementService(
      db as never,
      storage as never,
      verification as never,
      cardOrders as never,
      progress as never
    )
  })

  describe('a statement answering a denial', () => {
    it('confirms the order upstream when the document shows the credit', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.confirmFromStatement).toHaveBeenCalled()
      expect(cardOrders.denyFromStatement).not.toHaveBeenCalled()
    })

    it('upholds the denial when the document covers the window and shows none', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })
      verification.verify.mockResolvedValue({
        finding: StatementFinding.NOT_CREDITED,
        statement: parsed({ movements: [] })
      })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.denyFromStatement).toHaveBeenCalled()
      expect(cardOrders.confirmFromStatement).not.toHaveBeenCalled()
    })

    /**
     * An upheld denial settles nothing, and the document still corrected other
     * orders inside the same period — so the figures have to be re-read even
     * here. The confirming branch gets this through `settleConfirmed`.
     */
    it('asks what the figures mean after a denial is upheld', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })
      verification.verify.mockResolvedValue({
        finding: StatementFinding.NOT_CREDITED,
        statement: parsed({ movements: [] })
      })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.reconsiderFunding).toHaveBeenCalled()
    })
  })

  /**
   * **A statement sent to settle a shortfall, not to answer a denial.**
   *
   * The order was answered by the seller hours ago; what is outstanding is the
   * figure they declared, and the checkpoint is the whole of what the document
   * has to do. There is no denial for a credit to overturn and none to uphold.
   */
  describe('a statement answering a shortfall on an order already confirmed', () => {
    const confirmedWithClaim = () =>
      withOrder({
        state: SaleCardOrderState.CONFIRMED,
        declaredAmount: 29_800
      })

    /**
     * **The bug this describe block exists for.** The state was checked only on
     * the branch that *refused*, so a statement that found the credit went on to
     * confirm an order confirmed hours earlier. Transacto answered
     * `106 Order already executed`, that was read as a failure, and the upload
     * came back a `503` — after the checkpoint and the correction had already
     * been written. The seller was shown an error for a document that had done
     * everything it was sent to do.
     */
    it('confirms nothing upstream when the document shows the credit', async () => {
      confirmedWithClaim()

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.confirmFromStatement).not.toHaveBeenCalled()
      expect(cardOrders.denyFromStatement).not.toHaveBeenCalled()
    })

    it('upholds nothing when the document shows no credit either', async () => {
      confirmedWithClaim()
      verification.verify.mockResolvedValue({
        finding: StatementFinding.NOT_CREDITED,
        statement: parsed({ movements: [] })
      })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.denyFromStatement).not.toHaveBeenCalled()
      expect(cardOrders.confirmFromStatement).not.toHaveBeenCalled()
    })

    /**
     * **A correction moves `receivedAmount`, and something has to re-read it.**
     *
     * This is the branch that used to end at a re-read and nothing else. A
     * statement correcting an understated claim writes a larger figure — and a
     * sale that figure has just funded went on waiting, while one it pushed into
     * its tail kept a credential tuned for orders that could no longer be
     * routed. Neither is noticed until the *next* order settles, and a sale with
     * nothing left to route has no next order.
     */
    it('asks what the corrected figures now mean', async () => {
      const stored = confirmedWithClaim()

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(cardOrders.reconsiderFunding).toHaveBeenCalledWith(stored)
    })

    /** And the job it *was* sent to do still happens. */
    it('still applies the checkpoint', async () => {
      confirmedWithClaim()

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.applyStatementCheckpoint).toHaveBeenCalled()
      expect(db.markStatementParsed).toHaveBeenCalledWith(
        SALE_ID,
        expect.anything(),
        expect.objectContaining({ status: SaleStatementStatus.ACCEPTED, rejection: null })
      )
    })
  })

  describe('a statement that proved nothing', () => {
    beforeEach(() => {
      verification.verify.mockResolvedValue({
        rejection: SaleStatementRejection.UNREADABLE,
        statement: null
      })
    })

    it('records the refusal and leaves the order where it was', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.markStatementParsed).toHaveBeenCalledWith(
        SALE_ID,
        expect.anything(),
        expect.objectContaining({
          status: SaleStatementStatus.REJECTED,
          rejection: SaleStatementRejection.UNREADABLE
        })
      )
      expect(cardOrders.confirmFromStatement).not.toHaveBeenCalled()
      expect(cardOrders.denyFromStatement).not.toHaveBeenCalled()
    })

    /**
     * Nothing was established, so nothing about the sale's figures may move —
     * a refused document must not reach the checkpoint.
     */
    it('moves no figures and corrects nothing', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.applyStatementCheckpoint).not.toHaveBeenCalled()
    })

    it('records the refusal as an event of its own', async () => {
      withOrder({ state: SaleCardOrderState.DISPUTED })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.appendEvent).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ type: SaleEventType.STATEMENT_REJECTED })
      )
    })
  })

  /**
   * **A refused statement is kept.** An operator has to be able to open the
   * document this build could not read, which is the only way "their layout
   * changed" ever gets fixed.
   */
  it('stores every statement before it is judged, refused ones included', async () => {
    withOrder({ state: SaleCardOrderState.DISPUTED })
    verification.verify.mockResolvedValue({
      rejection: SaleStatementRejection.UNREADABLE,
      statement: null
    })

    await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

    expect(storage.save).toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })

  /** A screenshot cannot prove a negative — see SALE_STATEMENT_ALLOWED_EXTENSIONS. */
  it('refuses anything that is not a PDF before storing it', async () => {
    withOrder({ state: SaleCardOrderState.DISPUTED })

    await expect(
      service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, {
        ...file(),
        fileName: 'statement.png',
        mimeType: 'image/png'
      })
    ).rejects.toBeDefined()

    expect(storage.save).not.toHaveBeenCalled()
  })

  /**
   * The upload is undone rather than left orphaned on disk when the order stops
   * being the thing it was between the read and the write.
   */
  it('removes the stored file when the order moved underneath it', async () => {
    withOrder({ state: SaleCardOrderState.DISPUTED })
    db.pushStatement.mockResolvedValue(null)

    await expect(service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())).rejects.toBeDefined()

    expect(storage.remove).toHaveBeenCalledWith(`${SALE_ID}.pdf`)
  })

  /**
   * The checkpoint, which is the whole reason a statement is worth having.
   *
   * A card sale has no witness of its own, so every entry on its timeline is
   * somebody's claim until a bank's document covers the moment it was made.
   * Accepting one therefore writes *backwards*: it reaches over claims recorded
   * days earlier and settles them, and that stamp is what an operator reads to
   * tell "the seller said so" from "a bank confirmed it".
   */
  describe('the checkpoint a statement leaves', () => {
    it('records the document holding up, not only what it changed', async () => {
      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.appendEvent).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ type: SaleEventType.STATEMENT_ACCEPTED })
      )
    })

    it('settles the claims the document covers', async () => {
      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.corroborateEvents).toHaveBeenCalledWith(
        SALE_ID,
        { from: parsed().periodFrom, to: parsed().periodTo },
        expect.anything(),
        expect.any(Date)
      )
    })

    /**
     * A document whose dates could not be read proves nothing about any
     * particular moment — the same rule that makes `PERIOD_TOO_SHORT` a
     * refusal. Stamping claims from one would be the checkpoint vouching for a
     * window it never covered.
     */
    it('settles nothing when the period could not be read', async () => {
      verification.verify.mockResolvedValue({
        finding: StatementFinding.CREDITED,
        statement: { ...parsed(), periodFrom: null, periodTo: null }
      })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.corroborateEvents).not.toHaveBeenCalled()
    })

    /**
     * A record, not a decision.
     *
     * The statement has already been judged and the order has already moved by
     * the time this runs. A trail that could not be written must not turn a
     * settled dispute into an error on somebody's screen.
     */
    it('does not fail the upload when the stamp cannot be written', async () => {
      db.corroborateEvents.mockRejectedValue(new Error('mongo is down'))

      await expect(
        service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())
      ).resolves.toBeDefined()
    })

    /**
     * **Sale 13D4L8YJ, 2026-09-23.** The disputed order carried a declared
     * figure, so the checkpoint corrected it as though `receivedAmount` held
     * that figure — and `confirmFromStatement` then credited the order in full.
     * ₴200 went in twice, the sale read ₴801 of ₴960 against ₴601 really
     * received, and it closed on a ₴159 tail an operator transferred by hand
     * where ₴359 was still routable.
     *
     * The correction has to be *zero* here, not merely smaller: the settlement
     * that follows is what credits this order, and it credits all of it.
     */
    it('corrects nothing for the disputed order the same document settles', async () => {
      const disputed = cardOrder({ declaredAmount: 10_100, amount: 30_100 })

      withOrder(
        { declaredAmount: 10_100, amount: 30_100 },
        // The claim was too short to execute, so the order is credited by
        // nothing — which is exactly what the arithmetic used to assume away.
        { creditedOrderIds: [], cardOrders: [disputed] }
      )
      verification.verify.mockResolvedValue({
        finding: StatementFinding.CREDITED,
        statement: parsed({
          movements: [
            { at: new Date('2026-09-20T14:52:00Z'), amountKopecks: 30_100, currencyCode: '980' }
          ]
        })
      })

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.applyStatementCheckpoint).toHaveBeenCalledWith(
        SALE_ID,
        expect.any(Date),
        expect.objectContaining({ correctionKopecks: 0, corrected: [], unsettled: [] })
      )
    })

    /** …while an order the sale really did credit is still corrected. */
    it('still corrects a claim that is inside the total', async () => {
      const confirmed = cardOrder({
        state: SaleCardOrderState.CONFIRMED,
        declaredAmount: 29_500
      })

      withOrder(
        { state: SaleCardOrderState.CONFIRMED, declaredAmount: 29_500 },
        { creditedOrderIds: [ORDER_ID], cardOrders: [confirmed] }
      )

      await service.submit(TELEGRAM_ID, SALE_ID, ORDER_ID, file())

      expect(db.applyStatementCheckpoint).toHaveBeenCalledWith(
        SALE_ID,
        expect.any(Date),
        expect.objectContaining({
          correctionKopecks: 500,
          corrected: [{ orderId: ORDER_ID, declaredKopecks: 29_500, provenKopecks: AMOUNT }]
        })
      )
    })
  })
})
