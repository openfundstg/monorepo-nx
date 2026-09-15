import { Test, type TestingModule } from '@nestjs/testing'
import type { Type } from '@nestjs/common'

/**
 * Providers that come from outside any feature module and cannot be part of one
 * module's own wiring mistake — either a connection to something outside the
 * process, or a global module registered once in `AppModule`.
 *
 * Named explicitly rather than matched loosely: the looser this list gets, the
 * more of the graph these tests stop checking, and a provider quietly falling
 * into it is how this sort of test rots into a tautology.
 */
const EXTERNAL_PROVIDERS: ReadonlySet<string> = new Set([
  // Mongoose's root connection; the models below hang off it.
  'DatabaseConnection',
  // `RedisModule` is @Global and lives in AppModule.
  'REDIS_CLIENT',
  // `EventEmitterModule.forRoot()` — likewise global, likewise AppModule's.
  'EventEmitter',
  'EventEmitter2',
  // `ScheduleModule.forRoot()`, for the crons.
  'SchedulerRegistry',
  // `ProxyModule` is @Global and lives in AppModule — one pool of outbound
  // addresses for the process, shared by the bank scraper and the panel.
  'ProxyManagerService',
  // `ScraperWorkerModule` is @Global and lives in AppModule — the one client for
  // the Isolated Scraper Worker, the Tor-only egress for bank requests.
  'ScraperWorkerService',
  'ScraperWorkerApiService'
])

const isExternal = (token: unknown): boolean => {
  const name = typeof token === 'string' ? token : (token as { name?: string })?.name

  if (typeof name !== 'string') return false

  // One Mongoose model per collection, and one BullMQ queue per worker — both
  // are `forFeature` registrations standing in for infrastructure.
  return EXTERNAL_PROVIDERS.has(name) || name.endsWith('Model') || name.startsWith('BullQueue_')
}

/**
 * Boots a feature module's dependency graph for real.
 *
 * Almost nothing else in this codebase does. Services are constructed with
 * `new` and hand-made collaborators, so a provider that is *injected but never
 * registered* type-checks, builds, and passes lint and all four project test
 * suites — then throws `UnknownDependenciesException` on the first real boot.
 *
 * That is exactly how `BankScraperApiService` shipped unregistered: a service
 * gained a constructor argument, the `import` statement for its module landed,
 * and the entry in `imports: []` did not. Nothing in the gate could see it.
 *
 * **`useMocker` deliberately refuses to invent our own providers.** Handing back
 * a stub for anything unresolvable is the usual way to write this, and it would
 * paper over the very bug — an unregistered service would simply be mocked into
 * existence. Only infrastructure is stubbed; a missing provider of ours fails
 * loudly, by name.
 */
export const bootModuleGraph = (
  moduleClass: Type<unknown>,
  moduleName = moduleClass.name
): Promise<TestingModule> =>
  Test.createTestingModule({ imports: [moduleClass] })
    .useMocker((token) => {
      // `MongooseModule.forFeature` reaches into the connection to build each
      // model, so this one needs a shape rather than an empty object.
      if (token === 'DatabaseConnection') return { model: () => ({}), models: {} }
      if (isExternal(token)) return {}

      const name =
        typeof token === 'string' ? token : ((token as { name?: string })?.name ?? String(token))

      throw new Error(
        `${name} is injected somewhere in ${moduleName} but is not registered in it. ` +
          `Add its module to imports, or the provider to providers.`
      )
    })
    .compile()
