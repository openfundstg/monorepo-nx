import { AdminAmountCurrency, type AdminBookFilters } from '@transacto/contracts'

/**
 * The narrowing both books share, as Mongo clauses.
 *
 * One home because the two lists mean exactly the same thing by a date range, a
 * status and a person — only *which field* an amount applies to differs, and
 * that is the argument. Written twice, the second copy is the one where "to the
 * end of that day" quietly becomes "to midnight at the start of it".
 */

/**
 * The day boundaries an operator means.
 *
 * `from` is the start of that day and `to` is the **end** of it, because
 * somebody typing the same date in both boxes means "that day" and not "an
 * empty instant". Built in the server's timezone for the reason `startOfToday`
 * gives: an operator in Kyiv reading a day means their day.
 */
export const dayRange = (
  from: string | undefined,
  to: string | undefined
): { $gte?: Date; $lte?: Date } | null => {
  const clauses: { $gte?: Date; $lte?: Date } = {}

  if (from !== undefined) {
    const start = new Date(from)
    clauses.$gte = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  }

  if (to !== undefined) {
    const end = new Date(to)
    clauses.$lte = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999)
  }

  return Object.keys(clauses).length > 0 ? clauses : null
}

/** Which figure a range applies to, given the pair a row carries. */
export const amountField = (
  currency: AdminAmountCurrency | undefined,
  fields: { readonly uah: string; readonly usdt: string }
): string => (currency === AdminAmountCurrency.USDT ? fields.usdt : fields.uah)

/** `{ $gte, $lte }`, or `null` when neither bound was given. */
export const amountRange = (
  filters: AdminBookFilters
): { $gte?: number; $lte?: number } | null => {
  const clauses: { $gte?: number; $lte?: number } = {}

  if (filters.minAmount !== undefined) clauses.$gte = filters.minAmount
  if (filters.maxAmount !== undefined) clauses.$lte = filters.maxAmount

  return Object.keys(clauses).length > 0 ? clauses : null
}

/**
 * Every shared clause, keyed by the field each applies to.
 *
 * `createdAt` is named rather than assumed: the archive sorts and filters on
 * `uploadedAt`, and a helper that hard-coded one of them would be a helper only
 * two of the three lists could use.
 */
export const bookFilterClauses = (
  filters: AdminBookFilters,
  fields: { readonly date: string; readonly uah: string; readonly usdt: string }
): Record<string, unknown> => {
  const dates = dayRange(filters.from, filters.to)
  const amounts = amountRange(filters)

  return {
    ...(dates === null ? {} : { [fields.date]: dates }),
    ...(amounts === null ? {} : { [amountField(filters.currency, fields)]: amounts }),
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(filters.telegramId === undefined ? {} : { telegramId: filters.telegramId })
  }
}
