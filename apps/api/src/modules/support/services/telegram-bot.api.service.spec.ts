import { HttpException } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { TelegramBotApiService } from './telegram-bot.api.service'
import { TelegramFailure, telegramFailureOf } from 'src/shared/utils'

const TOKEN = '8863736788:AAFvcmYrcl13b7Ww0lBmRpj2uFUZw0kgfbk'

/** An axios failure, complete with the credential-bearing config axios attaches. */
const axiosFailure = (description: string) =>
  Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    config: { url: `/bot${TOKEN}/createForumTopic`, method: 'post' },
    response: {
      status: 400,
      data: { ok: false, error_code: 400, description }
    }
  })

describe('TelegramBotApiService', () => {
  let post: jest.Mock
  let service: TelegramBotApiService

  beforeEach(() => {
    post = jest.fn()
    service = new TelegramBotApiService({ post } as never)
  })

  it('unwraps the envelope on success', async () => {
    post.mockReturnValue(of({ data: { ok: true, result: { message_thread_id: 42 } } }))

    await expect(service.createForumTopic({ chat_id: 1, name: 'x' })).resolves.toEqual({
      message_thread_id: 42
    })
  })

  /**
   * The leak this closes: an `AxiosError` carries `config.url`, which for this
   * API is `/bot<token>/<method>`. Nest's unknown-exception handler and BullMQ's
   * job logger both print the object rather than its message, and one of them
   * wrote a live bot token into a container log.
   */
  it('never lets the credential-bearing axios error escape', async () => {
    post.mockReturnValue(throwError(() => axiosFailure('Bad Request: the chat is not a forum')))

    const thrown = await service
      .createForumTopic({ chat_id: 1, name: 'x' })
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(HttpException)
    expect(JSON.stringify(thrown)).not.toContain(TOKEN)
    expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain(TOKEN)
  })

  /** Sanitising must not cost the classification every recovery path reads. */
  it.each([
    ['Bad Request: the chat is not a forum', TelegramFailure.NOT_A_FORUM],
    ['Bad Request: message thread not found', TelegramFailure.THREAD_NOT_FOUND],
    ['Forbidden: bot was blocked by the user', TelegramFailure.BLOCKED_BY_USER]
  ])('carries the verdict for %s through the sanitised error', async (description, expected) => {
    post.mockReturnValue(throwError(() => axiosFailure(description)))

    const thrown = await service.sendMessage({ chat_id: 1, text: 'x' }).catch((e: unknown) => e)

    expect(telegramFailureOf(thrown)).toBe(expected)
  })

  /** A 200 with `ok: false` is Telegram's other failure mode, and it must throw. */
  it('refuses an envelope that says ok: false', async () => {
    post.mockReturnValue(of({ data: { ok: false, description: 'nope' } }))

    await expect(service.sendMessage({ chat_id: 1, text: 'x' })).rejects.toBeInstanceOf(
      HttpException
    )
  })
})
