import {
  AdminDepositKind,
  type AdminDepositDetailRes,
  type AdminDepositRowItem,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { Body, Controller, Get, Param, ParseEnumPipe, Post, Query, Req } from '@nestjs/common'
import { UserTypeAdmin } from 'src/modules/auth'
import type { AdminAuthenticatedRequest } from 'src/shared/interfaces'
import { AdminDepositsPageQueryDto, AdminFiatDepositActionReqDto } from 'src/modules/admin/dto'
import { AdminDepositsService, AdminFiatDepositsService } from 'src/modules/admin/services'

/**
 * Money coming in, on both rails.
 *
 * **One controller because it is one book.** The two used to be
 * `/admin/deposits` and `/admin/fiat-deposits`, which made a screen per rail
 * inevitable — and a user who topped up with hryvnia last week and USDT today
 * appeared on neither screen as a person who had topped up twice.
 *
 * The single write here is the fiat intervention, and it keeps its own service:
 * both of its actions delegate to `FiatDepositSettlementService`, which is the
 * settlement path the reconciler and the Mini App use. Nothing about reading
 * the two rails as one changes that.
 */
@Controller('admin/deposits')
export class AdminDepositsController {
  constructor(
    private readonly depositsService: AdminDepositsService,
    private readonly fiatDepositsService: AdminFiatDepositsService
  ) {}

  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminDepositsPageQueryDto
  ): Promise<AdminPaginatedRes<AdminDepositRowItem>> {
    return this.depositsService.list(query)
  }

  /**
   * One deposit, with the payer and every document sent about it.
   *
   * **Keyed by kind and id.** The two rails are different collections minting
   * their own ids, and an id alone would be a lookup that is right almost
   * always — which is worse than one that is wrong plainly.
   */
  @Get(':kind/:id')
  @UserTypeAdmin()
  async detail(
    @Param('kind', new ParseEnumPipe(AdminDepositKind)) kind: AdminDepositKind,
    @Param('id') id: string
  ): Promise<AdminDepositDetailRes> {
    return this.depositsService.detail(kind, id)
  }

  /**
   * Credit a fiat top-up by hand, or give its payout back.
   *
   * One endpoint for both: they share their lookup, their audit shape and their
   * 409, and an operator picks between them in one dialog.
   *
   * The path names `FIAT` explicitly rather than accepting either kind. A
   * crypto deposit settles against a blockchain transaction and has no
   * equivalent intervention — the honest correction there is an audited balance
   * adjustment, and a route that accepted `CRYPTO` and then refused it would
   * imply otherwise.
   */
  @Post('FIAT/:id/action')
  @UserTypeAdmin()
  async act(
    @Param('id') id: string,
    @Body() body: AdminFiatDepositActionReqDto,
    @Req() request: AdminAuthenticatedRequest
  ): Promise<AdminDepositRowItem> {
    return this.fiatDepositsService.act(
      id,
      body,
      request.admin,
      request.ip ?? request.socket.remoteAddress ?? 'unknown'
    )
  }
}
