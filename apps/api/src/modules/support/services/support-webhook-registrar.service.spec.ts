import { Logger } from '@nestjs/common'
import { SupportWebhookRegistrarService } from './support-webhook-registrar.service'
import { TelegramUpdateType } from 'src/shared/interfaces'
import type { SupportConfigService } from './support-config.service'
import type { TelegramBotApiService } from './telegram-bot.api.service'
import type { TelegramWebhookInfo } from 'src/shared/interfaces'

const URL = 'https://openfunds.top/api/support/telegram/webhook'

const info = (overrides: Partial<TelegramWebhookInfo> = {}): TelegramWebhookInfo => ({
  url: URL,
  has_custom_certificate: false,
  pending_update_count: 0,
  allowed_updates: [TelegramUpdateType.MESSAGE, TelegramUpdateType.CALLBACK_QUERY],
  ...overrides
})

/**
 * The audit, which exists because the failure it names is silent at both ends.
 *
 * `allowed_updates` is stored on Telegram's side and is whatever the last
 * `setWebhook` said. A bot registered before this deployment asked for
 * `callback_query` drops every inline key press before sending it — no log
 * line here, nothing in the chat, and a person concluding the button is broken.
 */
describe('SupportWebhookRegistrarService', () => {
  let getWebhookInfo: jest.Mock
  let setWebhook: jest.Mock
  let errors: string[]

  const run = async (config: Partial<SupportConfigService>): Promise<void> => {
    const service = new SupportWebhookRegistrarService(
      {
        isEnabled: true,
        webhookUrl: URL,
        webhookSecret: 'secret',
        ...config
      } as SupportConfigService,
      {
        getMe: jest.fn().mockResolvedValue({ id: 1, username: 'transacto_support_bot' }),
        setWebhook,
        getWebhookInfo
      } as unknown as TelegramBotApiService
    )

    await service.onModuleInit()
  }

  beforeEach(() => {
    errors = []
    setWebhook = jest.fn().mockResolvedValue(true)
    getWebhookInfo = jest.fn().mockResolvedValue(info())

    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message))
    })
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('asks for callback queries as well as messages', async () => {
    await run({})

    expect(setWebhook.mock.calls[0][0].allowed_updates).toEqual([
      TelegramUpdateType.MESSAGE,
      TelegramUpdateType.CALLBACK_QUERY
    ])
  })

  it('says nothing when the live webhook is the one this deployment wants', async () => {
    await run({})

    expect(errors).toEqual([])
  })

  it('reports a webhook that will not deliver key presses', async () => {
    getWebhookInfo.mockResolvedValue(info({ allowed_updates: [TelegramUpdateType.MESSAGE] }))

    await run({})

    expect(errors.join('\n')).toContain(TelegramUpdateType.CALLBACK_QUERY)
  })

  /**
   * **Absent is not empty.** Telegram omits the field when its own default is
   * in force, and that default is *wider* than this list — reading it as "no
   * update types allowed" would make every correctly configured bot look broken.
   */
  it('treats an absent allowed_updates as the wider default, not as nothing', async () => {
    getWebhookInfo.mockResolvedValue(info({ allowed_updates: undefined }))

    await run({})

    expect(errors).toEqual([])
  })

  it('reports a bot pointed at somebody else', async () => {
    getWebhookInfo.mockResolvedValue(info({ url: 'https://someone-else.example/webhook' }))

    await run({})

    expect(errors.join('\n')).toContain('someone-else.example')
  })

  it('reports a bot with no webhook at all', async () => {
    getWebhookInfo.mockResolvedValue(info({ url: '' }))

    await run({})

    expect(errors.join('\n')).toContain('NO webhook')
  })

  /**
   * The case the audit exists for. A deployment that registers nothing is
   * trusting a webhook somebody set up by hand — which is exactly the
   * arrangement in which an inline key quietly does nothing for weeks.
   */
  it('audits even when it is not the deployment that registers the webhook', async () => {
    getWebhookInfo.mockResolvedValue(info({ allowed_updates: [TelegramUpdateType.MESSAGE] }))

    await run({ webhookUrl: '' })

    expect(setWebhook).not.toHaveBeenCalled()
    expect(errors.join('\n')).toContain(TelegramUpdateType.CALLBACK_QUERY)
  })

  it('does nothing at all when support is not configured here', async () => {
    await run({ isEnabled: false })

    expect(setWebhook).not.toHaveBeenCalled()
    expect(getWebhookInfo).not.toHaveBeenCalled()
  })

  /** Telegram being unreachable for a second must not fail the boot. */
  it('survives the read-back failing', async () => {
    getWebhookInfo.mockRejectedValue(new Error('timeout'))

    await expect(run({})).resolves.toBeUndefined()
  })
})
