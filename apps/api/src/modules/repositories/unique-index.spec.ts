import type { Schema } from 'mongoose'
import { TmaDepositSchema } from 'src/modules/repositories/tma-deposit-db/schemas'
import { TmaUserSchema } from 'src/modules/repositories/tma-user-db/schemas'
import { TmaSaleSchema } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaFiatDepositSchema } from 'src/modules/repositories/tma-fiat-deposit-db/schemas'
import { TmaReferralEarningSchema } from 'src/modules/repositories/tma-referral-db/schemas'
import { TmaBalanceEntrySchema } from 'src/modules/repositories/tma-balance-entry-db/schemas'
import { TerminalSchema } from 'src/modules/repositories/terminal-db/schemas'
import { OrderSchema } from 'src/modules/repositories/order-db/schemas'
import { TraderSchema } from 'src/modules/repositories/trader-db/schemas'

const SCHEMAS: Record<string, Schema> = {
  tma_deposits: TmaDepositSchema,
  tma_users: TmaUserSchema,
  tma_sales: TmaSaleSchema,
  tma_fiat_deposits: TmaFiatDepositSchema,
  tma_referral_earnings: TmaReferralEarningSchema,
  tma_balance_entries: TmaBalanceEntrySchema,
  terminals: TerminalSchema,
  orders: OrderSchema,
  traders: TraderSchema
}

/** A path that can legitimately hold `null` on a freshly created document. */
const isNullable = (schema: Schema, path: string): boolean => {
  const type = schema.path(path)
  if (!type) return false

  const required = (type as { isRequired?: boolean }).isRequired === true
  const defaultsToNull = (type as { defaultValue?: unknown }).defaultValue === null

  return defaultsToNull || !required
}

/**
 * Guards the mistake that has now been made twice.
 *
 * A unique index over a field that is `null` on new documents makes those
 * documents collide with *each other*, because MongoDB indexes an explicit
 * `null` like any other value — and `sparse: true` does not help, since it only
 * skips a *missing* field, not a null one.
 *
 * It cost a user the ability to hold more than one unpaid deposit, globally,
 * across the whole system. It had already cost every user but the first their
 * referral code. Both are fixed by a `partialFilterExpression` that indexes
 * only documents where the field actually holds a value.
 *
 * The rule this pins: a unique index on a nullable path must be partial.
 */
describe('unique indexes over nullable fields', () => {
  const offenders = Object.entries(SCHEMAS).flatMap(([collection, schema]) =>
    schema
      .indexes()
      .filter(([, options]) => options?.unique === true)
      .flatMap(([fields, options]) =>
        Object.keys(fields)
          .filter((path) => isNullable(schema, path))
          .filter(() => options?.partialFilterExpression === undefined)
          .map((path) => `${collection}.${path}`)
      )
  )

  it('are always partial, never bare or merely sparse', () => {
    expect(offenders).toEqual([])
  })

  /** The two that were wrong, pinned by name so a revert is unmistakable. */
  it.each([
    ['tma_deposits', TmaDepositSchema, 'txId'],
    ['tma_users', TmaUserSchema, 'referralCode']
  ])('%s.%s filters on the field actually holding a string', (_collection, schema, path) => {
    const index = schema.indexes().find(([fields]) => Object.keys(fields).includes(path))

    expect(index?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { [path]: { $type: 'string' } }
    })
    // `sparse` is the trap, not the fix — it must not be reintroduced.
    expect(index?.[1]?.sparse).toBeUndefined()
  })
})
