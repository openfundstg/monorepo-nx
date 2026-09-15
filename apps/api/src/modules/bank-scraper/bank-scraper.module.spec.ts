import { BankScraperModule } from './bank-scraper.module'
import { ScraperExecutionService } from './services/scraper-execution.service'
import { BalanceProcessorService } from './services/balance-processor.service'
import { TerminalErrorHandlerService } from './services/terminal-error-handler.service'
import { bootModuleGraph } from 'src/shared/testing/module-wiring'

/**
 * Boots the scraper graph for real.
 *
 * Nothing else here can. Every service under this module runs only from a
 * BullMQ job against a live bank, so a constructor argument added without its
 * module reaching `imports` type-checks, passes every unit test in this
 * directory — they inject hand-built mocks — and then throws
 * `UnknownDependenciesException` on the first boot in production. The symptom
 * is not a failing request: it is an API that will not start, which is the
 * worst place to find out.
 *
 * The occasion for writing it: `ScraperExecutionService` gained the two
 * routing services so a suspect balance drop could hold a terminal back from
 * new payers instead of tearing it down. Both come from `TerminalModule`, which
 * already exported them — but nothing in this repository would have said so if
 * it had not.
 */
describe('BankScraperModule wiring', () => {
  const bootGraph = () => bootModuleGraph(BankScraperModule)

  it('resolves the scrape entry point and everything under it', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(ScraperExecutionService)).toBeInstanceOf(ScraperExecutionService)
    expect(moduleRef.get(BalanceProcessorService)).toBeInstanceOf(BalanceProcessorService)

    await moduleRef.close()
  })

  it('resolves the handler that takes a terminal out of service', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(TerminalErrorHandlerService)).toBeInstanceOf(TerminalErrorHandlerService)

    await moduleRef.close()
  })
})
