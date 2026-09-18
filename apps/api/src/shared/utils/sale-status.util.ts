import { TmaSaleStatus } from '@transacto/contracts'

/**
 * Statuses in which a payer may still be routed to this sale's terminal.
 *
 * **`CLOSING` is deliberately absent, and that is the whole reason this is
 * written down.** A sale winding down keeps its terminal in service so a payer
 * already holding an order can still pay, but routing to it was switched off on
 * purpose when its owner asked to stop. Anything that switches routing back on
 * has to ask this first, or it hands the sale back to new payers after the user
 * has ended it.
 *
 * `BLOCKED` is absent for the same shape of reason and a stronger one: it was
 * stopped for breaking a rule.
 */
const ACCEPTS_NEW_PAYERS: readonly TmaSaleStatus[] = [
  TmaSaleStatus.CREATED,
  TmaSaleStatus.TERMINAL_READY,
  TmaSaleStatus.AWAITING_FIAT
]

/**
 * Whether new payers may be routed to this sale.
 *
 * Pure, and here rather than on a service, because the two services that
 * already spell this list out — `SaleCancelService.isOpen` and
 * `SaleProgressService.canCancel` — spell it out *twice*, the second with a
 * comment saying it is duplicated to avoid a dependency cycle. A function has
 * no cycle to close; both are candidates for this and neither is changed here.
 */
export const acceptsNewPayers = (sale: { readonly status: TmaSaleStatus }): boolean =>
  ACCEPTS_NEW_PAYERS.includes(sale.status)
