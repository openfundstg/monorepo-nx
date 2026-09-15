import type { BankProvider, SaleAwaitingJar } from '@transacto/contracts'
import type { Types } from 'mongoose'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'

/**
 * A finished sale still holding its slot → the row the create form names.
 *
 * Lives here rather than in `src/shared/utils/` because it has to name a stored
 * document's type, and `shared` knows nothing about modules — the same reason
 * `fiat-deposit.util.ts` is here.
 *
 * `updatedAt` is the ending. `completedAt` exists only on a completion and
 * nothing equivalent is stamped on a cancellation, while the last write to an
 * ended order *is* its ending — the only later one is `jarClosedAt`, and an
 * order carrying that is not in this list at all.
 *
 * `bankType` is stored as a plain string because the schema predates the enum
 * being shared; every value written to it comes from `BankProvider`, and the
 * wire type is what the client switches on to name the bank.
 */
export const toAwaitingJar = (
  order: TmaSale & { _id: Types.ObjectId }
): SaleAwaitingJar => ({
  id: order._id.toString(),
  publicId: order.publicId,
  bankType: order.bankType as BankProvider,
  endedAt: new Date(order.updatedAt).toISOString()
})
