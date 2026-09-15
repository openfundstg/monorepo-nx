import { ConsoleLogger, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MigrationCliModule } from './migration-cli.module'
import { MigrationRunnerService } from './services'
import { describeError } from 'src/shared/utils'

const USAGE = `Usage: node main.js migrate <command>

  status            what has run and what has not
  up                run everything pending, oldest first
  down [name]       reverse one — the last applied unless named
  unlock            release a lock left by a run that died`

/**
 * Nest's own boot commentary, which nobody reading a migration wants.
 *
 * Sixteen "dependencies initialized" lines above two lines of actual output is
 * how a useful tool becomes one people stop reading. Only the framework's
 * startup chatter is dropped — warnings and errors from anywhere, and every
 * line the runner itself writes, come through.
 */
class CliLogger extends ConsoleLogger {
  private static readonly FRAMEWORK_CONTEXTS = new Set([
    'InstanceLoader',
    'NestFactory',
    // Nest prints the whole error object here when a boot fails, which for an
    // unreachable database is a page of Mongo topology. The failure still
    // reaches the operator — as the one line below that says what went wrong.
    'ExceptionHandler'
  ])

  override log(message: unknown, ...rest: unknown[]): void {
    if (CliLogger.isFramework(rest)) return

    super.log(message as string, ...(rest as string[]))
  }

  override error(message: unknown, ...rest: unknown[]): void {
    if (CliLogger.isFramework(rest)) return

    super.error(message as string, ...(rest as string[]))
  }

  private static isFramework(rest: readonly unknown[]): boolean {
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined

    return context !== undefined && CliLogger.FRAMEWORK_CONTEXTS.has(context)
  }
}

/** What `main.ts` hands over to when the process is a migration run, not a server. */
export async function runMigrationCli(argv: readonly string[]): Promise<number> {
  const logger = new Logger('Migrate')
  const [command, argument] = argv

  if (command === undefined || command === 'help' || command === '--help') {
    logger.log(USAGE)
    return command === undefined ? 1 : 0
  }

  const app = await NestFactory.createApplicationContext(MigrationCliModule, {
    logger: new CliLogger()
  }).catch((error: unknown) => {
    // Wiring, mostly — a provider that cannot be resolved. An unreachable
    // database never reaches here: `@nestjs/mongoose` prints "Unable to connect
    // to the database" and ends the process itself, which is a fine answer and
    // not one this can improve on.
    logger.error(`Could not start: ${describeError(error)}`)
    return null
  })

  if (app === null) return 1

  const runner = app.get(MigrationRunnerService)

  try {
    switch (command) {
      case 'status':
        await printStatus(runner, logger)
        break
      case 'up':
        await runner.up()
        break
      case 'down':
        await runner.down(argument)
        break
      case 'unlock':
        await runner.releaseLock()
        logger.log('Lock released.')
        break
      default:
        logger.error(`Unknown command: ${command}\n${USAGE}`)
        return 1
    }

    return 0
  } catch (error: unknown) {
    logger.error(describeError(error))
    return 1
  } finally {
    // Closing matters here in a way it does not for a server: the process must
    // exit, and an open Mongo connection keeps the event loop alive forever.
    await app.close()
  }
}

async function printStatus(runner: MigrationRunnerService, logger: Logger): Promise<void> {
  const [rows, lock] = await Promise.all([runner.status(), runner.lockHolder()])

  if (lock !== null) logger.warn(`Locked by ${lock}`)

  for (const row of rows)
    logger.log(
      `${row.appliedAt === null ? '·' : '✓'} ${row.name}` +
        `${row.appliedAt === null ? ' (pending)' : ` — ${row.appliedAt.toISOString()}`}` +
        `${row.reversible ? '' : ' [no down]'}`
    )

  const pending = rows.filter(({ appliedAt }) => appliedAt === null).length
  logger.log(`${rows.length} migration(s), ${pending} pending.`)
}
