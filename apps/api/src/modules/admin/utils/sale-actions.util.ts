import { AdminSaleAction, TmaSaleStatus } from '@transacto/contracts'
import { saleHasJar } from 'src/shared/utils'
import type { SaleDestination } from 'src/shared/utils'

/**
 * Which admin interventions each sale status accepts.
 *
 * **These mirror the preconditions inside the settlement services, and exist so
 * there is exactly one place that states them.** Before this, the panel decided
 * for itself which menu entries to show and got it wrong in three different
 * ways at once: cancelling a blocked order answered `409`, while blocking and
 * completing one succeeded at the HTTP level and did nothing at all, because
 * the guarded update matched no document and every caller reads that as "somebody
 * else got there first".
 *
 * The rules genuinely differ per action, which is why this is three sets and
 * not one list of "final" statuses:
 *
 * - **Cancel** follows `SaleCancelService.isOpen`, which excludes
 *   `CLOSING` on purpose — an order already winding down offers no second stop
 *   button.
 * - **Block** and **Complete** follow `OPEN_STATUSES` in the sale
 *   repository, which includes `CLOSING`.
 * - **`BLOCKED` accepts only `RESUME` and `RELEASE`**, the two halves of a human
 *   review: put the order back to work, or end it and give the stake back.
 *   Those are the only ways out — a blocked order's stake stays frozen and its
 *   slot stays taken, and nothing automatic releases either.
 */
const CANCELLABLE: readonly TmaSaleStatus[] = [
  TmaSaleStatus.CREATED,
  TmaSaleStatus.TERMINAL_READY,
  TmaSaleStatus.AWAITING_FIAT
]

const SETTLEABLE: readonly TmaSaleStatus[] = [...CANCELLABLE, TmaSaleStatus.CLOSING]

/**
 * The two ways out of a block, and the only status either accepts.
 *
 * A blocked order is the one state nothing else can act on: its terminal is
 * down, its stake is frozen and its slot is taken, and until this existed
 * nothing in the system could release any of the three.
 */
const BLOCKED_ONLY: readonly TmaSaleStatus[] = [TmaSaleStatus.BLOCKED]

/**
 * The endings after which a jar can still be open, and still take money.
 *
 * Mirrors `JAR_OUTLIVES_ORDER_STATUSES` in the sale repository, which
 * is what actually decides whether the slot is held. `RELEASE_JAR` on any other
 * status would be an operator vouching for a jar that is not holding anything.
 */
const JAR_OUTLIVES_ORDER: readonly TmaSaleStatus[] = [
  TmaSaleStatus.COMPLETED,
  TmaSaleStatus.CANCELLED
]

const ALLOWED_BY_ACTION: Readonly<Record<AdminSaleAction, readonly TmaSaleStatus[]>> =
  {
    [AdminSaleAction.CANCEL]: CANCELLABLE,
    [AdminSaleAction.BLOCK]: SETTLEABLE,
    [AdminSaleAction.COMPLETE]: SETTLEABLE,
    [AdminSaleAction.RESUME]: BLOCKED_ONLY,
    [AdminSaleAction.RELEASE]: BLOCKED_ONLY,
    [AdminSaleAction.RELEASE_JAR]: JAR_OUTLIVES_ORDER
  }

/**
 * What `RELEASE_JAR` needs to know beyond the status.
 *
 * The only action whose availability is not a function of the status alone: it
 * releases a slot, and a sale holds one only while it has a jar that nothing
 * has yet reported closed (`jarClosedAt`). Offering it on a sale that holds no
 * slot is offering to do nothing.
 *
 * `saleMethod` is here because `cardId` does not answer "has a jar" — every
 * card sale carries one too, and its destination is a person's own card. See
 * {@link saleHasJar}.
 */
export interface SaleActionSubject extends SaleDestination {
  readonly status: TmaSaleStatus
  readonly jarClosedAt?: Date | null
}

/** Whether this sale is one whose slot `RELEASE_JAR` could actually free. */
const holdsAJar = (order: SaleActionSubject): boolean =>
  saleHasJar(order) && !order.jarClosedAt

const isAllowed = (action: AdminSaleAction, order: SaleActionSubject): boolean => {
  if (!ALLOWED_BY_ACTION[action].includes(order.status)) return false

  return action === AdminSaleAction.RELEASE_JAR ? holdsAJar(order) : true
}

/** Every intervention this order would accept, for the row the panel renders. */
export const allowedSaleActions = (
  order: SaleActionSubject
): readonly AdminSaleAction[] =>
  Object.values(AdminSaleAction).filter((action) => isAllowed(action, order))

/** Whether one intervention is available — the guard the endpoint applies. */
export const isSaleActionAllowed = (
  action: AdminSaleAction,
  order: SaleActionSubject
): boolean => isAllowed(action, order)
