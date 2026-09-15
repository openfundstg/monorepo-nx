import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  BalanceHistoryEntry,
  SaleAwaitingJar,
  TmaUser,
  TrustLevelInfo
} from '@transacto/contracts'

export const userActions = createActionGroup({
  source: 'User',
  events: {
    /**
     * Re-reads the profile.
     *
     * The session is a snapshot taken when the app opened, and the balance
     * moves without the app being open: a fiat top-up is credited by a
     * reconciler thirty seconds after the receipt lands. Trusting the snapshot
     * left the card showing the balance from launch until the whole Mini App
     * was closed and reopened.
     */
    'Load Profile': emptyProps(),
    'Load Profile Success': props<{
      user: TmaUser
      trustLevel: TrustLevelInfo
      /** Finished sales still holding a slot — see {@link UserState}. */
      slotsAwaitingJarClosure: readonly SaleAwaitingJar[]
    }>(),
    /** Keeps whatever is held: a stale balance beats an empty one. */
    'Load Profile Failure': emptyProps(),

    'Load History': emptyProps(),
    'Load History Success': props<{ history: readonly BalanceHistoryEntry[] }>(),
    'Load History Failure': emptyProps(),

    /**
     * `balance.updated` arrived on the socket.
     *
     * Applied immediately so the card moves without waiting for a round trip,
     * and followed by a refetch: the event carries only the *available*
     * balance, while the things that cause it — an order completing, a stake
     * being frozen — move the frozen side and write a history row too. Without
     * the refetch the card went on showing frozen USDT for money already
     * committed, indefinitely.
     */
    'Balance Pushed': props<{ balance: number }>()
  }
})
