import { plainToInstance } from 'class-transformer'
import { validateSync, type ValidationError } from 'class-validator'
import { OrderWebhookReqDto } from 'src/modules/webhook/dto/order-webhook.req.dto'

/** Either the validated delivery, or the property paths that failed. */
export interface WebhookParseResult {
  readonly payload?: OrderWebhookReqDto
  /** Dotted property paths, e.g. `order.status_id`. Names only — see below. */
  readonly failures: readonly string[]
}

/**
 * Every property that failed, as a dotted path, flattened out of the tree.
 *
 * **Names, never values.** `order.cred` is a card number, and class-validator's
 * default messages quote the value that failed — putting one straight into a log
 * line. This is the same rule the delivery log follows for the same reason.
 */
const failedPaths = (errors: readonly ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property
    const children = error.children ?? []

    return children.length ? failedPaths(children, path) : [path]
  })

/**
 * Validates an inbound Transacto delivery, tolerating fields we do not know.
 *
 * **This exists because the route cannot use a pipe for it.** The handler
 * carried `@UsePipes(new ValidationPipe({ forbidNonWhitelisted: false }))` and a
 * comment claiming it "overrides the global pipe for this route only". It does
 * not: NestJS runs global pipes *first*, then controller, then method, and all
 * of them run. The global pipe is registered with `forbidNonWhitelisted: true`,
 * so any property Transacto added that our DTO does not declare was rejected
 * with a 400 before the lenient pipe was ever consulted — and before the handler
 * was entered.
 *
 * With no exception filter registered at the time, that 400 was logged nowhere.
 * The visible symptom was a delivery that passed the signature guard and then
 * produced complete silence, which is indistinguishable from the backend
 * ignoring webhooks — and is exactly how it was reported, twice.
 *
 * So the body reaches the handler as `unknown`, which has no runtime metatype
 * and which `ValidationPipe` therefore skips, and validation happens here where
 * the leniency actually applies: **strict about the fields we act on, silent
 * about everything else.** A field Transacto adds tomorrow is stripped, not a
 * lost order event.
 */
export const parseOrderWebhook = (body: unknown): WebhookParseResult => {
  const payload = plainToInstance(OrderWebhookReqDto, body ?? {})

  const errors = validateSync(payload, {
    // Strips undeclared properties instead of refusing the delivery — the whole
    // point of doing this here rather than leaving it to the global pipe.
    whitelist: true,
    forbidNonWhitelisted: false,
    // A body that is not an object at all should fail on its declared fields
    // rather than on this, so the log names something useful.
    forbidUnknownValues: false
  })

  return errors.length ? { failures: failedPaths(errors) } : { payload, failures: [] }
}
