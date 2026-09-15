import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common'
import { TelegramWebhookGuard } from './telegram-webhook.guard'

const SECRET = 'a-very-long-shared-secret'

const context = (headers: Record<string, unknown>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as never

const guardWith = (webhookSecret: string) =>
  new TelegramWebhookGuard({ webhookSecret } as never)

describe('TelegramWebhookGuard', () => {
  it('admits a delivery carrying the configured secret', () => {
    expect(
      guardWith(SECRET).canActivate(context({ 'x-telegram-bot-api-secret-token': SECRET }))
    ).toBe(true)
  })

  it('rejects a wrong secret', () => {
    expect(() =>
      guardWith(SECRET).canActivate(context({ 'x-telegram-bot-api-secret-token': 'nope' }))
    ).toThrow(UnauthorizedException)
  })

  /**
   * The path is guessable and the body is relayed verbatim to a real customer,
   * so an unauthenticated POST is an impersonation of the support team.
   */
  it('rejects a delivery with no secret header at all', () => {
    expect(() => guardWith(SECRET).canActivate(context({}))).toThrow(UnauthorizedException)
  })

  /** Fails closed: no secret configured means nothing can be trusted, not that anything can. */
  it('refuses every delivery when no secret is configured', () => {
    expect(() =>
      guardWith('').canActivate(context({ 'x-telegram-bot-api-secret-token': SECRET }))
    ).toThrow(InternalServerErrorException)
  })
})
