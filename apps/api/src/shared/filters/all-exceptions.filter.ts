import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core'
import type { Request } from 'express'

/** At or above this, the stack is worth carrying; below it, it is noise. */
const STACK_FROM = HttpStatus.INTERNAL_SERVER_ERROR

/**
 * Logs every failed request, then hands it to Nest's own filter unchanged.
 *
 * **There was no exception filter at all before this.** Nest's built-in one
 * answers the caller and writes nothing, so a request rejected before it reached
 * a handler left no trace whatsoever — and requests are rejected before their
 * handler routinely, by the global `ValidationPipe`.
 *
 * That is not a theoretical gap. An inbound Transacto webhook passed its
 * signature guard, was rejected by the global pipe for carrying a property our
 * DTO did not declare, and returned 400 in silence. From the logs the backend
 * looked like it was ignoring webhooks outright, and it took two rounds of
 * investigation to find, because the one line that would have named the problem
 * did not exist.
 *
 * It extends `BaseExceptionFilter` and delegates rather than writing its own
 * response: the status codes and bodies clients already depend on stay
 * byte-for-byte what they were, and this only adds the log line.
 *
 * **Method, path and status only — never headers, never the body.** Headers
 * carry `X-API-TOKEN` and bodies carry card numbers, and logging a caught object
 * wholesale is how both have leaked here before.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('HttpException')

  constructor(private readonly adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter)
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    // Gateways have their own error path and no request to describe.
    if (host.getType() === 'http') this.report(exception, host)

    super.catch(exception, host)
  }

  private report(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    const where = `${request?.method} ${request?.originalUrl ?? request?.url}`
    const because = this.reason(exception)
    const line = `${status} ${where}: ${because}`

    if (status >= STACK_FROM) {
      this.logger.error(line, exception instanceof Error ? exception.stack : undefined)
      return
    }

    // A 4xx is the caller's mistake, not an incident — logged, not alarmed on.
    this.logger.warn(line)
  }

  /**
   * A short reason, built from named fields.
   *
   * A `ValidationPipe` rejection puts its `message` array here, which is the
   * whole point: "property surprise_field should not exist" is the sentence that
   * was missing. `ERROR` bodies land as `{ code, message }` and read the same
   * way.
   */
  private reason(exception: unknown): string {
    if (exception instanceof HttpException) {
      const body = exception.getResponse()

      if (typeof body === 'string') return body

      const message = (body as { message?: unknown })?.message
      if (Array.isArray(message)) return message.join('; ')
      if (typeof message === 'string') return message

      return exception.message
    }

    return exception instanceof Error ? exception.message : String(exception)
  }
}
