import type { TmaUser } from '@transacto/contracts'
import type { StoredTmaUser } from 'src/modules/repositories/tma-user-db/services'

/**
 * A stored user as the Mini App reads it.
 *
 * One mapping for `/auth` and `/user/profile`, which used to write it out
 * twice — and the second copy left `frozenBalance` off, so the dashboard's
 * frozen figure read `undefined` and never rendered. `isDemo` is deliberately
 * not on the contract: an account learns it is a demo by being sent one.
 */
export const toTmaUser = (user: StoredTmaUser): TmaUser => ({
  telegramId: user.telegramId,
  firstName: user.firstName,
  lastName: user.lastName,
  username: user.username,
  balance: user.balance,
  frozenBalance: user.frozenBalance,
  totalTurnover: user.totalTurnover,
  isActive: user.isActive,
  referralBalance: user.referralBalance,
  totalReferralEarned: user.totalReferralEarned,
  showNameToReferrer: user.showNameToReferrer
})

/**
 * Whether a stored user is a demo account.
 *
 * `=== true` and never truthy, in one place: a lean read of a user stored
 * before the flag existed has no field at all, and that must read as an
 * ordinary account wherever the question is asked.
 */
export const isDemoAccount = (user: Pick<StoredTmaUser, 'isDemo'>): boolean => user.isDemo === true
