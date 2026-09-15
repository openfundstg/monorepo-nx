import { ERROR } from '@transacto/contracts'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
import type { BankProvider } from 'src/shared/constants'
import type { UnifiedBankBalance } from 'src/shared/interfaces'
import { ensure, getBankProvider } from 'src/shared/utils'
import { SCRAPER_STRATEGIES } from 'src/modules/bank-scraper/constants'
import type { ScraperStrategy } from 'src/modules/bank-scraper/interfaces'

/**
 * Picks the strategy for a terminal's bank and returns a normalised balance.
 *
 * The bank is derived from the terminal's `cred3` URL, and each strategy
 * declares which provider it serves — so supporting a new bank is a new class
 * in `SCRAPER_STRATEGIES`, with nothing here to edit.
 */
@Injectable()
export class BankScraperService {
  private readonly strategies: ReadonlyMap<BankProvider, ScraperStrategy>

  constructor(
    private readonly terminalDbService: TerminalDbService,
    @Inject(SCRAPER_STRATEGIES) strategies: readonly ScraperStrategy[]
  ) {
    this.strategies = new Map(strategies.map((strategy) => [strategy.provider, strategy]))
  }

  /**
   * Entry point for the BullMQ worker.
   *
   * @param terminalId Terminal to scrape.
   * @returns The current balance, in the same shape for every bank.
   */
  async scrape(terminalId: number): Promise<UnifiedBankBalance> {
    const terminal = ensure(
      await this.terminalDbService.findOne({ terminalId }),
      new NotFoundException(ERROR.TERMINAL.NOT_FOUND)
    )

    const cred3 = ensure(terminal.cred3, new BadRequestException(ERROR.TERMINAL.MISSING_CRED))

    const provider = getBankProvider(cred3)

    const strategy = ensure(
      provider ? this.strategies.get(provider) : null,
      new BadRequestException({
        ...ERROR.SCRAPER.UNSUPPORTED_BANK_URL,
        details: `terminal ${terminalId}`
      })
    )

    return strategy.scrapeBalance(terminal)
  }
}
