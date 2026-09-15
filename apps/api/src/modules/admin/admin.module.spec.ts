import { AdminModule } from 'src/modules/admin/admin.module'
import { AdminGateway } from 'src/modules/admin/gateways/admin.gateway'
import {
  AdminAuditService,
  AdminBroadcastService,
  AdminLoginService,
  AdminOverviewService,
  AdminSalesService,
  AdminSupportService,
  AdminTerminalsService,
  AdminTradersService,
  AdminUsersService
} from 'src/modules/admin/services'
import { bootModuleGraph } from 'src/shared/testing/module-wiring'

/**
 * Boots the admin graph for real.
 *
 * This module reaches across almost every collection in the system — eleven
 * repository modules plus two domain modules whose settlement paths it reuses —
 * so it has more ways to be wired wrong than anything else here. A constructor
 * argument added without its module reaching `imports` type-checks and passes
 * every other test, then throws `UnknownDependenciesException` on the first
 * boot; the panel would be dead on deploy with a green build behind it.
 *
 * See {@link bootModuleGraph} for why the mocker refuses to invent our own
 * providers rather than stubbing whatever it cannot resolve.
 */
describe('AdminModule wiring', () => {
  const bootGraph = () => bootModuleGraph(AdminModule)

  it('resolves the services that only read', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(AdminOverviewService)).toBeInstanceOf(AdminOverviewService)
    expect(moduleRef.get(AdminSupportService)).toBeInstanceOf(AdminSupportService)
    expect(moduleRef.get(AdminAuditService)).toBeInstanceOf(AdminAuditService)

    await moduleRef.close()
  })

  /**
   * The one that matters most: these three delegate to services owned by
   * `TelegramMiniAppModule` and `TerminalModule`, so they only resolve if those
   * modules actually export what is injected here.
   */
  it('resolves the services that write', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(AdminUsersService)).toBeInstanceOf(AdminUsersService)
    expect(moduleRef.get(AdminSalesService)).toBeInstanceOf(AdminSalesService)
    expect(moduleRef.get(AdminTerminalsService)).toBeInstanceOf(AdminTerminalsService)
    expect(moduleRef.get(AdminTradersService)).toBeInstanceOf(AdminTradersService)

    await moduleRef.close()
  })

  it('resolves the login service and the session it depends on', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(AdminLoginService)).toBeInstanceOf(AdminLoginService)

    await moduleRef.close()
  })

  /**
   * `AdminBroadcastService` is injected by nothing — it exists to be
   * constructed so its `@OnEvent` handlers register. A provider nobody asks for
   * is exactly the kind that gets dropped from the module in a later tidy-up,
   * and the only symptom would be a panel that silently stops updating.
   */
  it('constructs the broadcast listener even though nothing injects it', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(AdminBroadcastService)).toBeInstanceOf(AdminBroadcastService)

    await moduleRef.close()
  })

  it('resolves the gateway', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(AdminGateway)).toBeInstanceOf(AdminGateway)

    await moduleRef.close()
  })
})
