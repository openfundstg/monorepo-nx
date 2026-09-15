import { OrderStatus } from '@transacto/contracts'
import type { HistoryLog } from './history.interface'

/**
 * Adds `expectedDelta` to a history row whose balance has not moved yet.
 *
 * A row with `delta === 0` but pending orders means the deposit is on its way;
 * showing the sum of those orders is more useful than a bare zero.
 */
export const processHistoryLog = (log: unknown): HistoryLog => {
  const processed = { ...(log as HistoryLog) }

  if (processed.delta !== 0 || !processed.orderEvents?.length) return processed

  const pending = processed.orderEvents.filter((event) => event.status === OrderStatus.PENDING)
  if (pending.length > 0) {
    processed.expectedDelta = pending.reduce((sum, event) => sum + event.amount, 0)
  }

  return processed
}

/**
 * How a figure moved between one history row and the one below it.
 *
 * The single rule all three money columns are measured by, so they cannot
 * disagree about what counts as a movement. `undefined` means "nothing to
 * show" — either side unknown, or the figure did not move — which is exactly
 * when the arrow is omitted.
 *
 * Rows are newest-first, so "previous" is the row *below* in the table.
 */
export const historyMovement = (
  current: number | undefined,
  previous: number | undefined
): number | undefined => {
  if (current === undefined || previous === undefined) return undefined

  const delta = current - previous

  return delta !== 0 ? delta : undefined
}

/** Jar money no matched order accounts for; `undefined` without a baseline. */
export const unrecognizedBalance = (log: HistoryLog | undefined): number | undefined => {
  if (!log || log.baseline === undefined) return undefined

  return log.balance - log.baseline
}
