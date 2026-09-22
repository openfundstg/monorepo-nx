import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { SALE_STATEMENT_MAX_BYTES } from '@transacto/contracts'

/**
 * The three fields this reads off a multipart upload.
 *
 * Declared locally because `@types/multer` is not installed and
 * `Express.Multer.File` does not exist — the house pattern, the same one
 * `tma-fiat-deposit.controller.ts` uses. Adding a types package for one
 * parameter is not worth a dependency.
 */
interface UploadedStatement {
  readonly buffer: Buffer
  readonly originalname: string
  readonly mimetype: string
}
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
import { ConfirmCardOrderReqDto } from 'src/modules/telegram-mini-app/dto/confirm-card-order.req.dto'
import { SaleProgressService } from 'src/modules/telegram-mini-app/services/sale-progress.service'
import { TmaSaleDbService } from 'src/modules/repositories/tma-sale-db/services'
import type { TmaSale } from 'src/modules/repositories/tma-sale-db/schemas'
import { TmaUserDbService } from 'src/modules/repositories/tma-user-db/services'
import { CreateSaleDto } from 'src/modules/telegram-mini-app/dto/create-sale.dto'
import { ResolveDropLinkReqDto } from 'src/modules/telegram-mini-app/dto/resolve-drop-link.req.dto'
import { DropLinkResolverService } from 'src/modules/telegram-mini-app/services/drop-link-resolver.service'
import { SaleCancelService } from 'src/modules/telegram-mini-app/services/sale-cancel.service'
import { SaleCardOrderService } from 'src/modules/telegram-mini-app/services/sale-card-order.service'
import { SaleStatementService } from 'src/modules/telegram-mini-app/services/sale-statement.service'
import { SaleTailService } from 'src/modules/telegram-mini-app/services/sale-tail.service'
import { toAwaitingJar } from 'src/modules/telegram-mini-app/utils'
import {
  getTrustLevel
} from 'src/shared/constants'
import { transactoOrderFloorKopecks } from 'src/shared/utils'
import type { Types } from 'mongoose'

@Controller('tma/sales')
export class TmaSaleController {
  constructor(
    private readonly saleFacade: SaleFacadeService,
    private readonly saleProgress: SaleProgressService,
    private readonly saleDbService: TmaSaleDbService,
    private readonly userDbService: TmaUserDbService,
    private readonly dropLinkResolver: DropLinkResolverService,
    private readonly saleCancel: SaleCancelService,
    private readonly cardOrders: SaleCardOrderService,
    private readonly statements: SaleStatementService,
    private readonly saleTail: SaleTailService
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
      minOrderKopecks: transactoOrderFloorKopecks(),
      // A kill switch, read per request rather than captured at boot: turning
      // the card variant off has to take effect without a restart, because the
      // reason for turning it off is never leisurely.
      // Named on the create form. It is the obligation the variant asks of the
      // seller, and they agree to it before there is anything to answer.
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
    // The DTO is the wire shape with validation on it, so it is handed over
    // whole rather than unpacked into a positional list that grows by two
    // arguments every time a variant needs something the other does not.
    const order = await this.saleFacade.createSale(tmaUser.id, dto)

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
   * POST /api/tma/sales/:id/tail/confirm
   *
   * The seller says the hand-made transfer that closes their sale arrived.
   *
   * A tail is the stretch under Transacto's order floor: nothing can be routed
   * for it, so it comes as one transfer an operator makes or it does not come
   * at all. There is no order behind it and therefore no order id — the sale is
   * the whole address.
   *
   * **No body, deliberately.** The figure credited is the gap this sale still
   * has, re-read on the call; a seller naming their own amount here would be
   * naming how much of somebody else's USDT to release. Taken at face value for
   * the reason every confirmation in this variant is, and safe to call twice.
   *
   * Card sales only — a jar sale's tail is seen by the scraper rather than
   * reported, and a button there would credit the same hryvnia twice.
   */
  @Post(':id/tail/confirm')
  @UserTypeTMA()
  async confirmTail(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string
  ): Promise<SaleProgress> {
    const sale = await this.saleTail.confirm(req.tmaUser.id, id)

    return this.saleProgress.build(sale)
  }

  /**
   * POST /api/tma/sales/:id/tail/release
   *
   * The seller stops waiting for that transfer, and takes the gap as USDT.
   *
   * The other ending a tail can have, chosen at the end rather than at
   * creation. Refused until `SALE_TAIL_RELEASE_AFTER_MINUTES` have passed
   * **since an operator was told** — a tail held for a statement of the
   * seller's own can be hours old before anyone hears about it, and a wait
   * measured from its appearance would run out while the request was still
   * unread.
   *
   * The sale completes successfully rather than being cancelled: what was
   * delivered was sold, with its profit, and only the gap comes back.
   */
  @Post(':id/tail/release')
  @UserTypeTMA()
  async releaseTail(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string
  ): Promise<SaleProgress> {
    const sale = await this.saleTail.release(req.tmaUser.id, id)

    return this.saleProgress.build(sale)
  }

  /**
   * POST /api/tma/sales/:id/orders/:orderId/confirm
   *
   * The seller says one card order's money reached their card.
   *
   * **This is the settlement.** A card sale has no scraper: the tap is the only
   * record that the hryvnia arrived, and it is taken at face value because it
   * is testimony against the teller's own interest — confirming money that
   * never came costs them their own stake.
   *
   * The same method the bot's inline button calls, and safe to call twice: a
   * seller who taps both surfaces is the expected case, and the second answer
   * finds the order already settled and returns the same snapshot.
   *
   * `receivedAmount` is what actually landed, when a transfer fee took a bite
   * out of it. Absent means the whole order arrived — which is all the bot can
   * say, and the ordinary answer here too.
   *
   * Returns the progress snapshot rather than the sale, so the screen this was
   * pressed on updates from the response without waiting for the socket.
   */
  @Post(':id/orders/:orderId/confirm')
  @UserTypeTMA()
  async confirmCardOrder(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() body: ConfirmCardOrderReqDto
  ): Promise<SaleProgress> {
    const sale = await this.cardOrders.confirm(req.tmaUser.id, id, orderId, body.receivedAmount)

    return this.saleProgress.build(sale)
  }

  /**
   * POST /api/tma/sales/:id/orders/:orderId/deny
   *
   * The seller says one card order's money never arrived.
   *
   * Nothing is settled and nothing is told upstream, because nothing has been
   * established: this is the one claim in the flow that costs the person making
   * it nothing. Routing stops so no further money lands on an open question,
   * and what answers it from here is a bank statement rather than a tap.
   */
  @Post(':id/orders/:orderId/deny')
  @UserTypeTMA()
  async denyCardOrder(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string,
    @Param('orderId', ParseIntPipe) orderId: number
  ): Promise<SaleProgress> {
    const sale = await this.cardOrders.deny(req.tmaUser.id, id, orderId)

    return this.saleProgress.build(sale)
  }

  /**
   * POST /api/tma/sales/:id/orders/:orderId/statement
   *
   * The seller sends a bank statement to settle an order they denied.
   *
   * **Every outcome here is a `200`**, including a refusal: a statement whose
   * period was too short or whose account was wrong is an ordinary answer the
   * screen renders, not an error. What the response carries is the progress
   * snapshot, with the statement's own verdict on the order it answers.
   *
   * The size limit is set on the interceptor as well as checked in the service.
   * Here it stops a phone from streaming ten megabytes into memory before
   * anything looks at it; there it holds for every caller.
   */
  @Post(':id/orders/:orderId/statement')
  @UserTypeTMA()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SALE_STATEMENT_MAX_BYTES } }))
  async uploadStatement(
    @Req() req: TmaAuthenticatedRequest,
    @Param('id') id: string,
    @Param('orderId', ParseIntPipe) orderId: number,
    @UploadedFile() file: UploadedStatement
  ): Promise<SaleProgress> {
    const sale = await this.statements.submit(req.tmaUser.id, id, orderId, {
      buffer: file?.buffer,
      fileName: file?.originalname ?? '',
      mimeType: file?.mimetype ?? ''
    })

    return this.saleProgress.build(sale)
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
