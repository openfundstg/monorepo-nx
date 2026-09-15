import { TelegramMiniAppModule } from './telegram-mini-app.module'
import { DropLinkResolverService } from './services/drop-link-resolver.service'
import { SaleFacadeService } from './services/sale-facade.service'
import { bootModuleGraph } from 'src/shared/testing/module-wiring'

/**
 * The graph that broke on boot once already: `DropLinkResolverService` gained a
 * `BankScraperApiService` argument and `BankScraperModule` never made it into
 * `imports`. See {@link bootModuleGraph} for why the mocker refuses to invent
 * our own providers.
 */
describe('TelegramMiniAppModule wiring', () => {
  const bootGraph = () => bootModuleGraph(TelegramMiniAppModule)

  it('resolves the PrivatBank envelope lookup the drop-link resolver needs', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(DropLinkResolverService)).toBeInstanceOf(DropLinkResolverService)

    await moduleRef.close()
  })

  /** The facade sits at the centre of the graph; if it resolves, most of it does. */
  it('resolves the sale facade and everything under it', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(SaleFacadeService)).toBeInstanceOf(SaleFacadeService)

    await moduleRef.close()
  })
})
