import type { Order } from 'src/modules/repositories/order-db/schemas'
import { isEnabledFlag } from 'src/shared/utils'
import environments from 'src/environments'

export enum MatchResultStatus {
  PERFECT_MATCH = 'PERFECT_MATCH',
  FUZZY_MATCH = 'FUZZY_MATCH',
  UNRECOGNIZED = 'UNRECOGNIZED',
  AMBIGUOUS = 'AMBIGUOUS',
  IDLE = 'IDLE'
}

export type MatchResult =
  | { status: MatchResultStatus.PERFECT_MATCH; matchedOrders: Order[] }
  | { status: MatchResultStatus.FUZZY_MATCH; matchedOrders: Order[]; amount: number }
  | { status: MatchResultStatus.UNRECOGNIZED; amount: number }
  | { status: MatchResultStatus.AMBIGUOUS; combinationsCount: number; amount: number }
  | { status: MatchResultStatus.IDLE }

export class SubsetSumMatcherService {
  /**
   * Decides which pending orders, if any, the money that arrived pays for.
   *
   * `totalDelta` is `currentBalance - baseline`, and the baseline only advances
   * when money is accounted for — by a match here, or by the trader resolving an
   * alert. So an *unresolved* deposit is still inside `totalDelta` by
   * construction, and there is nothing to add to it.
   *
   * This used to also try `totalDelta + <sum of unresolved alerts>`, meaning to
   * let a later deposit combine with an earlier unmatched one. That double-counts:
   * a 5000 deposit that raised a 5000 alert was re-evaluated as 10000, which fell
   * within the fuzzy tolerance of a 9600 order and executed it. Two deposits
   * genuinely combining need no help — the second one simply makes `totalDelta`
   * their sum, because the baseline never moved.
   */
  static evaluateDelta(pendingOrders: Order[], totalDelta: number): MatchResult {
    if (totalDelta === 0) return { status: MatchResultStatus.IDLE }

    const exactMatches = this.findSubsetSum(pendingOrders, totalDelta)
    if (exactMatches.length === 1) {
      return { status: MatchResultStatus.PERFECT_MATCH, matchedOrders: exactMatches[0] }
    }
    if (exactMatches.length > 1) {
      return {
        status: MatchResultStatus.AMBIGUOUS,
        combinationsCount: exactMatches.length,
        amount: totalDelta
      }
    }

    if (isEnabledFlag(environments.FUZZY_MATCHING_ENABLED)) {
      const fuzzyMatches = this.findSubsetSumFuzzy(pendingOrders, totalDelta)
      if (fuzzyMatches.length === 1) {
        return {
          status: MatchResultStatus.FUZZY_MATCH,
          matchedOrders: fuzzyMatches[0],
          amount: totalDelta
        }
      }
    }

    return { status: MatchResultStatus.UNRECOGNIZED, amount: totalDelta }
  }

  private static findSubsetSum(orders: Order[], targetDelta: number): Order[][] {
    const results: Order[][] = []

    const dfs = (index: number, currentSum: number, currentSubset: Order[]) => {
      if (currentSum === targetDelta) {
        results.push([...currentSubset])
        return
      }
      if (currentSum > targetDelta || index === orders.length) {
        return
      }

      dfs(index + 1, currentSum + orders[index].amount, [...currentSubset, orders[index]])
      dfs(index + 1, currentSum, currentSubset)
    }

    dfs(0, 0, [])
    return results
  }

  /**
   * Fuzzy matching: matches orders if their sum is within TOLERANCE of the delta.
   * Handles both overpayment (client paid more) and underpayment (e.g., terminal fees deducted).
   */
  private static findSubsetSumFuzzy(orders: Order[], targetDelta: number): Order[][] {
    const results: Order[][] = []
    const TOLERANCE = parseFloat(environments.FUZZY_MATCHING_TOLERANCE_UAH || '0') * 100

    const dfs = (index: number, currentSum: number, currentSubset: Order[]) => {
      if (Math.abs(currentSum - targetDelta) <= TOLERANCE) {
        if (currentSubset.length > 0) {
          results.push([...currentSubset])
        }
      }
      if (currentSum > targetDelta + TOLERANCE || index === orders.length) {
        return
      }

      dfs(index + 1, currentSum + orders[index].amount, [...currentSubset, orders[index]])
      dfs(index + 1, currentSum, currentSubset)
    }

    dfs(0, 0, [])

    // If multiple fuzzy matches exist, prefer the one with the smallest difference (sum closest to targetDelta)
    if (results.length > 1) {
      let bestDiff = Infinity
      let bestResult: Order[] | null = null
      for (const res of results) {
        const sum = res.reduce((acc, val) => acc + val.amount, 0)
        const diff = Math.abs(targetDelta - sum)
        if (diff < bestDiff) {
          bestDiff = diff
          bestResult = res
        }
      }
      return bestResult ? [bestResult] : []
    }

    return results
  }
}
