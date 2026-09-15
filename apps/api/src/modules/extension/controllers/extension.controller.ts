import { Controller, Post, Get, Param, Headers, Req, Body, Query } from '@nestjs/common'
import { Public, UserTypeTrader } from 'src/modules/auth'
import { MoveToBoxDto, ForceMatchDto } from 'src/modules/extension/dto/alert-actions.dto'
import { SafeBoxListQueryDto } from 'src/modules/extension/dto/safe-box-list.dto'
import {
  TerminalSearch,
  TerminalSearchQueryDto
} from 'src/modules/extension/dto/terminal-search.dto'
import { BankScraperWorkerService } from 'src/modules/bank-scraper'
import { ExtensionAuthService } from '../services/extension-auth.service'
import { ExtensionDashboardService } from '../services/extension-dashboard.service'
import { ExtensionAlertsActionService } from '../services/extension-alerts-action.service'
import { ExtensionTerminalSearchService } from '../services/extension-terminal-search.service'
import { SafeBoxDbService } from 'src/modules/repositories/safe-box-db/services'
import type { AuthenticatedRequest } from 'src/shared/interfaces/authenticated-request.interface'

@Controller('extension')
export class ExtensionController {
  constructor(
    private readonly extensionAuthService: ExtensionAuthService,
    private readonly extensionDashboardService: ExtensionDashboardService,
    private readonly extensionAlertsActionService: ExtensionAlertsActionService,
    private readonly extensionTerminalSearchService: ExtensionTerminalSearchService,
    private readonly bankScraperWorkerService: BankScraperWorkerService,
    private readonly safeBoxDbService: SafeBoxDbService
  ) {}

  // Must stay public: this is the endpoint that *establishes* the trader. A
  // first-time token has no row in our DB yet — it is verified against Transacto
  // here and upserted — so authenticating it up front would reject every new user.
  @Post('auth')
  @Public()
  async authenticate(@Headers('x-api-token') apiToken: string) {
    return this.extensionAuthService.authenticate(apiToken)
  }

  @Get('dashboard')
  @UserTypeTrader()
  async getDashboard(@Req() request: AuthenticatedRequest) {
    return this.extensionDashboardService.getDashboard(request.trader.traderId)
  }

  /**
   * Finds a trader's terminals by name or id, disabled ones included.
   *
   * The dashboard returns live jars only, so a terminal that has been switched
   * off falls off the screen entirely and there is no route back to its history
   * or its last balance. That is what this is for, which is also why it does not
   * simply widen the dashboard: the trader wants a live list by default and an
   * archived one only when they go looking.
   */
  @Get('terminals/search')
  @UserTypeTrader()
  async searchTerminals(
    @Query() query: TerminalSearchQueryDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.extensionTerminalSearchService.search(
      request.trader.traderId,
      query.q,
      query.limit ?? TerminalSearch.DEFAULT_LIMIT
    )
  }

  @Get('dashboard/history/:cardId')
  @UserTypeTrader()
  async getTerminalHistory(
    @Param('cardId') cardIdStr: string,
    @Req() request: AuthenticatedRequest
  ) {
    return this.extensionDashboardService.getTerminalHistory(request.trader.traderId, cardIdStr)
  }

  @Get('alerts/:traderId')
  @UserTypeTrader()
  async getAlerts(@Param('traderId') traderIdStr: string) {
    return this.extensionDashboardService.getAlerts(parseInt(traderIdStr, 10))
  }

  @Post('alerts/:alertId/read')
  @UserTypeTrader()
  async readAlert(@Param('alertId') alertId: string, @Req() request: AuthenticatedRequest) {
    return this.extensionAlertsActionService.readAlert(request.trader.traderId, alertId)
  }

  @Post('alerts/:alertId/acknowledge')
  @UserTypeTrader()
  async acknowledgeAlert(@Param('alertId') alertId: string, @Req() request: AuthenticatedRequest) {
    return this.extensionAlertsActionService.acknowledgeAlert(
      request.trader.traderId,
      request.trader.apiToken,
      alertId
    )
  }

  @Post('trader/:traderId/deactivate')
  @UserTypeTrader()
  async deactivateTrader(@Param('traderId') traderIdStr: string) {
    return this.extensionAuthService.deactivateTrader(parseInt(traderIdStr, 10))
  }

  @Post('terminals/:terminalId/sync')
  @UserTypeTrader()
  async syncTerminal(@Param('terminalId') terminalIdStr: string, @Req() request: AuthenticatedRequest) {
    await this.bankScraperWorkerService.forceSyncTerminal(
      parseInt(terminalIdStr, 10),
      request.trader.traderId,
      request.trader.apiToken
    )
    return { success: true }
  }

  @Get('box/list')
  @UserTypeTrader()
  async getSafeBoxList(@Req() request: AuthenticatedRequest, @Query() query: SafeBoxListQueryDto) {
    return this.extensionDashboardService.getSafeBoxList(request.trader.traderId, query)
  }

  @Post('alerts/:alertId/box')
  @UserTypeTrader()
  async moveToBox(
    @Param('alertId') alertId: string,
    @Body() body: MoveToBoxDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.extensionAlertsActionService.moveToBox(request.trader.traderId, alertId, body)
  }

  @Post('alerts/:alertId/force-match')
  @UserTypeTrader()
  async forceMatch(
    @Param('alertId') alertId: string,
    @Body() body: ForceMatchDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.extensionAlertsActionService.forceMatch(
      request.trader.traderId,
      request.trader.apiToken,
      alertId,
      body
    )
  }

  @Post('alerts/:alertId/ignore')
  @UserTypeTrader()
  async ignoreAlert(@Param('alertId') alertId: string, @Req() request: AuthenticatedRequest) {
    return this.extensionAlertsActionService.ignoreAlert(request.trader.traderId, alertId)
  }
}
