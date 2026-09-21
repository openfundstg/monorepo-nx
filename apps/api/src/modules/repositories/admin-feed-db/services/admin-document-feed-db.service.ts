import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types, type PipelineStage } from 'mongoose'
import { AdminDocumentKind, SaleMethod } from '@transacto/contracts'
import { TmaSale, type TmaSaleDocument } from 'src/modules/repositories/tma-sale-db/schemas'
import {
  TmaFiatDeposit,
  type TmaFiatDepositDocument
} from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import { containsRegex } from 'src/shared/utils'
import { facetPage } from 'src/modules/repositories/admin-feed-db/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'
import type { AdminDocumentFeedRow } from 'src/modules/repositories/admin-feed-db/interfaces'

/** What a caller may narrow the archive to. */
export interface AdminDocumentFeedFilter {
  readonly kind?: AdminDocumentKind
  readonly search?: string
  readonly telegramId?: number
  /** Everything sent about one sale — what its own page embeds. */
  readonly saleId?: Types.ObjectId
  /** Everything sent about one top-up. */
  readonly fiatDepositId?: Types.ObjectId
}

/**
 * Every file this product holds or once held, read as one archive.
 *
 * **Both kinds live inside other documents** — a statement under a sale's card
 * order, a receipt under a fiat top-up — so listing them is an `$unwind` before
 * it is anything else, and there is no version of this that a plain `find` can
 * do. A `$unionWith` then puts the two on one page, for the reason
 * `AdminDepositFeedDbService` gives about sorting before paging.
 *
 * **The projection names every field, including the ones it sets to `null`.**
 * A statement has no payout and a receipt has no period, and leaving those out
 * of one branch would make the union's rows two shapes wearing one type — which
 * is precisely the bug a discriminated row exists to prevent.
 *
 * `storedName` is projected and never reaches the wire: the download route
 * reads it, an operator has no use for a path, and the mapper drops it.
 */
@Injectable()
export class AdminDocumentFeedDbService {
  constructor(
    @InjectModel(TmaSale.name)
    private readonly saleModel: Model<TmaSaleDocument>,
    @InjectModel(TmaFiatDeposit.name)
    private readonly fiatDepositModel: Model<TmaFiatDepositDocument>
  ) {}

  async findPage(
    filter: AdminDocumentFeedFilter,
    page: PageQuery
  ): Promise<Page<AdminDocumentFeedRow>> {
    return facetPage<AdminDocumentFeedRow, TmaSaleDocument>(
      this.saleModel,
      [...this.statementBranch(filter), ...this.receiptBranch(filter), ...this.searchStage(filter)],
      page
    )
  }

  /**
   * One document, addressed directly.
   *
   * A pipeline of its own because `$unwind` is the only way to reach a
   * subdocument by its own id, and the two collections keep them in different
   * places.
   */
  async findById(
    kind: AdminDocumentKind,
    id: Types.ObjectId
  ): Promise<AdminDocumentFeedRow | null> {
    const pipeline =
      kind === AdminDocumentKind.SALE_STATEMENT
        ? [
            { $match: { 'cardOrders.statements._id': id } },
            { $unwind: '$cardOrders' },
            { $unwind: '$cardOrders.statements' },
            { $match: { 'cardOrders.statements._id': id } },
            { $project: STATEMENT_PROJECTION }
          ]
        : [
            { $match: { 'receipts._id': id } },
            { $unwind: '$receipts' },
            { $match: { 'receipts._id': id } },
            { $project: RECEIPT_PROJECTION }
          ]

    const model =
      kind === AdminDocumentKind.SALE_STATEMENT ? this.saleModel : this.fiatDepositModel

    const [row] = await model.aggregate<AdminDocumentFeedRow>(pipeline as PipelineStage[]).exec()

    return row ?? null
  }

  /**
   * The statements half, always first because the pipeline starts on its model.
   *
   * The pre-match is on the sale, not the statement: it is indexable, it drops
   * every jar sale and every card sale nobody sent a document about, and what
   * it leaves is small enough that unwinding it is cheap.
   */
  private statementBranch(filter: AdminDocumentFeedFilter): PipelineStage[] {
    const excluded =
      filter.kind === AdminDocumentKind.FIAT_RECEIPT || filter.fiatDepositId !== undefined

    const match: Record<string, unknown> = {
      saleMethod: SaleMethod.CARD,
      'cardOrders.statements.0': { $exists: true },
      ...(filter.telegramId === undefined ? {} : { telegramId: filter.telegramId }),
      ...(filter.saleId === undefined ? {} : { _id: filter.saleId })
    }

    return [
      { $match: excluded ? { _id: null } : match },
      { $unwind: '$cardOrders' },
      { $unwind: '$cardOrders.statements' },
      { $project: STATEMENT_PROJECTION }
    ]
  }

  private receiptBranch(filter: AdminDocumentFeedFilter): PipelineStage[] {
    if (filter.kind === AdminDocumentKind.SALE_STATEMENT || filter.saleId !== undefined) return []

    const match: Record<string, unknown> = {
      'receipts.0': { $exists: true },
      ...(filter.telegramId === undefined ? {} : { telegramId: filter.telegramId }),
      ...(filter.fiatDepositId === undefined ? {} : { _id: filter.fiatDepositId })
    }

    return [
      {
        $unionWith: {
          coll: this.fiatDepositModel.collection.name,
          pipeline: [
            { $match: match },
            { $unwind: '$receipts' },
            { $project: RECEIPT_PROJECTION }
          ]
        }
      }
    ]
  }

  /**
   * Search, applied after the union rather than per branch.
   *
   * The fields an operator types — a sale's public code, a Transacto order
   * number, a payout id — live under different names in the two collections and
   * are the *projected* names by the time they agree. One `$match` on the
   * finished shape is the only place both can be asked the same question, and
   * it is the one stage here that cannot use an index. That is acceptable: a
   * search is what an operator does occasionally, and the set it filters is
   * already only the documents.
   */
  private searchStage(filter: AdminDocumentFeedFilter): PipelineStage[] {
    const search = filter.search?.trim()
    if (!search) return []

    const asNumber = Number(search)
    // **Three separate numberings, asked together on purpose.** A Transacto
    // order and a Transacto payout are different entities that both count from
    // one, so a typed number may name either and this cannot know which was
    // meant — each row says its own kind. What must never happen is the panel
    // *itself* equating them: a link that has a payout id narrows by kind, so
    // only a person typing into the box sees both books at once.
    const numeric =
      Number.isSafeInteger(asNumber) && asNumber > 0
        ? [{ cardOrderId: asNumber }, { payoutId: asNumber }, { telegramId: asNumber }]
        : []

    return [
      {
        $match: {
          $or: [
            { salePublicId: containsRegex(search) },
            { ownerName: containsRegex(search) },
            ...numeric
          ]
        }
      }
    ]
  }
}

/**
 * A field that may simply not be on an older subdocument, read as `null`.
 *
 * **`$project` omits a path the source does not have**, so a row written before
 * a field existed arrives with `undefined` where the row type promises `null` —
 * and `undefined !== null` is `true`. `fileAvailable` is computed from exactly
 * that comparison, so without this a receipt uploaded before this product kept
 * any files would claim to have one, and the panel would offer a download that
 * answers 404.
 *
 * It came out right by accident: the second half of that condition
 * (`purgedAt === null`, also `undefined`) happened to be false. Depending on a
 * coincidence for whether an operator is offered a broken button is not a thing
 * to leave in place.
 */
const orNull = (path: string): Record<string, unknown> => ({ $ifNull: [path, null] })

/** A statement, as the archive's one row shape. */
const STATEMENT_PROJECTION = {
  _id: '$cardOrders.statements._id',
  kind: { $literal: AdminDocumentKind.SALE_STATEMENT },
  telegramId: 1,
  bank: orNull('$cardOrders.statements.bank'),
  status: '$cardOrders.statements.status',
  rejection: orNull('$cardOrders.statements.rejection'),
  // A statement states no single sum — it is asked to show that one is
  // *absent*. `null` rather than a zero that would read as "nothing arrived".
  amountUah: { $literal: null },
  sizeBytes: orNull('$cardOrders.statements.sizeBytes'),
  storedName: orNull('$cardOrders.statements.storedName'),
  uploadedAt: '$cardOrders.statements.uploadedAt',
  purgedAt: orNull('$cardOrders.statements.purgedAt'),
  // Nobody downstream ever sees a statement, so there is no copy to link to.
  externalUrl: { $literal: null },
  saleId: '$_id',
  salePublicId: '$publicId',
  cardOrderId: '$cardOrders.orderId',
  fiatDepositId: { $literal: null },
  payoutId: { $literal: null },
  periodFrom: orNull('$cardOrders.statements.periodFrom'),
  periodTo: orNull('$cardOrders.statements.periodTo'),
  ownerName: orNull('$cardOrders.statements.ownerName'),
  recipientChecked: { $literal: null }
} as const

/** A receipt, as the same shape. */
const RECEIPT_PROJECTION = {
  _id: '$receipts._id',
  kind: { $literal: AdminDocumentKind.FIAT_RECEIPT },
  telegramId: 1,
  // Every one of these post-dates some receipts in the collection — the archive
  // itself is newer than the feature — so each is read through `orNull`.
  bank: orNull('$receipts.bank'),
  status: '$receipts.status',
  rejection: orNull('$receipts.rejection'),
  // Transacto's figure, never one we read — coverage is counted in what the
  // counterparty acknowledged.
  amountUah: orNull('$receipts.amountUah'),
  sizeBytes: orNull('$receipts.sizeBytes'),
  storedName: orNull('$receipts.storedName'),
  uploadedAt: '$receipts.uploadedAt',
  purgedAt: orNull('$receipts.purgedAt'),
  externalUrl: orNull('$receipts.checkUrl'),
  saleId: { $literal: null },
  salePublicId: { $literal: null },
  cardOrderId: { $literal: null },
  fiatDepositId: '$_id',
  payoutId: 1,
  periodFrom: { $literal: null },
  periodTo: { $literal: null },
  ownerName: { $literal: null },
  recipientChecked: orNull('$receipts.recipientChecked')
} as const
