import { Injectable } from '@nestjs/common'
import { SupportLocale } from 'src/shared/constants'
import type { TelegramUser } from 'src/shared/interfaces'
import { SupportBotUserDbService } from 'src/modules/repositories/support-db/services'
import { resolveSupportLocale } from 'src/modules/support/constants/support-bot-text.constants'
import { profileOf } from 'src/modules/support/utils'

/**
 * Who is on the other end, and in what language to answer them.
 *
 * Split out from the menu and the relay because both need the answer and
 * neither should be the place that decides it — the language behind a message
 * is a property of the person, not of what they happened to press.
 */
@Injectable()
export class SupportUserService {
  constructor(private readonly botUserDbService: SupportBotUserDbService) {}

  /**
   * Records the profile behind an update and returns the language to answer in.
   *
   * Runs on every inbound update, including one from somebody who will never
   * ask a question: the row has to exist before a language can be remembered
   * against it, and pressing *Balance* must not open a support thread to have
   * somewhere to write.
   */
  async remember(user: TelegramUser): Promise<SupportLocale> {
    const stored = await this.botUserDbService.upsertProfile(user.id, profileOf(user))

    return resolveSupportLocale(stored.preferredLocale, user.language_code)
  }

  /**
   * The language to write to somebody in when nothing has just arrived from
   * them.
   *
   * The bot sometimes speaks first — a sum a user asked about has appeared —
   * and there is no update to read a `language_code` off. The stored profile is
   * the only reading available, and a user with no row at all is one the bot has
   * never heard from, which {@link resolveSupportLocale} answers with its own
   * fallback rather than a guess.
   */
  async localeFor(telegramId: number): Promise<SupportLocale> {
    const stored = await this.botUserDbService.findByTelegramId(telegramId)

    return resolveSupportLocale(stored?.preferredLocale, stored?.languageCode)
  }

  async setLocale(telegramId: number, locale: SupportLocale): Promise<void> {
    await this.botUserDbService.setPreferredLocale(telegramId, locale)
  }
}
