import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types, type PipelineStage } from 'mongoose'
import {
  AdminDepositKind,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaFiatReceiptStatus
} from '@transacto/contracts'
import {
  TmaDeposit,
  type TmaDepositDocument
} from 'src/modules/repositories/tma-deposit-db/schemas'
import {
  TmaFiatDeposit,
  type TmaFiatDepositDocument
} from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import { containsRegex } from 'src/shared/utils'
import { facetPage } from 'src/modules/repositories/admin-feed-db/utils'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'
import type { AdminDepositFeedRow } from 'src/modules/repositories/admin-feed-db/interfaces'

/** What a caller may narrow the book to. */
export interface AdminDepositFeedFilter {
  readonly kind?: AdminDepositKind
  readonly search?: string
  readonly telegramId?: number
  /**
   * One deposit, for its own page.
   *
   * Meaningful only alongside {@link kind}: the two collections mint their own
   * ids and nothing guarantees they do not collide, so an id on its own could
   * match a row on either rail.
   */
  readonly id?: Types.ObjectId
}

/** USDT cents per whole USDT. The crypto collection stores whole units. */
const CENTS_PER_USDT = 100

/**
 * The two ways money comes in, read as one book.
 *
 * **A `$unionWith` rather than two queries merged in a service**, because the
 * merge has to happen before the sort and the page. Fetching a page from each
 * collection and interleaving them gives a page that is neither — the tenth
 * newest deposit overall is not the tenth newest of either rail — and the only
 * honest way to do it in the service is to over-fetch `page × limit` from both,
 * which grows without bound as an operator pages.
 *
 * **The projection is where the units are fixed.** `tma_deposits` stores whole
 * USDT and `tma_fiat_deposits` stores cents; both leave here as cents. That
 * conversion happens once, in the pipeline, because a row that carried
 * whichever unit its source used would be a hundredfold error no type catches —
 * both are `number`.
 *
 * The sort runs after the union and so cannot use an index — see `facetPage`,
 * which owns that stage and the two traps in it.
 */
@Injectable()
export class AdminDepositFeedDbService {
  constructor(
    @InjectModel(TmaDeposit.name)
    private readonly depositModel: Model<TmaDepositDocument>,
    @InjectModel(TmaFiatDeposit.name)
    private readonly fiatDepositModel: Model<TmaFiatDepositDocument>
  ) {}

  async findPage(
    filter: AdminDepositFeedFilter,
    page: PageQuery
  ): Promise<Page<AdminDepositFeedRow>> {
    return facetPage<AdminDepositFeedRow, TmaDepositDocument>(
      this.depositModel,
      [...this.cryptoBranch(filter), ...this.fiatBranch(filter)],
      page
    )
  }

  /**
   * The crypto half, always first because the pipeline starts on its model.
   *
   * A kind filter that excludes it cannot simply drop these stages — the union
   * below has to hang off something — so it matches nothing instead, which
   * costs one index probe and keeps the pipeline one shape.
   */
  private cryptoBranch(filter: AdminDepositFeedFilter): PipelineStage[] {
    const excluded = filter.kind === AdminDepositKind.FIAT

    return [
      { $match: excluded ? { _id: null } : this.cryptoMatch(filter) },
      {
        $project: {
          kind: { $literal: AdminDepositKind.CRYPTO },
          telegramId: 1,
          cryptoCents: { $round: [{ $multiply: ['$cryptoAmount', CENTS_PER_USDT] }, 0] },
          fiatAmount: '$fiatEquivalent',
          exchangeRate: 1,
          status: 1,
          // A crypto deposit is not paid in parts, so there is nothing partial
          // to report. `null` rather than `0`, which would read as "none of it
          // has arrived" on a rail where that state does not exist.
          coveredUah: { $literal: null },
          documentCount: { $literal: 0 },
          acceptedDocumentCount: { $literal: 0 },
          payoutId: { $literal: null },
          txId: 1,
          deadlineAt: '$expiresAt',
          completedAt: '$verifiedAt',
          createdAt: 1
        }
      }
    ]
  }

  private fiatBranch(filter: AdminDepositFeedFilter): PipelineStage[] {
    if (filter.kind === AdminDepositKind.CRYPTO) return []

    return [
      {
        $unionWith: {
          coll: this.fiatDepositModel.collection.name,
          pipeline: [
            { $match: this.fiatMatch(filter) },
            {
              $project: {
                kind: { $literal: AdminDepositKind.FIAT },
                telegramId: 1,
                cryptoCents: 1,
                fiatAmount: '$amountUah',
                exchangeRate: 1,
                status: 1,
                coveredUah: 1,
                documentCount: { $size: { $ifNull: ['$receipts', []] } },
                acceptedDocumentCount: {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$receipts', []] },
                      as: 'receipt',
                      cond: { $eq: ['$$receipt.status', TmaFiatReceiptStatus.ACCEPTED] }
                    }
                  }
                },
                payoutId: 1,
                txId: { $literal: null },
                deadlineAt: '$payDeadlineAt',
                completedAt: 1,
                createdAt: 1
              }
            }
          ]
        }
      }
    ]
  }

  /**
   * Matched against the transaction hash and the depositor's id.
   *
   * The hash is what a user pastes into support when a deposit has not landed.
   * Status is not searchable as text — it is an enum, and typing "pending"
   * should not half-match a hash.
   */
  private cryptoMatch(filter: AdminDepositFeedFilter): Record<string, unknown> {
    const scope = this.scope(filter)
    const search = filter.search?.trim()
    if (!search) return scope

    const asNumber = Number(search)
    const asStatus = Object.values(TmaDepositStatus).find(
      (status) => status === search.toUpperCase()
    )

    return {
      ...scope,
      $or: [
        { txId: containsRegex(search) },
        ...(asStatus ? [{ status: asStatus }] : []),
        ...(Number.isFinite(asNumber) ? [{ telegramId: asNumber }] : [])
      ]
    }
  }

  /**
   * Matched against the payout id, the recipient card and the payer's id.
   *
   * The payout id is what an operator carries over from Transacto's own panel,
   * and the card is what a support conversation starts from — searchable even
   * though it is no longer *shown* in the list, because searching for a value
   * somebody already holds discloses nothing.
   */
  private fiatMatch(filter: AdminDepositFeedFilter): Record<string, unknown> {
    const scope = this.scope(filter)
    const search = filter.search?.trim()
    if (!search) return scope

    const asNumber = Number(search)
    const asStatus = Object.values(TmaFiatDepositStatus).find(
      (status) => status === search.toUpperCase()
    )

    return {
      ...scope,
      $or: [
        { recipientCard: containsRegex(search) },
        ...(asStatus ? [{ status: asStatus }] : []),
        ...(Number.isFinite(asNumber) ? [{ payoutId: asNumber }, { telegramId: asNumber }] : [])
      ]
    }
  }

  /** The narrowing both branches share: one person, or one row. */
  private scope(filter: AdminDepositFeedFilter): Record<string, unknown> {
    return {
      ...(filter.telegramId === undefined ? {} : { telegramId: filter.telegramId }),
      ...(filter.id === undefined ? {} : { _id: filter.id })
    }
  }
}
