import { SupportModule } from './support.module'
import { SupportAlertsListener } from './services/support-alerts.listener'
import { SupportService } from './services/support.service'
import { SupportRelayService } from './services/support-relay.service'
import { SupportWebhookRegistrarService } from './services/support-webhook-registrar.service'
import { bootModuleGraph } from 'src/shared/testing/module-wiring'

/**
 * Boots the support graph for real.
 *
 * Five services, a controller, a guard, an `HttpModule` registration and a
 * repository module — and every one of them is only exercised by a Telegram
 * delivery, which no other test in this repository can produce. A constructor
 * argument added without its module reaching `imports` type-checks and passes
 * every unit test here, then throws `UnknownDependenciesException` on the first
 * boot in production, where the symptom is a webhook that 500s and a customer
 * whose message vanishes.
 */
describe('SupportModule wiring', () => {
  const bootGraph = () => bootModuleGraph(SupportModule)

  it('resolves the update entry point and everything under it', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(SupportService)).toBeInstanceOf(SupportService)
    expect(moduleRef.get(SupportRelayService)).toBeInstanceOf(SupportRelayService)

    await moduleRef.close()
  })

  /**
   * The alerts listener is reached only by the event bus, so nothing injects
   * it and nothing else would notice a missing provider until the first stuck
   * top-up went unannounced — silently, because an unheard event is not an
   * error anywhere.
   */
  it('resolves the listener that announces stuck top-ups', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(SupportAlertsListener)).toBeInstanceOf(SupportAlertsListener)

    await moduleRef.close()
  })

  it('resolves the webhook registrar', async () => {
    const moduleRef = await bootGraph()

    expect(moduleRef.get(SupportWebhookRegistrarService)).toBeInstanceOf(
      SupportWebhookRegistrarService
    )

    await moduleRef.close()
  })
})
