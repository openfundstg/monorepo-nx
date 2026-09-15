import { ExtensionModule } from './extension.module'
import { ExtensionDashboardService } from './services/extension-dashboard.service'
import { ExtensionTerminalSearchService } from './services/extension-terminal-search.service'
import { bootModuleGraph } from 'src/shared/testing/module-wiring'

/**
 * Boots the extension's graph for real.
 *
 * Everything the trader's dashboard is served from hangs off this module, and
 * the services in it are wide — the search service alone takes four
 * collaborators from three different modules. A constructor argument added
 * without its module reaching `imports` type-checks and passes every other test
 * here, then throws `UnknownDependenciesException` on the first boot.
 *
 * See {@link bootModuleGraph} for why the mocker refuses to invent our own
 * providers rather than stubbing whatever it cannot resolve.
 */
describe('ExtensionModule wiring', () => {
  const bootGraph = () => bootModuleGraph(ExtensionModule)

  it('resolves the dashboard service and everything under it', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(ExtensionDashboardService)).toBeInstanceOf(ExtensionDashboardService)

    await moduleRef.close()
  })

  /** Reaches into terminal-db, order-db and bank-scraper in one constructor. */
  it('resolves the terminal search service', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(ExtensionTerminalSearchService)).toBeInstanceOf(
      ExtensionTerminalSearchService,
    )

    await moduleRef.close()
  })
})
