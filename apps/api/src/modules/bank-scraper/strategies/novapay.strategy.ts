import { ERROR } from '@transacto/contracts'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { BankProvider } from 'src/shared/constants'
import type { NovaPayCaseData, UnifiedBankBalance } from 'src/shared/interfaces'
import { adaptNovaPayBalance, ensure, errorCodeOf } from 'src/shared/utils'
import { BankScraperApiService } from 'src/modules/bank-scraper/services/bank-scraper.api.service'
import type { ScraperStrategy } from 'src/modules/bank-scraper/interfaces'

@Injectable()
export class NovaPayScraperStrategy implements ScraperStrategy {
  readonly provider = BankProvider.NOVAPAY
  private readonly logger = new Logger(NovaPayScraperStrategy.name)

  constructor(private readonly apiService: BankScraperApiService) {}

  async scrapeBalance(terminal: Terminal): Promise<UnifiedBankBalance> {
    const cred3 = ensure(terminal.cred3, new BadRequestException(ERROR.TERMINAL.MISSING_CRED))

    const publicId = ensure(
      this.extractPublicId(cred3),
      new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)
    )

    const caseData = await this.apiService.fetchNovaPayCase(publicId)

    try {
      return adaptNovaPayBalance(caseData)
    } catch (error) {
      this.logRefusedFigures(publicId, caseData, error)
      throw error
    }
  }

  /**
   * Says out loud what the page actually carried when its money would not parse.
   *
   * The only bank here whose contract is HTML, so the only one whose figures can
   * change shape without anyone being told. `INVALID_BALANCE_FORMAT` is the
   * parser refusing rather than guessing — and without the string it refused,
   * the next person sees a retry loop and no way to know what NovaPay sent.
   *
   * These are amounts, not credentials: the case's IBAN, its recipient's
   * taxpayer number and the card in its sharing sentence are all in the same
   * object and none of them appears here.
   */
  private logRefusedFigures(publicId: string, data: NovaPayCaseData, error: unknown): void {
    if (errorCodeOf(error) !== ERROR.SCRAPER.INVALID_BALANCE_FORMAT.code) return

    this.logger.error(
      `NovaPay case ${publicId} answered a balance this parser will not read: ` +
        `balance=${JSON.stringify(data.balance)} amount=${JSON.stringify(data.amount)}. ` +
        `Refusing rather than reporting a figure — a misread balance reads as a withdrawal.`
    )
  }

  /**
   * The last path segment of `/case/<publicId>`.
   *
   * Read off the path rather than a query parameter — a NovaPay share link
   * carries none — and taken as the last segment so a trailing slash or a
   * tracking suffix on the way in does not change what is asked for.
   */
  private extractPublicId(url: string): string | null {
    try {
      return new URL(url).pathname.split('/').filter(Boolean).pop() ?? null
    } catch {
      return null
    }
  }
}
