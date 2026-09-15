import { ERROR } from '@transacto/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards
} from '@nestjs/common'
import { Public, SkipCsrf } from 'src/modules/auth'
import { SUPPORT_WEBHOOK_PATH } from 'src/modules/support/constants/support.constants'
import { TelegramWebhookGuard } from 'src/modules/support/guards/telegram-webhook.guard'
import { SupportService } from 'src/modules/support/services/support.service'
import { parseTelegramUpdate } from 'src/modules/support/utils'

@Controller(SUPPORT_WEBHOOK_PATH)
export class SupportWebhookController {
  private readonly logger = new Logger(SupportWebhookController.name)

  constructor(private readonly supportService: SupportService) {}

  /**
   * `POST /api/support/telegram/webhook` — every update Telegram delivers.
   *
   * Not a user: Telegram is a server calling us, and it proves that with the
   * secret token `TelegramWebhookGuard` checks. `@Public()` as far as user-type
   * auth goes, `@SkipCsrf()` because a third party can never hold one of our
   * CSRF tokens — the same shape as the Transacto webhook next door.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @Public()
  @SkipCsrf()
  @UseGuards(TelegramWebhookGuard)
  //
  // **`unknown` is load-bearing — do not annotate this with a DTO.**
  //
  // The global `ValidationPipe` runs with `forbidNonWhitelisted: true`, and a
  // `Update` carries whichever of its thirty-odd members Telegram feels like
  // sending, inside a `Message` of ninety more. Any DTO narrow enough to
  // validate would reject real deliveries with a 400 — and a rejected delivery
  // is a customer's message that silently never arrived. `unknown` compiles to
  // the `Object` metatype, which the pipe skips, so the body arrives untouched
  // and `parseTelegramUpdate` validates it on terms that suit a third party.
  async handleUpdate(@Body() body: unknown): Promise<void> {
    const update = parseTelegramUpdate(body)

    if (!update) {
      this.logger.warn('Telegram webhook body carried no update_id')
      throw new BadRequestException(ERROR.SUPPORT.INVALID_UPDATE)
    }

    await this.supportService.handleUpdate(update)
  }
}
