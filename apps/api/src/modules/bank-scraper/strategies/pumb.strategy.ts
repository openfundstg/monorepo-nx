import { ERROR } from '@transacto/contracts'
import { BadRequestException, Injectable } from '@nestjs/common'
import { Terminal } from 'src/modules/repositories/terminal-db/schemas'
import { BankProvider } from 'src/shared/constants'
import type { UnifiedBankBalance } from 'src/shared/interfaces'
import { adaptPumbBalance, ensure } from 'src/shared/utils'
import { BankScraperApiService } from 'src/modules/bank-scraper/services/bank-scraper.api.service'
import type { ScraperStrategy } from 'src/modules/bank-scraper/interfaces'

@Injectable()
export class PumbScraperStrategy implements ScraperStrategy {
  readonly provider = BankProvider.PUMB

  constructor(private readonly apiService: BankScraperApiService) {}

  async scrapeBalance(terminal: Terminal): Promise<UnifiedBankBalance> {
    const cred3 = ensure(terminal.cred3, new BadRequestException(ERROR.TERMINAL.MISSING_CRED))

    const boxId = ensure(
      this.extractBoxId(cred3),
      new BadRequestException(ERROR.TERMINAL.INVALID_CRED_URL)
    )

    return adaptPumbBalance(await this.apiService.fetchPumbBox(boxId))
  }

  private extractBoxId(url: string): string | null {
    try {
      return new URL(url).searchParams.get('box_id')
    } catch {
      return null
    }
  }
}
