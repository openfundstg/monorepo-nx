/**
 * One balance shape for every bank.
 *
 * Each `*.strategy.ts` adapts its bank's raw response into this before anything
 * downstream sees it, so `balance-processor` and friends never learn which bank
 * a terminal belongs to.
 */
export interface UnifiedBankBalance {
  /** Balance in kopecks */
  actualBalance: number

  /** Optional goal amount in kopecks (e.g. for jars/moneyboxes) */
  goal?: number

  /** Current status of the scraping target (e.g. 'ACTIVE') */
  status: string
}
