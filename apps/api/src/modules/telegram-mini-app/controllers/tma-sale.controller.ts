import { Body, Controller, Get, NotFoundException, Param, Post, Req } from '@nestjs/common'
import { ERROR } from '@transacto/contracts'
import type {
  CancelSaleRes,
  CreateSaleResponse,
  ResolveDropLinkRes,
  SaleConfigResponse,
  SaleProgress
} from '@transacto/contracts'
import { UserTypeTMA } from 'src/modules/auth'
import type { TmaAuthenticatedRequest } from 'src/shared/interfaces'
import { SaleFacadeService } from 'src/modules/telegram-mini-app/services/sale-facade.service'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { CreateSaleDto } from 'src/modules/telegram-mini-app/dto/create-sale.dto'
import { ResolveDropLinkReqDto } from 'src/modules/telegram-mini-app/dto/resolve-drop-link.req.dto'
import { DropLinkResolverService } from 'src/modules/telegram-mini-app/services/drop-link-resolver.service'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { toAwaitingJar } from 'src/modules/telegram-mini-app/utils'
import { getTrustLevel } from 'src/shared/constants'
import { parseMinOrderKopecks } from 'src/shared/utils'
import environments from 'src/environments'
import type { Types } from 'mongoose'

@Controller('tma/sales')
export class TmaSaleController {
  constructor(
    private readonly saleFacade: SaleFacadeService,
    private readonly saleProgress: SaleProgressService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly userDbService: TmaUserDbService,
    private readonly dropLinkResolver: DropLinkResolverService,
    private readonly saleCancel: SaleCancelService
  ) {}

  /**
   * GET /api/tma/sales/config
   * Returns profit rate, the user's trust level and their available balance.
   */
  @Get('config')
  @UserTypeTMA()
  async getConfig(@Req() req: TmaAuthenticatedRequest): Promise<SaleConfigResponse> {
    const tmaUser = req.tmaUser
    const [user, sellRate, openOrders, awaitingJar] = await Promise.all([
      this.userDbService.findByTelegramId(tmaUser.id),
      this.saleFacade.getSellRate(),
      // Rides along for the same reason the balance does: the create form has
      // to refuse a user who is out of slots before they fill in a link, a card
      // and an amount.
      this.saleDbService.countSlotsHeldByTelegramId(tmaUser.id),
      // And the half of that count the user can do something about. A slot held
      // by a finished sale whose jar is open is indistinguishable, in the count
      // alone, from one held by a sale that is running — so a form with only
      // the count tells a user with nothing running to finish what they are
      // running. This is what turns the refusal into an instruction.
      this.saleDbService.findAwaitingJarClosureByTelegramId(tmaUser.id)
    ])
    const trustLevel = getTrustLevel(user?.totalTurnover ?? 0)

    return {
      trustLevel: trustLevel.level,
      maxParallelOrders: trustLevel.maxParallelOrders,
      openOrders,
      slotsAwaitingJarClosure: awaitingJar.map(toAwaitingJar),
      sellRate,
      // Rides along because this handler already loads the user for the trust
      // level: the create form needs it to reject an over-balance amount, and
      // a second round trip to /user/profile would buy nothing.
      balance: user?.balance ?? 0,
      // The create form has to name this figure, not just respect it: the
      // remainder choice offers to return "anything under ₴300", and a client
      // quoting a threshold the server no longer uses would describe a product
      // that does not exist.
      minOrderKopecks: parseMinOrderKopecks(environments.TRANSACTO_MIN_ORDER_KOPECKS)
    }
  }

  /**
   * POST /api/tma/sales/resolve-link
   *
   * Turns the link a user pasted into the one the scraper can read, following
   * the bank's redirects server-side. The create form calls this as soon as the
   * field loses focus, so a PUMB short link is corrected — and a link pasted
   * under the wrong bank is caught — before the order is submitted rather than
   * after it has already failed.
   */
  @Post('resolve-link')
  @UserTypeTMA()
  async resolveDropLink(@Body() dto: ResolveDropLinkReqDto): Promise<ResolveDropLinkRes> {
    return this.dropLinkResolver.resolve(dto.bankType, dto.link)
  }

  /**
   * POST /api/tma/sales
   * Creates a new sale.
   */
  @Post()
  @UserTypeTMA()
  async createSale(
    @Req() req: TmaAuthenticatedRequest,
    @Body() dto: CreateSaleDto
  ): Promise<CreateSaleResponse> {
    const tmaUser = req.tmaUser
    const order = await this.saleFacade.createSale(
      tmaUser.id,
      dto.fiatAmount,
      dto.bankType,
      dto.dropLink,
      dto.cardNumber,
      dto.quotedRate,
      dto.remainderPolicy
    )

    return {
      saleId: order._id.toString(),
      publicId: order.publicId,
      status: order.status,
      transactoTerminalId: order.transactoTerminalId,
      cardId: order.cardId,
      fiatAmount: order.fiatAmount,
      bankType: order.bankType
    }
  }

  /**
   * POST /api/tma/sales/:id/cancel
   *
   * Stops an order early and refunds the untouched part of the stake. Refused
   * while any order on the terminal is still unsettled — see
   * `SaleCancelService` for why that is not merely cautious.
   */
  @Post(':id/cancel')
  @UserTypeTMA()
  async cancelSale(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string
  ): Promise<CancelSaleRes> {
    return this.saleCancel.cancel(id, req.tmaUser.id)
  }

  /**
   * GET /api/tma/sales
   * Returns all sales for the authenticated user.
   */
  @Get()
  @UserTypeTMA()
  async listSales(@Req() req: TmaAuthenticatedRequest) {
    const tmaUser = req.tmaUser
    const orders = await this.saleDbService.findByTelegramId(tmaUser.id)
    return { orders }
  }

  /**
   * GET /api/tma/sales/:id
   * Returns a single sale with current status.
   */
  @Get(':id')
  @UserTypeTMA()
  async getSale(@Req() req: TmaAuthenticatedRequest, @Param('id') id: string) {
    return { order: await this.findOwnedOrFail(id, req.tmaUser.id) }
  }

  /**
   * GET /api/tma/sales/:id/progress
   *
   * The hydrate half of hydrate-then-subscribe: the same snapshot the
   * `sale.progress` socket event pushes, so a page can load cold, or
   * re-sync after a reconnect, without a second shape to reconcile.
   */
  @Get(':id/progress')
  @UserTypeTMA()
  async getSaleProgress(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string
  ): Promise<SaleProgress> {
    const order = await this.findOwnedOrFail(id, req.tmaUser.id)

    return this.saleProgress.build(order)
  }

  /**
   * Resolves an order the caller actually owns, or 404s.
   *
   * A 404 rather than a 403 for someone else's order, so an id cannot be probed
   * for existence. This replaces a `{ error: '...' }` body returned with HTTP
   * 200, which the client destructured into `undefined` and then crashed on —
   * silently bouncing the user to the dashboard with no explanation.
   */
  private async findOwnedOrFail(
    id: string,
    telegramId: number
  ): Promise<TmaSale & { _id: Types.ObjectId }> {
    const order = await this.saleDbService.findById(id)
    if (!order || order.telegramId !== telegramId) {
      throw new NotFoundException(ERROR.SALE.NOT_FOUND)
    }

    return order
  }
}
