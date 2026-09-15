import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { runMigrationCli } from 'src/migrations/migration-cli'
import environments from 'src/environments'

// The global ValidationPipe is registered via APP_PIPE in AppModule, not here —
// main.ts has no DI container. It used to be imported in this file without being
// used, which read as "validation is not configured".

/**
 * The same bundle, run as a tool instead of as a server.
 *
 * One artefact rather than a second entry point, because of where this has to
 * work: the runtime image carries `main.js`, its production dependencies and
 * nothing else — no sources, no TypeScript, no Nx. Whatever runs a migration on
 * the server has to already be inside that file.
 *
 *   docker compose run --rm api node main.js migrate up
 */
async function runCli(argv: readonly string[]): Promise<void> {
  process.exitCode = await runMigrationCli(argv.slice(1))
}

async function bootstrap() {
  if (process.argv[2] === 'migrate') return runCli(process.argv.slice(2))

  const app = await NestFactory.create(AppModule, { rawBody: true })
  const logger = new Logger('Bootstrap')

  app.enableCors({
    // Any origin, because the callers are a Chrome extension (whose origin is
    // an install-specific `chrome-extension://…`) and a Telegram WebView.
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    // `credentials` is deliberately left off, and that omission is now
    // load-bearing rather than incidental. The admin panel authenticates with a
    // cookie, so reflecting arbitrary origins *with* credentials would let any
    // website read an operator's data using their own logged-in browser. Both
    // the panel and the Mini App are served from this origin in production and
    // proxied to it in development, so neither ever needs a cross-origin
    // credentialed request — and the extension authenticates by header, which
    // is unaffected.
    //
    // Cross-site *writes* are covered separately: `CsrfGuard` enforces the
    // double-submit token wherever the `csrf-token` cookie is sent.
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'x-api-token',
      'x-tma-init-data',
      'x-csrf-token'
    ]
  })

  app.setGlobalPrefix('api')

  // Without this, `SIGTERM` — which is what a `docker compose restart` or a
  // redeploy sends — kills the process with no lifecycle hooks run at all.
  // `BankScraperWorkerService` uses one to hand back the Redis leases on the
  // polling loops it is about to stop running; a process that dies still
  // holding them leaves the next one's watchdog believing those loops are alive
  // for as long as the leases take to expire, which is why the scraper used to
  // sit idle for a minute or two after every restart.
  app.enableShutdownHooks()

  const port = environments.PORT ?? 8000
  await app.listen(port)
  logger.log(`Application listening on port ${port}`)
}
void bootstrap()
