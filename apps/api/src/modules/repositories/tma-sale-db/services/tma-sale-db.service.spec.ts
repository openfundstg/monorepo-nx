import { InternalServerErrorException } from '@nestjs/common'
import { Mongoose, Types } from 'mongoose'
import {
  BankProvider,
  PUBLIC_ID_PATTERN,
  SaleCardOrderState,
  SaleEventType,
  SaleEvidence,
  SaleMethod,
  TmaSaleStatus
} from '@transacto/contracts'
import { StatementSubject } from 'src/shared/interfaces'
import { TmaSaleDbService } from './tma-sale-db.service'
import {
  TmaSale,
  TmaSaleSchema
} from 'src/modules/repositories/tma-sale-db/schemas'
import type { Model } from 'mongoose'
import type { TmaSaleDocument } from 'src/modules/repositories/tma-sale-db/schemas'

const CREATE_INPUT = {
  telegramId: 885140,
  fiatAmount: 404_000,
  exchangeRate: 4000,
  frozenUsdt: 10_000,
  bankType: 'MONO',
  dropLink: 'https://send.monobank.ua/jar/abc',
}

const TELEGRAM_ID = 885_140
const ORDER_ID = '000000000000000000000009'

/** What Mongo throws when a unique index rejects a write. */
const duplicateKey = (field: string) =>
  Object.assign(new Error('E11000 duplicate key error'), {
    code: 11000,
    keyPattern: { [field]: 1 },
  })

describe('TmaSaleDbService', () => {
  let model: {
    create: jest.Mock
    findById: jest.Mock
    countDocuments: jest.Mock
    findOne: jest.Mock
    findOneAndUpdate: jest.Mock
    find: jest.Mock
    updateOne: jest.Mock
    updateMany: jest.Mock
  }
  let sortSpy: jest.Mock
  let service: TmaSaleDbService

  beforeEach(() => {
    model = {
      create: jest.fn().mockImplementation(async (doc) => ({ toObject: () => doc })),
      findById: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
      find: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    }
    sortSpy = jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) })
    model.find.mockReturnValue({ sort: sortSpy, lean: () => Promise.resolve([]) })

    service = new TmaSaleDbService(model as unknown as Model<TmaSaleDocument>)
  })

  /**
   * Which statuses hold one of a user's parallel-order slots.
   *
   * The interesting member is `BLOCKED`. It is not open — its terminal is
   * stopped and nothing watches it any more — but its stake stays frozen and it
   * was stopped for breaking a rule of the scheme. Freeing the slot the instant
   * an order is blocked would let the user start another immediately, which
   * makes being blocked cost nothing.
   */
  /**
   * Which statuses still count as watching the jar.
   *
   * `CLOSING` is the one that matters here. A user who stopped an order with
   * payments outstanding still has a live terminal, and the matcher finds the
   * sale behind an incoming payment through exactly this query. Leave
   * `CLOSING` out and money would land in the jar with nothing to attribute it
   * to — the order would never be confirmed upstream, and the stake would be
   * refunded in full to a user who had already been paid.
   */
  describe('the statuses that are still watching for money', () => {
    const statusesFound = async (): Promise<TmaSaleStatus[]> => {
      await service.findOpenByCardId(100)

      return model.findOne.mock.calls[0][0].status.$in
    }

    it.each([
      TmaSaleStatus.CREATED,
      TmaSaleStatus.TERMINAL_READY,
      TmaSaleStatus.AWAITING_FIAT,
      TmaSaleStatus.CLOSING,
    ])('still looks for %s', async (status) => {
      expect(await statusesFound()).toContain(status)
    })

    it.each([
      TmaSaleStatus.COMPLETED,
      TmaSaleStatus.CANCELLED,
      TmaSaleStatus.FAILED,
      TmaSaleStatus.BLOCKED,
    ])('has stopped looking for %s', async (status) => {
      expect(await statusesFound()).not.toContain(status)
    })
  })

  /**
   * The last link: an order that has finished winding down has to be settleable.
   *
   * `cancelIfOpen` is the atomic gate the closing sweep unwinds the stake
   * through. If `CLOSING` were not accepted here, the sweep would find nothing
   * to flip and refuse the order on every pass — leaving the user's USDT frozen
   * for good with the terminal already stood down.
   */
  describe('settling a stop', () => {
    it('accepts an order that has been winding down', async () => {
      await service.cancelIfOpen('order-1')

      expect(model.findOneAndUpdate.mock.calls[0][0].status.$in).toContain(
        TmaSaleStatus.CLOSING,
      )
    })

    /** And still refuses one that has already ended. */
    it.each([
      TmaSaleStatus.COMPLETED,
      TmaSaleStatus.CANCELLED,
      TmaSaleStatus.BLOCKED,
    ])('refuses an order that is already %s', async (status) => {
      await service.cancelIfOpen('order-1')

      expect(model.findOneAndUpdate.mock.calls[0][0].status.$in).not.toContain(status)
    })
  })

  /**
   * What stops a user starting another sale.
   *
   * Two different reasons, which is why the query is an `$or`. An order that is
   * still running holds a slot because it is still running. An order that has
   * *ended* holds one because its jar is still open — and an open jar keeps
   * taking money after the order behind it is gone, which arrives as an appeal
   * nobody can match. Only closing the jar releases it — there is no time
   * limit, deliberately. One was tried and it treated the symptom: the count
   * came down while the jars stayed open. What makes the rule liveable is that
   * the product now names the jars, on the dashboard and in the create form.
   */
  /**
   * The one write on this service that touches three things at once, and has
   * to: the sale's total, the rows the seller is looking at, and the entry that
   * says which document moved them. Written separately, a failure in between
   * leaves a sale whose figures do not match its own screen.
   */
  describe('applying a statement checkpoint', () => {
    const apply = async (corrected: unknown[]) => {
      await service.applyStatementCheckpoint(
        ORDER_ID,
        new Date('2026-09-20T23:59:59Z'),
        { correctionKopecks: 400, corrected } as never
      )

      return model.findOneAndUpdate.mock.calls[0]
    }

    it('credits the difference and stamps the checkpoint', async () => {
      const [filter, update] = await apply([])

      expect(update.$inc).toEqual({ receivedAmount: 400 })
      expect(update.$max).toEqual({ statementCheckpointAt: new Date('2026-09-20T23:59:59Z') })
      // Nothing to `$set` for a seller who told the truth, and Mongo refuses an
      // empty one.
      expect(update.$set).toBeUndefined()
      expect(filter).toEqual({ _id: ORDER_ID })
    })

    /**
     * **The checkpoint moves the sale forward; it does not decide whether the
     * write happens.**
     *
     * It was a filter once — refuse unless the new date is strictly later — and
     * that made a second statement covering the same day a no-op. Sale 9CTBSY7W
     * had one accepted for a denial at 20:56 and another at 20:57 carrying a ₴4
     * correction; both ended at the same midnight, so the second was refused
     * whole. The correction, the proven figure and the timeline entry went with
     * it, and every further statement that day would have been refused the same
     * way, because they all end at the same moment.
     *
     * Applying a correction twice is prevented in the arithmetic instead, which
     * measures from `provenAmount` rather than from what the seller said.
     */
    it('applies a statement that only reaches as far as the last one', async () => {
      const [filter, update] = await apply([
        { orderId: 7, declaredKopecks: 29_600, provenKopecks: 30_000 }
      ])

      expect(filter.statementCheckpointAt).toBeUndefined()
      expect(update.$max).toEqual({ statementCheckpointAt: new Date('2026-09-20T23:59:59Z') })
      expect(update.$inc).toEqual({ receivedAmount: 400 })
    })

    /** The row the seller reads, so it cannot disagree with the total above. */
    it('writes each corrected order its proven figure', async () => {
      const [, update, options] = await apply([
        { orderId: 7, declaredKopecks: 29_800, provenKopecks: 30_000 }
      ])

      expect(update.$set['cardOrders.$[o0].provenAmount']).toBe(30_000)
      expect(options.arrayFilters).toEqual([{ 'o0.orderId': 7 }])
    })

    /**
     * `cardOrders.$` would match only the first, and one statement routinely
     * corrects several orders — it is a checkpoint over a period, not an answer
     * about one payment.
     */
    it('gives every corrected order a filter of its own', async () => {
      const [, update, options] = await apply([
        { orderId: 7, declaredKopecks: 29_800, provenKopecks: 30_000 },
        { orderId: 8, declaredKopecks: 29_600, provenKopecks: 30_000 }
      ])

      expect(options.arrayFilters).toEqual([{ 'o0.orderId': 7 }, { 'o1.orderId': 8 }])
      expect(update.$set['cardOrders.$[o1].provenAmount']).toBe(30_000)
    })

    /** Both figures on the entry: the sentence interpolates both. */
    it('records what changed on the timeline', async () => {
      const [, update] = await apply([
        { orderId: 7, declaredKopecks: 29_800, provenKopecks: 30_000 }
      ])

      expect(update.$push.events.$each).toEqual([
        expect.objectContaining({
          type: SaleEventType.STATEMENT_CORRECTED,
          amount: 30_000,
          declaredAmount: 29_800,
          orderId: 7,
          evidence: SaleEvidence.STATEMENT
        })
      ])
    })

    /** The ordinary case: a seller who told the truth. Nothing to say about it. */
    it('pushes nothing and filters nothing when the document agrees', async () => {
      const [, update, options] = await apply([])

      expect(update.$push).toBeUndefined()
      expect(options.arrayFilters).toBeUndefined()
    })
  })

  describe('countSlotsHeldByTelegramId', () => {
    const query = async (): Promise<Record<string, unknown>> => {
      await service.countSlotsHeldByTelegramId(885140)

      return model.countDocuments.mock.calls[0][0]
    }

    const runningStatuses = async (): Promise<TmaSaleStatus[]> =>
      ((await query()).$or as { status: { $in: TmaSaleStatus[] } }[])[0].status.$in

    const endedStatuses = async (): Promise<TmaSaleStatus[]> =>
      ((await query()).$or as { status: { $in: TmaSaleStatus[] } }[])[1].status.$in

    it('counts only this user', async () => {
      expect(await query()).toMatchObject({ telegramId: 885140 })
    })

    describe('an order that is still running', () => {
      it.each([
        TmaSaleStatus.CREATED,
        TmaSaleStatus.TERMINAL_READY,
        TmaSaleStatus.AWAITING_FIAT,
        TmaSaleStatus.CLOSING,
        TmaSaleStatus.BLOCKED,
      ])('holds a slot while %s', async (status) => {
        expect(await runningStatuses()).toContain(status)
      })
    })

    describe('an order that has ended with its jar still open', () => {
      it.each([TmaSaleStatus.COMPLETED, TmaSaleStatus.CANCELLED])(
        'still holds a slot after %s',
        async (status) => {
          expect(await endedStatuses()).toContain(status)
        },
      )

      /** The jar is what is being waited on, so a closed one releases the slot. */
      it('releases it once the jar is closed', async () => {
        expect((await query()).$or).toContainEqual(
          expect.objectContaining({ jarClosedAt: null }),
        )
      })

      /**
       * And on nothing else. A time limit was tried here — an hour — because
       * the rule had locked a NEWBIE out at "4/1 running" with no way to bring
       * the count down. It treated the symptom: the count came down while the
       * jars stayed open, so the risk the rule exists for went unaccounted and
       * the user was told nothing either way.
       *
       * What replaced it is the product saying which jar to close. A clock
       * reappearing in this filter would silently undo that.
       */
      it('waits on the jar and on nothing else — no time limit', async () => {
        const ended = ((await query()).$or as Record<string, unknown>[])[1]

        expect(ended).toEqual({
          status: { $in: [TmaSaleStatus.COMPLETED, TmaSaleStatus.CANCELLED] },
          cardId: { $ne: null },
          saleMethod: { $ne: SaleMethod.CARD },
          jarClosedAt: null,
        })
      })

      /**
       * An order that never got a terminal has no jar to close, so holding its
       * slot would leave the user nothing they could do about it.
       */
      it('never waits on an order that has no jar', async () => {
        expect((await query()).$or).toContainEqual(
          expect.objectContaining({ cardId: { $ne: null } }),
        )
      })

      /**
       * **And a card sale has no jar either, which `cardId` does not say.**
       * Both variants get a Transacto credential, so both carry one — this
       * branch therefore held a card seller's slot for good, waiting on a
       * closure nobody could ever report. It is the reason a sale stopped early
       * never gave its slot back.
       */
      it('never waits on a card sale, which has no jar to close', async () => {
        expect((await query()).$or).toContainEqual(
          expect.objectContaining({ saleMethod: { $ne: SaleMethod.CARD } }),
        )
      })

      /** Creation failed before a terminal existed — same reasoning. */
      it('does not wait on a FAILED order', async () => {
        expect(await endedStatuses()).not.toContain(TmaSaleStatus.FAILED)
      })
    })
  })

  /**
   * The half of the slot count a user can act on.
   *
   * It has to select exactly what the count's second branch selects: a list
   * disagreeing with the count would name the wrong jars, which is worse for
   * the person reading it than naming none at all.
   */
  describe('findAwaitingJarClosureByTelegramId', () => {
    it('filters on the same condition the count holds a slot for', async () => {
      await service.findAwaitingJarClosureByTelegramId(TELEGRAM_ID)

      const [filter] = model.find.mock.calls.at(-1) as [Record<string, unknown>]

      // The count's own second branch, read from the count itself rather than
      // restated here: a copy would pass while the two drifted apart.
      await service.countSlotsHeldByTelegramId(TELEGRAM_ID)
      const [, endedWithOpenJar] = model.countDocuments.mock.calls.at(-1)![0]
        .$or as Record<string, unknown>[]

      expect(filter).toEqual({ telegramId: TELEGRAM_ID, ...endedWithOpenJar })
    })

    it('returns the most recently ended first', async () => {
      await service.findAwaitingJarClosureByTelegramId(TELEGRAM_ID)

      expect(sortSpy).toHaveBeenCalledWith({ updatedAt: -1 })
    })
  })

  /**
   * An operator vouching for a jar the bank will not vouch for.
   *
   * Keyed by the order, unlike `markJarClosedByCardId`: a card can carry
   * several sales, and a human who looked at one has not looked at the others.
   */
  describe('markJarClosedById', () => {
    it('stamps the jar closed for exactly one order', async () => {
      model.updateOne.mockResolvedValue({ modifiedCount: 1 })

      await expect(service.markJarClosedById(ORDER_ID)).resolves.toBe(true)
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: ORDER_ID, jarClosedAt: null },
        { $set: { jarClosedAt: expect.any(Date) } },
      )
    })

    /** A second press must not move a timestamp somebody already set. */
    it('answers false when the jar is already recorded as closed', async () => {
      model.updateOne.mockResolvedValue({ modifiedCount: 0 })

      await expect(service.markJarClosedById(ORDER_ID)).resolves.toBe(false)
    })
  })

  /**
   * Migration `0003`'s write, and the one option that makes it work.
   *
   * Mongoose's default `strict: true` silently removes update keys for paths
   * the schema does not declare — and this method exists to unset two paths the
   * schema deliberately no longer declares. Without the option the `$unset` was
   * dropped while the `$set` was kept, so the document was rewritten and never
   * left the migration's filter. It ran about eleven thousand times against
   * production and drove every exchange rate to 1e97 before it was killed.
   *
   * `modifiedCount` was 1 on every one of those passes, so nothing downstream
   * could have noticed. This is the guard.
   */
  describe('repriceToSellRate', () => {
    it('turns strict mode off, or the unset is silently dropped', async () => {
      model.updateOne.mockResolvedValue({ modifiedCount: 1 })

      await service.repriceToSellRate(ORDER_ID as never, 4_660)

      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: ORDER_ID, profitPercent: { $exists: true } },
        {
          $set: { exchangeRate: 4_660 },
          $unset: { profitPercent: '', expectedProfit: '' }
        },
        { strict: false },
      )
    })

    /** Already converted: the guard matches nothing, and the caller is told. */
    it('answers false for an order that no longer carries the old fields', async () => {
      model.updateOne.mockResolvedValue({ modifiedCount: 0 })

      await expect(service.repriceToSellRate(ORDER_ID as never, 4_660)).resolves.toBe(false)
    })
  })

  /**
   * Migration `0006`'s write — the same trap as `0003`, from the other side.
   *
   * The schema stopped declaring `receiverName` precisely so that nothing writes
   * it again, and that same absence is what makes Mongoose's default strip the
   * `$unset`. Without the option the migration reports zero documents, records
   * itself as run, and every name stays exactly where it was.
   */
  describe('forgetReceiverNames', () => {
    it('turns strict mode off, or the unset is silently dropped', async () => {
      model.updateMany.mockResolvedValue({ modifiedCount: 20 })

      await expect(service.forgetReceiverNames()).resolves.toBe(20)

      expect(model.updateMany).toHaveBeenCalledWith(
        { receiverName: { $exists: true } },
        { $unset: { receiverName: '' } },
        { strict: false },
      )
    })

    /** A second run finds nothing, and says so rather than failing. */
    it('reports zero once every name is gone', async () => {
      await expect(service.forgetReceiverNames()).resolves.toBe(0)
    })
  })

  describe('create', () => {
    it('allocates a public id in the contracted format', async () => {
      const order = await service.create(CREATE_INPUT)

      expect(order.publicId).toMatch(PUBLIC_ID_PATTERN)
    })

    /**
     * A pre-check for an unused id would still race two concurrent creates, so
     * the unique index is the authority and a collision just means "draw again".
     */
    it('regenerates and retries when the id collides', async () => {
      model.create
        .mockRejectedValueOnce(duplicateKey('publicId'))
        .mockImplementationOnce(async (doc) => ({ toObject: () => doc }))

      const order = await service.create(CREATE_INPUT)

      expect(model.create).toHaveBeenCalledTimes(2)
      expect(order.publicId).toMatch(PUBLIC_ID_PATTERN)

      const [first, second] = model.create.mock.calls.map(([doc]) => doc.publicId)
      expect(first).not.toBe(second)
    })

    it('gives up after exhausting its attempts', async () => {
      model.create.mockRejectedValue(duplicateKey('publicId'))

      await expect(service.create(CREATE_INPUT)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      )
      expect(model.create).toHaveBeenCalledTimes(5)
    })

    /**
     * Retrying a duplicate on some *other* unique index would loop five times
     * and then report the wrong error, hiding the real problem.
     */
    it('rethrows a duplicate key on any other field immediately', async () => {
      model.create.mockRejectedValue(duplicateKey('telegramId'))

      await expect(service.create(CREATE_INPUT)).rejects.toMatchObject({ code: 11000 })
      expect(model.create).toHaveBeenCalledTimes(1)
    })

    it('rethrows an unrelated failure without retrying', async () => {
      model.create.mockRejectedValue(new Error('connection lost'))

      await expect(service.create(CREATE_INPUT)).rejects.toThrow('connection lost')
      expect(model.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('findById', () => {
    /**
     * `Model.findById` throws a CastError — surfacing as a 500 — for anything
     * that is not a 24-character hex string, so a mistyped id in a URL used to
     * crash the request instead of reading as "not found".
     */
    it('treats a malformed id as not found without querying', async () => {
      await expect(service.findById('Z38SL69F')).resolves.toBeNull()

      expect(model.findById).not.toHaveBeenCalled()
    })

    it('queries for a well-formed ObjectId', async () => {
      await service.findById('507f1f77bcf86cd799439011')

      expect(model.findById).toHaveBeenCalledWith('507f1f77bcf86cd799439011')
    })
  })
})


const JAR_ORDER_ID = '000000000000000000000001'
const JAR_BALANCE = 8_700

/**
 * A real Mongoose model on an unconnected instance, whose `findOneAndUpdate`
 * builds the query for real and then hands back a stub instead of executing.
 *
 * The mocked models above cannot catch a malformed query — they replace the
 * very thing being tested. Mongoose validates an update while *building* the
 * query, before any I/O, so letting the real builder run and discarding the
 * result proves the query is well-formed at no cost and with no database.
 */
const withRealModel = () => {
  const model = new Mongoose().model(
    TmaSale.name,
    TmaSaleSchema
  ) as unknown as Model<TmaSaleDocument>

  const build = model.findOneAndUpdate.bind(model)
  const calls: { filter: unknown; update: unknown }[] = []

  jest
    .spyOn(model, 'findOneAndUpdate')
    .mockImplementation((filter?: never, update?: never, options?: never) => {
      const query = build(filter, update, options)
      calls.push({ filter: query.getFilter(), update: query.getUpdate() })

      return { lean: () => Promise.resolve(null) } as never
    })

  return { service: new TmaSaleDbService(model), calls }
}

describe('TmaSaleDbService.updateJarBalance', () => {
  /**
   * `openingJarBalance` is seeded through `$ifNull` in the same update, which
   * makes it an aggregation pipeline — and Mongoose 9 rejects an array update
   * unless `updatePipeline` is set. It rejects at runtime, not at compile time,
   * so `nx typecheck` and every mocked test stayed green while the query threw
   * on every scrape that moved a Mini App jar's balance:
   *
   *   Cannot pass an array to query updates unless the `updatePipeline` option
   *   is set.
   */
  it('builds a query Mongoose accepts', async () => {
    const { service } = withRealModel()

    await expect(service.updateJarBalance(JAR_ORDER_ID, JAR_BALANCE)).resolves.toBeNull()
  })

  it('seeds openingJarBalance from the balance, and only when it is unset', async () => {
    const { service, calls } = withRealModel()

    await service.updateJarBalance(JAR_ORDER_ID, JAR_BALANCE)

    expect(calls[0].update).toEqual([
      {
        $set: {
          jarBalance: JAR_BALANCE,
          openingJarBalance: { $ifNull: ['$openingJarBalance', JAR_BALANCE] },
        },
      },
    ])
  })

  /** The heartbeat re-broadcasts an unchanged balance; that must not write. */
  it('only matches when the balance actually differs', async () => {
    const { service, calls } = withRealModel()

    await service.updateJarBalance(JAR_ORDER_ID, JAR_BALANCE)

    expect(calls[0].filter).toEqual(
      expect.objectContaining({ jarBalance: { $ne: JAR_BALANCE } }),
    )
  })
})

/**
 * **Which order a bank statement may attach itself to.**
 *
 * Two, and they are not the same order in the same state: a `DISPUTED` one,
 * whose seller says the payment never came, and a `CONFIRMED` one carrying the
 * figure its seller declared when they said it came up short.
 *
 * This write used to insist on `DISPUTED` outright — a second statement of a
 * rule the service had already applied. So a seller who declared a shortfall
 * was shown "a statement is needed", handed an upload box, and met a 409 after
 * their file had already been written to disk. The filter now re-applies the
 * caller's own decision instead of restating the rule.
 */
describe('TmaSaleDbService.pushStatement', () => {
  const SALE_ID = '000000000000000000000009'
  const ORDER = 2_052_688

  let model: { findOneAndUpdate: jest.Mock }
  let service: TmaSaleDbService

  beforeEach(() => {
    model = {
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) })
    }
    service = new TmaSaleDbService(model as unknown as Model<TmaSaleDocument>)
  })

  const push = async (answers: StatementSubject) => {
    await service.pushStatement(
      SALE_ID,
      ORDER,
      {
        _id: new Types.ObjectId(),
        bank: BankProvider.MONO,
        storedName: 'statement.pdf',
        sizeBytes: 183_836
      },
      answers
    )

    const [filter] = model.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>]

    return filter['cardOrders'] as { $elemMatch: Record<string, unknown> }
  }

  it('takes a denial only while the order is still disputed', async () => {
    const matched = await push(StatementSubject.DENIAL)

    expect(matched.$elemMatch).toEqual({ orderId: ORDER, state: SaleCardOrderState.DISPUTED })
  })

  /**
   * The regression this describes. A checkpoint statement answers a claim on an
   * order that was confirmed — insisting on `DISPUTED` here matched nothing and
   * refused every one of them.
   */
  it('takes a shortfall on a confirmed order that carries a declared figure', async () => {
    const matched = await push(StatementSubject.SHORTFALL)

    expect(matched.$elemMatch).toEqual({ orderId: ORDER, declaredAmount: { $exists: true } })
    expect(matched.$elemMatch['state']).toBeUndefined()
  })
})
