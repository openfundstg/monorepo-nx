import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import {
  ERROR,
  OrderExecutionReason,
  SaleCardOrderState,
  SaleEventType,
  SaleEvidence,
  SaleMethod,
  TmaSaleStatus
} from '@transacto/contracts'
import { SaleCardOrderService } from './sale-card-order.service'
import { OrderStatus } from 'src/modules/repositories/order-db'
import { OrderExecutionOutcome } from 'src/modules/transacto/services/transacto-api.service'
import { TMA_DOMAIN_EVENT, TransactoErrorCode } from 'src/shared/interfaces'

const TELEGRAM_ID = 885_140
const SALE_ID = '68e1f2a3b4c5d6e7f8a9b0c1'
const ORDER_ID = 1_234_567
const AMOUNT = 142_800

/** What Transacto's own window works out to, once resolved onto our clock. */
const PAYER_DEADLINE = new Date('2026-09-17T10:06:00Z')

const cardOrder = (overrides: Record<string, unknown> = {}) => ({
  orderId: ORDER_ID,
  amount: AMOUNT,
  state: SaleCardOrderState.AWAITING_CONFIRMATION,
  arrivedAt: new Date('2026-09-17T10:00:00Z'),
  confirmDeadlineAt: new Date('2026-09-17T11:00:00Z'),
  answeredAt: null,
  statements: [],
  ...overrides
})

const sale = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => SALE_ID },
  publicId: 'Z38SL69F',
  telegramId: TELEGRAM_ID,
  saleMethod: SaleMethod.CARD,
  // Routing only ever resumes on a sale still taking payers, so the fixture has
  // to say which it is — a sale winding down deliberately has routing down.
  status: TmaSaleStatus.AWAITING_FIAT,
  fiatAmount: 1_000_000,
  receivedAmount: 0,
  cardId: 42,
  traderId: 7,
  transactoTerminalId: 9,
  cardOrders: [cardOrder()],
  ...overrides
})

describe('SaleCardOrderService', () => {
  let db: Record<string, jest.Mock>
  let orders: Record<string, jest.Mock>
  let transacto: Record<string, jest.Mock>
  let terminals: Record<string, jest.Mock>
  let settlement: Record<string, jest.Mock>
  let limits: Record<string, jest.Mock>
  let progress: Record<string, jest.Mock>
  let emitter: Record<string, jest.Mock>
  let service: SaleCardOrderService

  const build = () =>
    new SaleCardOrderService(
      db as never,
      orders as never,
      transacto as never,
      { resolve: jest.fn(async () => ({ traderId: 7, apiToken: 'token' })) } as never,
      terminals as never,
      settlement as never,
      limits as never,
      progress as never,
      emitter as never
    )

  beforeEach(() => {
    db = {
      findById: jest.fn(async () => sale()),
      pushCardOrder: jest.fn(async () => sale()),
      moveCardOrder: jest.fn(async () => sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] })),
      appendEvent: jest.fn(async () => sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] }))
    }
    orders = {
      findByOrderId: jest.fn(async () => ({ orderId: ORDER_ID, payerDeadlineAt: PAYER_DEADLINE })),
      markExecutionStarted: jest.fn(async () => undefined),
      markAwaitingUpstreamConfirmation: jest.fn(async () => undefined),
      markCompleted: jest.fn(async () => true)
    }
    transacto = {
      executeOrder: jest.fn(async () => ({ outcome: OrderExecutionOutcome.CONFIRMED }))
    }
    terminals = {
      stopRouting: jest.fn(async () => undefined),
      resumeRouting: jest.fn(async () => undefined)
    }
    settlement = {
      creditSettledOrder: jest.fn(async () => null),
      settleIfFinished: jest.fn(async () => false)
    }
    limits = { retune: jest.fn(async () => undefined) }
    progress = { emit: jest.fn(async () => undefined) }
    emitter = { emit: jest.fn() }

    service = build()
  })

  /**
   * A transfer fee took a bite out of a payment, and the seller is the only
   * witness a card sale has to that.
   */
  describe('a payment that arrived short', () => {
    const ENV = ['SALE_CARD_SHORTFALL_ENABLED', 'SALE_CARD_SHORTFALL_TOLERANCE_UAH']

    const allow = (uah: string) => {
      process.env.SALE_CARD_SHORTFALL_ENABLED = 'true'
      process.env.SALE_CARD_SHORTFALL_TOLERANCE_UAH = uah
    }

    afterEach(() => {
      for (const key of ENV) delete process.env[key]
    })

    /**
     * **What is credited is what landed, not what was ordered.** A jar sale
     * credits the growth the scraper observed, which is already net of whatever
     * the bank took; this is the same figure from the only witness there is. A
     * sale that credited the ordered amount would charge the fee to the seller
     * while telling them it had not.
     */
    it('credits what the seller says landed, and executes the order', async () => {
      allow('20')

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, AMOUNT - 500)

      expect(transacto.executeOrder).toHaveBeenCalled()
      expect(settlement.creditSettledOrder).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ amount: AMOUNT - 500 })
      )
    })

    it('records the figure the seller gave, so a statement has something to check', async () => {
      allow('20')

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, AMOUNT - 500)

      expect(db.moveCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        ORDER_ID,
        expect.anything(),
        SaleCardOrderState.CONFIRMED,
        expect.objectContaining({ declaredAmount: AMOUNT - 500 })
      )
    })

    /**
     * Past the allowance nothing is executed: the payer's money is not released
     * against a sum the seller says they never got. The order goes to a
     * statement, which is what `DISPUTED` means here.
     */
    it('executes nothing when the shortfall is past the allowance', async () => {
      allow('1')

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, AMOUNT - 500)

      expect(transacto.executeOrder).not.toHaveBeenCalled()
      expect(db.moveCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        ORDER_ID,
        expect.anything(),
        SaleCardOrderState.DISPUTED,
        expect.objectContaining({ declaredAmount: AMOUNT - 500 })
      )
    })

    /**
     * **Far short is the same state as nothing at all.**
     *
     * ₴500 against a ₴1 000 order is not a bank fee, it is a payment that did
     * not happen the way anybody expected. So the terminal stops taking more —
     * for the same reason it stops on a denial: one open question at a time is
     * what keeps the next one answerable, and a second payer landing money on a
     * card that already has an unexplained payment on it turns "this ₴1 000
     * arrived" into "some money arrived", which nobody can answer.
     */
    it('stops the terminal when far less arrived than the order was for', async () => {
      allow('20')

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, Math.round(AMOUNT / 2))

      expect(terminals.stopRouting).toHaveBeenCalled()
      expect(transacto.executeOrder).not.toHaveBeenCalled()
    })

    /** A fee inside the allowance is not a dispute and must not stop anything. */
    it('leaves the terminal running for a shortfall inside the allowance', async () => {
      allow('20')

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, AMOUNT - 500)

      expect(terminals.stopRouting).not.toHaveBeenCalled()
    })

    /** Unset is no allowance at all, which is how this ships. */
    it('executes nothing on any shortfall while the allowance is off', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, AMOUNT - 1)

      expect(transacto.executeOrder).not.toHaveBeenCalled()
    })

    /**
     * A fee takes money out of a payment and nothing puts money in, so a figure
     * above the order cannot have happened. Refused rather than clamped: reading
     * it as the whole order would hide a client sending nonsense.
     */
    it.each([
      ['more than the order', () => AMOUNT + 1],
      ['zero', () => 0],
      ['a fraction of a kopeck', () => AMOUNT - 0.5]
    ])('refuses a declared figure that is %s', async (_case, value) => {
      await expect(
        service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID, value())
      ).rejects.toMatchObject({ response: ERROR.SALE_CARD.DECLARED_ABOVE_ORDER })
    })

    /** Nothing said is the ordinary answer, and the only one the bot can give. */
    it('credits the whole order when no figure is given', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(transacto.executeOrder).toHaveBeenCalled()
      expect(db.moveCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        ORDER_ID,
        expect.anything(),
        SaleCardOrderState.CONFIRMED,
        expect.objectContaining({ declaredAmount: undefined })
      )
    })
  })

  /**
   * The credential's minimum is re-divided over what is left, or a ₴10 000 sale
   * that took two ₴4 500 payments can never collect its last ₴1 000.
   */
  describe('after an order settles', () => {
    it('retunes the credential to what the sale still needs', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(limits.retune).toHaveBeenCalled()
    })

    it('does not retune a sale that has just finished', async () => {
      settlement.settleIfFinished.mockResolvedValue(true)

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(limits.retune).not.toHaveBeenCalled()
    })
  })

  describe('recordArrival', () => {
    it('asks the seller about the order, once', async () => {
      await service.recordArrival(sale() as never, { orderId: ORDER_ID, amount: AMOUNT })

      expect(db.pushCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ orderId: ORDER_ID, amount: AMOUNT })
      )
      expect(emitter.emit).toHaveBeenCalledWith(
        TMA_DOMAIN_EVENT.SALE_CARD_ORDER_AWAITING,
        expect.objectContaining({ telegramId: TELEGRAM_ID, orderId: ORDER_ID, amount: AMOUNT })
      )
    })

    /**
     * A webhook and the thirty-second sync both report the same arrival. Two
     * rows would ask the same question twice and let one answer settle the
     * other, so `pushCardOrder` refuses the second — and nothing is announced.
     */
    it('announces nothing when the order was already recorded', async () => {
      db.pushCardOrder.mockResolvedValue(null)

      expect(
        await service.recordArrival(sale() as never, { orderId: ORDER_ID, amount: AMOUNT })
      ).toBeNull()
      expect(emitter.emit).not.toHaveBeenCalled()
    })

    /**
     * **Transacto's deadline, not one of ours.**
     *
     * There used to be two — theirs for the payer, and a separate window of
     * ours for the seller on top of it — so the screen counted down one clock
     * while the sweep acted on another. The seller's question now expires
     * exactly when the payment does.
     */
    it('expires the question when Transacto says the payment does', async () => {
      await service.recordArrival(sale() as never, { orderId: ORDER_ID, amount: AMOUNT })

      expect(db.pushCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ confirmDeadlineAt: PAYER_DEADLINE })
      )
    })

    /**
     * A delivery that carried no usable pair of timestamps.
     *
     * The configured window stands in rather than nothing: a card order with no
     * deadline at all could never be disputed, and a question nobody can answer
     * that never expires is the one outcome this variant cannot have. The sweep
     * would skip it forever and the terminal would go on taking money against a
     * payment nobody ever confirmed.
     */
    it('falls back to the configured window when Transacto stated no deadline', async () => {
      orders.findByOrderId.mockResolvedValue({ orderId: ORDER_ID, payerDeadlineAt: undefined })

      await service.recordArrival(sale() as never, { orderId: ORDER_ID, amount: AMOUNT })

      const [, pushed] = db.pushCardOrder.mock.calls[0] as [string, { confirmDeadlineAt: Date }]
      expect(pushed.confirmDeadlineAt.getTime()).toBeGreaterThan(Date.now())
    })

    /**
     * The seller knows which of their cards it is, and a bot message is the
     * last place a payment credential should be able to reach.
     *
     * Asserted as the exact key set rather than by pattern-matching the JSON:
     * a deadline is a thirteen-digit number too, so "no long run of digits"
     * catches the wrong thing and misses the right one. This fails the moment
     * anybody adds a field.
     */
    it('publishes exactly what a message needs, and no account of any kind', async () => {
      await service.recordArrival(sale() as never, { orderId: ORDER_ID, amount: AMOUNT })

      const [, payload] = emitter.emit.mock.calls[0]
      expect(Object.keys(payload as object).toSorted()).toEqual([
        'amount',
        'confirmDeadlineAt',
        'orderId',
        'publicId',
        'saleId',
        'telegramId',
      ])
    })
  })

  describe('confirm', () => {
    /**
     * **The rule with a history behind it.** Transacto fires `order.paid` the
     * instant `orders_execute` succeeds, so the confirmation comes straight back
     * as a webhook — and without this marker that delivery is indistinguishable
     * from an operator confirming by hand, which is then recorded and shown to
     * the user as exactly that.
     */
    it('marks the execution as ours before asking Transacto', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(orders.markExecutionStarted).toHaveBeenCalledWith(ORDER_ID)
      expect(orders.markExecutionStarted.mock.invocationCallOrder[0]).toBeLessThan(
        transacto.executeOrder.mock.invocationCallOrder[0]
      )
    })

    it('records who confirmed it, not merely that it was confirmed', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(orders.markCompleted).toHaveBeenCalledWith(
        ORDER_ID,
        OrderStatus.EXECUTED,
        OrderExecutionReason.USER_CONFIRMED,
        AMOUNT
      )
    })

    it('credits the order and asks whether the sale is finished', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(settlement.creditSettledOrder).toHaveBeenCalledWith(SALE_ID, {
        orderId: ORDER_ID,
        amount: AMOUNT
      })
      expect(settlement.settleIfFinished).toHaveBeenCalled()
    })

    it('puts the confirmation on the timeline', async () => {
      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(db.appendEvent).toHaveBeenCalledWith(
        SALE_ID,
        expect.objectContaining({ type: SaleEventType.ORDER_CONFIRMED, orderId: ORDER_ID })
      )
    })

    /**
     * Both surfaces call this, and a seller tapping each of them is the
     * expected case rather than the exotic one. The second answer is an answer.
     */
    it('is a no-op on an order that is already confirmed', async () => {
      db.findById.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] })
      )

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(transacto.executeOrder).not.toHaveBeenCalled()
      expect(settlement.creditSettledOrder).not.toHaveBeenCalled()
    })

    /** Late is allowed: `OVERDUE` is executable, and so is a late seller. */
    it('accepts a confirmation after the order was disputed', async () => {
      db.findById.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(transacto.executeOrder).toHaveBeenCalled()
    })

    /** Settling twice is what `moveCardOrder`'s state filter exists to stop. */
    it('credits nothing when another caller got there first', async () => {
      db.moveCardOrder.mockResolvedValue(null)

      await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(settlement.creditSettledOrder).not.toHaveBeenCalled()
    })

    describe('routing', () => {
      it('lets payers back in once nothing is disputed', async () => {
        await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

        expect(terminals.resumeRouting).toHaveBeenCalled()
      })

      it('leaves routing stopped while another order is still disputed', async () => {
        db.appendEvent.mockResolvedValue(
          sale({
            cardOrders: [
              cardOrder({ state: SaleCardOrderState.CONFIRMED }),
              cardOrder({ orderId: 999, state: SaleCardOrderState.DISPUTED })
            ]
          })
        )

        await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

        expect(terminals.resumeRouting).not.toHaveBeenCalled()
      })

      /**
       * **Routing is switched off by more than a dispute.** A seller who stops
       * a sale with payments outstanding leaves it `CLOSING` with routing down
       * on purpose; settling a dispute afterwards would hand the sale back to
       * new payers after its owner had ended it.
       */
      it.each([TmaSaleStatus.CLOSING, TmaSaleStatus.BLOCKED, TmaSaleStatus.CANCELLED])(
        'leaves routing stopped on a sale that is %s',
        async (status) => {
          db.appendEvent.mockResolvedValue(
            sale({ status, cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] })
          )

          await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

          expect(terminals.resumeRouting).not.toHaveBeenCalled()
        }
      )

      /**
       * The sale is correct either way; what a failure costs is that no further
       * payer is routed until somebody notices. Not worth failing the seller's
       * confirmation over.
       */
      it('does not fail a confirmation because routing could not resume', async () => {
        terminals.resumeRouting.mockRejectedValue(new Error('Transacto is unwell'))

        await expect(service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)).resolves.toBeDefined()
      })
    })

    describe('when Transacto refuses', () => {
      /**
       * A status Transacto will not execute — `EXPIRED_HOLD`,
       * `CLIENT_CANCELLED`, `DECLINED` — and it is final. An honest seller who
       * tapped the button an hour late has to be told, not shown a silent no-op.
       */
      it('says the order can no longer be confirmed on a validation refusal', async () => {
        // Shaped as axios shapes it, because that is what the classifier reads.
        transacto.executeOrder.mockRejectedValue({
          isAxiosError: true,
          response: { data: { error_code: TransactoErrorCode.VALIDATION } }
        })

        await expect(service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)).rejects.toMatchObject({
          response: ERROR.SALE_CARD.ORDER_NOT_EXECUTABLE
        })
      })

      /** Telling a user "no" when the truth is "not just now" costs them money. */
      it('says try again on anything else', async () => {
        transacto.executeOrder.mockRejectedValue(new Error('ETIMEDOUT'))

        await expect(service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)).rejects.toBeInstanceOf(
          ServiceUnavailableException
        )
      })

      it('settles nothing when the confirmation could not be sent', async () => {
        transacto.executeOrder.mockRejectedValue(new Error('ETIMEDOUT'))

        await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID).catch(() => undefined)

        expect(db.moveCardOrder).not.toHaveBeenCalled()
        expect(settlement.creditSettledOrder).not.toHaveBeenCalled()
      })

      /**
       * **106 is the state this was asking for, not a refusal.**
       *
       * An operator settling the order in the panel while the seller answers is
       * an ordinary race here, and a retry of a call that already succeeded
       * answers the same way. Read as a failure it cost a whole verdict: a
       * statement that proved a denied order paid came back a `503` because the
       * order had been executed in the meantime, so the one document that could
       * settle the dispute settled nothing.
       */
      it('takes "already executed" as confirmation and settles', async () => {
        transacto.executeOrder.mockRejectedValue({
          isAxiosError: true,
          response: { data: { error_code: TransactoErrorCode.ORDER_ALREADY_EXECUTED } }
        })

        await expect(service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)).resolves.toBeDefined()

        expect(db.moveCardOrder).toHaveBeenCalled()
        expect(settlement.creditSettledOrder).toHaveBeenCalled()
      })

      /**
       * 108 means the money arrived and the confirmation did not. The seller's
       * word is what this variant runs on, and our failure to relay it does not
       * un-arrive their hryvnia — so it settles here and stays open upstream.
       */
      it('settles locally when the trader limit refuses the confirmation', async () => {
        transacto.executeOrder.mockResolvedValue({
          outcome: OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED
        })

        await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

        expect(orders.markAwaitingUpstreamConfirmation).toHaveBeenCalledWith(ORDER_ID)
        expect(settlement.creditSettledOrder).toHaveBeenCalled()
      })
    })

    describe('who may answer', () => {
      /**
       * Checked here rather than by the callers, because one of them is a bot
       * callback — where the telegram id arrives from Telegram rather than from
       * a signed launch, and trusting the button's payload is the mistake this
       * prevents.
       */
      it('refuses somebody else’s sale', async () => {
        await expect(service.confirm(999, SALE_ID, ORDER_ID)).rejects.toBeInstanceOf(
          NotFoundException
        )
      })

      it('refuses a jar sale, which has nothing to confirm', async () => {
        db.findById.mockResolvedValue(sale({ saleMethod: SaleMethod.JAR }))

        await expect(service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)).rejects.toMatchObject({
          response: ERROR.SALE_CARD.NOT_A_CARD_SALE
        })
      })

      it('refuses an order this sale does not have', async () => {
        await expect(service.confirm(TELEGRAM_ID, SALE_ID, 404)).rejects.toMatchObject({
          response: ERROR.SALE_CARD.ORDER_NOT_FOUND
        })
      })
    })
  })

  describe('deny', () => {
    beforeEach(() => {
      db.moveCardOrder.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )
      db.appendEvent.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )
    })

    /**
     * Nothing is established by a denial — it is the one claim in this flow
     * that costs the person making it nothing.
     */
    it('tells Transacto nothing', async () => {
      await service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(transacto.executeOrder).not.toHaveBeenCalled()
      expect(orders.markExecutionStarted).not.toHaveBeenCalled()
    })

    /**
     * Not a punishment: one open order at a time is what lets a seller say
     * "this ₴1 428 arrived". A second payer landing money while the first is
     * disputed turns that into "some money arrived", which nobody can answer
     * about a card that sees more than one transfer a day.
     */
    it('stops more money landing on an open question', async () => {
      await service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(terminals.stopRouting).toHaveBeenCalled()
    })

    it('asks for a statement', async () => {
      await service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(emitter.emit).toHaveBeenCalledWith(
        TMA_DOMAIN_EVENT.SALE_CARD_ORDER_DISPUTED,
        expect.objectContaining({ orderId: ORDER_ID })
      )
    })

    /**
     * The dispute is recorded and the seller has already been told. A Transacto
     * hiccup must not turn "we have noted your report" into an error.
     */
    it('records the dispute even when routing could not be stopped', async () => {
      terminals.stopRouting.mockRejectedValue(new Error('Transacto is unwell'))

      await expect(service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)).resolves.toBeDefined()
      expect(db.appendEvent).toHaveBeenCalled()
    })

    it('is a no-op on an order already in dispute', async () => {
      db.findById.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )

      await service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)

      expect(terminals.stopRouting).not.toHaveBeenCalled()
    })

    it('refuses to reopen an order that is already settled', async () => {
      db.findById.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] })
      )

      await expect(service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)).rejects.toBeInstanceOf(
        ConflictException
      )
    })
  })

  describe('expire', () => {
    beforeEach(() => {
      db.moveCardOrder.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )
      db.appendEvent.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] })
      )
    })

    /**
     * Silence and "it did not arrive" put the sale in the same place: in both
     * cases nothing has established that the hryvnia arrived, and this variant
     * has no second record to fall back on.
     */
    it('treats silence exactly as a denial', async () => {
      await service.expire(sale() as never, cardOrder() as never)

      expect(terminals.stopRouting).toHaveBeenCalled()
      expect(transacto.executeOrder).not.toHaveBeenCalled()
    })

    it('leaves an order alone that was answered in the meantime', async () => {
      expect(
        await service.expire(
          sale() as never,
          cardOrder({ state: SaleCardOrderState.CONFIRMED }) as never
        )
      ).toBeNull()
      expect(terminals.stopRouting).not.toHaveBeenCalled()
    })
  })

  describe('markSettledUpstream', () => {
    /**
     * An operator confirmed it in Transacto's own panel. The money is credited
     * by the path that noticed; this only closes the question, so the sweep
     * does not later dispute an order that is already paid.
     */
    it('closes the question without executing anything', async () => {
      await service.markSettledUpstream(sale() as never, ORDER_ID)

      expect(db.moveCardOrder).toHaveBeenCalled()
      expect(orders.markExecutionStarted).not.toHaveBeenCalled()
      expect(transacto.executeOrder).not.toHaveBeenCalled()
    })

    it('says nothing happened when the order was already answered', async () => {
      db.moveCardOrder.mockResolvedValue(null)

      expect(await service.markSettledUpstream(sale() as never, ORDER_ID)).toBeNull()
    })
  })

  /**
   * A statement covered the window and showed no such credit.
   *
   * **The transition that used to live somewhere else and forgot to switch the
   * terminal back on.** A dispute stops routing so the question stays
   * answerable; three things answer it — a seller confirming, a document
   * confirming, a document refusing — and each has to undo that. This one sat
   * in `SaleStatementService`, apart from its siblings, and did not: a sale
   * whose denial a statement had just *proved* was left unable to take another
   * payer, with its stake frozen, until its owner gave up and stopped it.
   */
  describe('denyFromStatement', () => {
    const disputed = () => cardOrder({ state: SaleCardOrderState.DISPUTED })

    beforeEach(() => {
      db.moveCardOrder.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.PROVEN_UNPAID })] })
      )
    })

    it('records the order as proven unpaid', async () => {
      await service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())

      expect(db.moveCardOrder).toHaveBeenCalledWith(
        SALE_ID,
        ORDER_ID,
        [SaleCardOrderState.DISPUTED],
        SaleCardOrderState.PROVEN_UNPAID
      )
    })

    /** **The bug.** The sale still has a target to fill and a stake against it. */
    it('puts the terminal back into service', async () => {
      await service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())

      expect(terminals.resumeRouting).toHaveBeenCalled()
    })

    /** Nothing is told upstream: Transacto raises its own appeal from here. */
    it('executes nothing upstream', async () => {
      await service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())

      expect(transacto.executeOrder).not.toHaveBeenCalled()
      expect(orders.markExecutionStarted).not.toHaveBeenCalled()
    })

    it('leaves routing stopped while another order is still disputed', async () => {
      db.moveCardOrder.mockResolvedValue(
        sale({
          cardOrders: [
            cardOrder({ state: SaleCardOrderState.PROVEN_UNPAID }),
            cardOrder({ orderId: 999, state: SaleCardOrderState.DISPUTED })
          ]
        })
      )

      await service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())

      expect(terminals.resumeRouting).not.toHaveBeenCalled()
    })

    /** A sale its owner has stopped must not be handed back to new payers. */
    it('leaves routing stopped on a sale that is winding down', async () => {
      db.moveCardOrder.mockResolvedValue(
        sale({
          status: TmaSaleStatus.CLOSING,
          cardOrders: [cardOrder({ state: SaleCardOrderState.PROVEN_UNPAID })]
        })
      )

      await service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())

      expect(terminals.resumeRouting).not.toHaveBeenCalled()
    })

    /** Somebody else answered first — an operator, or a later statement. */
    it('answers null when the order had already moved on', async () => {
      db.moveCardOrder.mockResolvedValue(null)

      await expect(
        service.denyFromStatement(sale({ cardOrders: [disputed()] }), disputed())
      ).resolves.toBeNull()

      expect(terminals.resumeRouting).not.toHaveBeenCalled()
      expect(progress.emit).not.toHaveBeenCalled()
    })
  })


  /**
   * Whose word each entry stands on.
   *
   * **The one column a card sale's timeline exists to have.** This variant has no
   * witness of its own — the seller types sixteen digits and a name, and both are
   * claims — so "₴1 428 reached this card" is a completely different fact
   * depending on who is saying it. Before `evidence` was recorded, a seller
   * tapping yes and a bank's signed document produced identical entries, and an
   * operator reading the trail afterwards could not tell which had happened.
   *
   * Every one of these is reachable, and three of them write the *same event
   * type* — which is exactly why the evidence cannot be derived from the type.
   */
  describe('evidence', () => {
    const entry = (call: number) => db.appendEvent.mock.calls[call]?.[1]

    const lastEvidence = (): SaleEvidence | undefined => {
      const calls = db.appendEvent.mock.calls
      return calls[calls.length - 1]?.[1]?.evidence
    }

    describe('an order confirmed', () => {
      it('stands on the seller when they tapped yes', async () => {
        await service.confirm(TELEGRAM_ID, SALE_ID, ORDER_ID)

        expect(lastEvidence()).toBe(SaleEvidence.SELLER)
      })

      /**
       * The opposite situation, and the same event type.
       *
       * A seller denied the payment and a document showed the credit anyway. The
       * order settles — but on the bank's word, contradicting theirs, and a trail
       * that recorded this as their confirmation would say they confirmed
       * something they had denied.
       */
      it('stands on the document when a statement contradicted a denial', async () => {
        await service.confirmFromStatement(
          sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] }),
          cardOrder({ state: SaleCardOrderState.DISPUTED })
        )

        expect(lastEvidence()).toBe(SaleEvidence.STATEMENT)
      })
    })

    describe('an order disputed', () => {
      it('stands on the seller when they denied it', async () => {
        await service.deny(TELEGRAM_ID, SALE_ID, ORDER_ID)

        expect(lastEvidence()).toBe(SaleEvidence.SELLER)
      })

      /**
       * Silence is not a claim.
       *
       * Nobody asserted anything — a clock ran out. Recording it as the seller's
       * word would put an assertion in the trail they never made, and a statement
       * would then be shown to have corroborated a claim that never existed.
       */
      it('stands on nobody when the deadline simply passed', async () => {
        await service.expire(
          sale({ cardOrders: [cardOrder()] }),
          cardOrder({ state: SaleCardOrderState.AWAITING_CONFIRMATION })
        )

        expect(lastEvidence()).toBe(SaleEvidence.SYSTEM)
      })

      /**
       * The strongest verdict this product reaches, and it used to leave no trace.
       *
       * `denyFromStatement` moved the order to `PROVEN_UNPAID` and wrote nothing
       * at all — so a bank's document showing no such credit was the one outcome
       * an operator could not read afterwards.
       */
      it('stands on the document when a statement showed no credit', async () => {
        await service.denyFromStatement(
          sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.DISPUTED })] }),
          cardOrder({ state: SaleCardOrderState.DISPUTED })
        )

        expect(db.appendEvent).toHaveBeenCalledWith(
          SALE_ID,
          expect.objectContaining({
            type: SaleEventType.ORDER_DISPUTED,
            evidence: SaleEvidence.STATEMENT
          })
        )
      })
    })

    /**
     * An operator settled it in Transacto's own panel.
     *
     * The seller was never asked, so this is not their claim — and a trail saying
     * otherwise would attribute a decision to somebody who did not make it.
     */
    it('stands on Transacto when an order was settled upstream', async () => {
      db.moveCardOrder.mockResolvedValue(
        sale({ cardOrders: [cardOrder({ state: SaleCardOrderState.CONFIRMED })] })
      )

      await service.markSettledUpstream(sale({ cardOrders: [cardOrder()] }), ORDER_ID)

      expect(entry(0)).toEqual(
        expect.objectContaining({
          type: SaleEventType.ORDER_CONFIRMED,
          evidence: SaleEvidence.UPSTREAM
        })
      )
    })
  })
})
