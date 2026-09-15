import { Controller, Get, Req } from '@nestjs/common'
import type { IncomeAnalyticsResponse } from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { IncomeAnalyticsService } from 'src/modules/telegram-mini-app/services/income-analytics.service'

/**
 * What the caller has earned here — and, kept separate, what they have merely
 * received.
 *
 * Strictly the caller's own: `telegramId` comes from the verified launch and
 * never from the request, so there is no id to tamper with. That is the whole
 * of the access control this needs, which is why it takes no parameters at all.
 */
@Controller('tma/analytics')
export class TmaIncomeAnalyticsController {
  constructor(private readonly incomeAnalytics: IncomeAnalyticsService) {}

  /** GET /api/tma/analytics/income */
  @Get('income')
  @UserTypeTMA()
  async getIncome(@Req() req: TmaAuthenticatedRequest): Promise<IncomeAnalyticsResponse> {
    return this.incomeAnalytics.forUser(req.tmaUser.id)
  }
}
