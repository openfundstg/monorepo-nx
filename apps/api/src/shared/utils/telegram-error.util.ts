import { HttpException } from '@nestjs/common'
import { isAxiosError } from 'axios'
import type { TelegramApiResponse } from 'src/shared/interfaces'

/**
 * What went wrong on a Bot API call, reduced to the cases a caller acts on.
 *
 * Telegram has no stable machine-readable reason: `error_code` mirrors the HTTP
 * status, so a deleted topic, a name that is too long and a malformed parameter
 * are all `400`, and the only thing telling them apart is the English sentence
 * in `description`. Matching on that sentence is exactly as fragile as it
 * sounds, which is why every branch here degrades to {@link UNKNOWN} rather
 * than to a wrong guess — and why {@link UNKNOWN} always ends in a rethrow.
 */
export enum TelegramFailure {
  /** 403 — the user pressed Stop. Nothing can be delivered until they restart the bot. */
  BLOCKED_BY_USER = 'BLOCKED_BY_USER',
  /** 403 — the account is gone. Permanent. */
  USER_DEACTIVATED = 'USER_DEACTIVATED',
  /**
   * 403/400 — this person has never started the bot, so it may not write first.
   *
   * Telegram's own rule, and not a fault: a Mini App can be opened from a link
   * without the chat ever existing. On 2026-09-10, 8 of 37 Mini App users were
   * in exactly this state. It is separated from {@link BLOCKED_BY_USER} because
   * the two are opposite states of the same person — one pressed Stop, the
   * other has not pressed Start — even though a caller that only wants to know
   * "can I reach them" treats them alike.
   *
   * `chat not found` is the same condition seen through a `sendMessage` to an
   * id the bot has no chat with, and arrives as a 400 rather than a 403.
   */
  CANNOT_INITIATE = 'CANNOT_INITIATE',
  /** 400 — the topic no longer exists; somebody deleted it in the group. */
  THREAD_NOT_FOUND = 'THREAD_NOT_FOUND',
  /** 400 — the topic is closed and this sender may not post into it. */
  TOPIC_CLOSED = 'TOPIC_CLOSED',
  /**
   * 400 — the chat has no Topics. Every `createForumTopic` fails until somebody
   * turns them on, so this one is a misconfiguration rather than a mishap.
   */
  NOT_A_FORUM = 'NOT_A_FORUM',
  /** 400 — the source chat forbids forwarding, so the message must be copied instead. */
  FORWARD_RESTRICTED = 'FORWARD_RESTRICTED',
  /** 429 — too many calls; `retry_after` says for how long. */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Anything else, including a network failure with no response at all. */
  UNKNOWN = 'UNKNOWN'
}

/** The failure body, when the call reached Telegram at all. */
const bodyOf = (error: unknown): TelegramApiResponse<never> | undefined =>
  isAxiosError<TelegramApiResponse<never>>(error) ? error.response?.data : undefined

/**
 * Substrings, deliberately lowercase and deliberately partial.
 *
 * Telegram varies the surrounding wording between methods — "message thread not
 * found" and "message to forward not found" are the same absent topic — so
 * these match the stable middle of the sentence, not the whole of it.
 */
const DESCRIPTION_MATCHES: readonly (readonly [string, TelegramFailure])[] = [
  ['bot was blocked by the user', TelegramFailure.BLOCKED_BY_USER],
  ['user is deactivated', TelegramFailure.USER_DEACTIVATED],
  ["bot can't initiate conversation", TelegramFailure.CANNOT_INITIATE],
  ['bot can not initiate conversation', TelegramFailure.CANNOT_INITIATE],
  ['chat not found', TelegramFailure.CANNOT_INITIATE],
  ['message thread not found', TelegramFailure.THREAD_NOT_FOUND],
  ['topic_deleted', TelegramFailure.THREAD_NOT_FOUND],
  ['topic_closed', TelegramFailure.TOPIC_CLOSED],
  ['the chat is not a forum', TelegramFailure.NOT_A_FORUM],
  ['topic is closed', TelegramFailure.TOPIC_CLOSED],
  ["message can't be forwarded", TelegramFailure.FORWARD_RESTRICTED],
  ['message can not be forwarded', TelegramFailure.FORWARD_RESTRICTED]
]

/**
 * The verdict a sanitised failure carries with it.
 *
 * `TelegramBotApiService` classifies at the point of failure and then throws
 * something that holds the answer instead of the `AxiosError` it came from —
 * because that error's `config.url` is `/bot<token>/<method>`, and any logger
 * that prints the object rather than its message prints the bot's credentials.
 * That happened: Nest's own handler dumped a token into the container log.
 */
const carriedFailure = (error: unknown): TelegramFailure | undefined => {
  if (!(error instanceof HttpException)) return undefined

  const failure = (error.getResponse() as { failure?: unknown })?.failure

  return Object.values<unknown>(TelegramFailure).includes(failure)
    ? (failure as TelegramFailure)
    : undefined
}

/** Classifies a failed Bot API call. Never throws. */
export const telegramFailureOf = (error: unknown): TelegramFailure => {
  const carried = carriedFailure(error)
  if (carried) return carried

  const body = bodyOf(error)
  if (!body) return TelegramFailure.UNKNOWN

  if (body.error_code === 429) return TelegramFailure.RATE_LIMITED

  const description = body.description?.toLowerCase() ?? ''
  const match = DESCRIPTION_MATCHES.find(([needle]) => description.includes(needle))

  return match ? match[1] : TelegramFailure.UNKNOWN
}

/** Seconds Telegram asked us to wait, on a 429. */
export const telegramRetryAfter = (error: unknown): number | undefined =>
  bodyOf(error)?.parameters?.retry_after

/**
 * A Bot API failure, reduced to what an operator needs — and nothing else.
 *
 * `describeError` is not used here, and the difference matters: it prints
 * `error.config.url`, which for this API is `/bot<token>/sendMessage`. The bot
 * token is the whole of the bot's authentication, so the request path is a
 * credential and never reaches a log line. Only the method name, the status and
 * Telegram's own description do.
 */
export const describeTelegramFailure = (method: string, error: unknown): string => {
  // Already sanitised upstream: its `details` is this same sentence, built when
  // the call failed and the response was still to hand.
  if (error instanceof HttpException) {
    const details = (error.getResponse() as { details?: unknown })?.details

    return typeof details === 'string' ? details : `${method} → ${error.message}`
  }

  const body = bodyOf(error)

  if (body) return `${method} → ${body.error_code ?? '?'}: ${body.description ?? 'no description'}`

  if (isAxiosError(error)) return `${method} → no response (${error.code ?? 'no code'})`

  return `${method} → ${error instanceof Error ? error.message : String(error)}`
}
