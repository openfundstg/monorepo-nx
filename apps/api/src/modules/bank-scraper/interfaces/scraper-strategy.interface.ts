import type { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import type { UnifiedBankBalance } from 'src/shared/interfaces'
import type { BankProvider } from 'src/shared/constants'

/**
 * How one bank's balance is read.
 *
 * `BankScraperService` keys strategies by `provider`, so adding a bank means
 * adding a class and listing it in `SCRAPER_STRATEGIES` — never editing a
 * `switch` in the caller.
 */
export interface ScraperStrategy {
  /** Which bank this strategy handles, as derived from the terminal's cred3 URL. */
  readonly provider: BankProvider

  /** Reads the current balance, normalised across banks. */
  scrapeBalance(terminal: Terminal): Promise<UnifiedBankBalance>
}
