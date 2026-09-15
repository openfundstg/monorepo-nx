import { ERROR } from '@transacto/contracts'
import { BadRequestException, Injectable } from '@nestjs/common'
import { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { BankProvider } from 'src/shared/constants'
import type { UnifiedBankBalance } from 'src/shared/interfaces'
import { adaptMonoBalance, ensure, extractTargetId } from 'src/shared/utils'
import { BankScraperApiService } from 'src/modules/bank-scraper/services/bank-scraper.api.service'
import type { ScraperStrategy } from 'src/modules/bank-scraper/interfaces'

@Injectable()
export class MonoScraperStrategy implements ScraperStrategy {
  readonly provider = BankProvider.MONO

  constructor(private readonly apiService: BankScraperApiService) {}

  async scrapeBalance(terminal: Terminal): Promise<UnifiedBankBalance> {
    const cred3 = ensure(terminal.cred3, new BadRequestException(ERROR.TERMINAL.MISSING_CRED))

    const jarId = ensure(
      extractTargetId(cred3),
      new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)
    )

    const raw = await this.apiService.fetchMonoJar(jarId)

    return ensure(
      adaptMonoBalance(raw),
      new BadRequestException(ERROR.SCRAPER.PROCESSING_FAILED)
    )
  }
}
