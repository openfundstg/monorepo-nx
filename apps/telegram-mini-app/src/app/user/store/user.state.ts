import type {
  BalanceHistoryEntry,
  SaleAwaitingJar,
  TmaUser,
  TrustLevelInfo
} from '@transacto/contracts'

/**
 * The signed-in user's own figures: balance, turnover, level, timeline.
 *
 * One slice for all of it because they move together. A completed sale
 * commits frozen USDT, raises turnover and writes a history row in the same
 * instant, and the screens that read them used to hold three private copies
 * reconciled by hand — the dashboard ran a `linkedSignal` deciding whether the
 * profile it fetched or the socket event it latched was the newer of the two.
 * A store has one answer by construction: the last write wins, and every screen
 * reads the same one.
 */
export interface UserState {
  readonly profile: TmaUser | null
  /**
   * The level and what it allows, as `/auth` composes it.
   *
   * `/user/profile` reports the same thing as a bare enum plus its allowances,
   * so the reducer rebuilds this shape rather than making every consumer know
   * which endpoint its copy came from.
   */
  readonly trustLevel: TrustLevelInfo | null
  /**
   * Finished sales whose jars are still open, newest first.
   *
   * Each one is holding a sale slot until its owner closes the jar, and
   * nothing else can release it. It lives in this slice rather than in the
   * create form because the form is the one screen a blocked user has no reason
   * to open — they are not trying to start a sale, they are wondering why the
   * dashboard says they have one running.
   */
  readonly slotsAwaitingJarClosure: readonly SaleAwaitingJar[]
  /** Newest first, as the server orders it. */
  readonly history: readonly BalanceHistoryEntry[]
  readonly loadingProfile: boolean
  readonly loadingHistory: boolean
  /**
   * Whether the timeline has been asked for and answered — successfully or not.
   *
   * Separate from `history.length`, because an empty array is both the initial
   * value and a perfectly ordinary answer. Without this the dashboard cannot
   * tell "still loading" from "you have done nothing yet", and it draws the
   * second while the first is true.
   */
  readonly historyLoaded: boolean
}

export const USER_FEATURE = 'user'

export const initialUserState: UserState = {
  profile: null,
  trustLevel: null,
  slotsAwaitingJarClosure: [],
  history: [],
  loadingProfile: false,
  loadingHistory: false,
  historyLoaded: false
}
