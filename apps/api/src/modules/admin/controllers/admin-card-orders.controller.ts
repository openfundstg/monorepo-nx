import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res
} from '@nestjs/common'
import type { Response } from 'express'
import {
  ERROR,
  type AdminCardOrderListItem,
  type AdminPaginatedRes
} from '@transacto/contracts'
import { UserTypeAdmin } from 'src/modules/auth'
import { AdminPageQueryDto } from 'src/modules/admin/dto'
import { AdminCardOrdersService } from 'src/modules/admin/services'

/**
 * Card-sale disputes, addressed the way an operator arrives at them.
 *
 * **Every route here is keyed by Transacto's order number**, and that is the
 * whole design rather than a convenience. The dispute is worked in Transacto's
 * own panel, where an order is a number and nothing else; a route that wanted a
 * sale id or a statement id would mean "first go and find it", which is the step
 * that makes evidence unreachable exactly when it is needed.
 */
@Controller('admin/card-orders')
export class AdminCardOrdersController {
  constructor(private readonly cardOrders: AdminCardOrdersService) {}

  /**
   * The queue of disputes.
   *
   * **The search box is the lookup.** An operator arrives from Transacto's panel
   * holding an order number and nothing else; typing it here finds the sale,
   * the seller and the statement. A separate find-by-id route would be a second
   * thing to remember for the same errand.
   */
  @Get()
  @UserTypeAdmin()
  async list(
    @Query() query: AdminPageQueryDto
  ): Promise<AdminPaginatedRes<AdminCardOrderListItem>> {
    return this.cardOrders.list(query)
  }

  /**
   * The statement uploaded against that order.
   *
   * Streamed rather than buffered — these run to hundreds of kilobytes and
   * there is no reason to hold one whole while a browser reads it — and sent as
   * an attachment, because it is a document to file against an appeal rather
   * than something to render in a tab.
   */
  @Get(':orderId/statement')
  @UserTypeAdmin()
  async statement(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Res() response: Response
  ): Promise<void> {
    const found = await this.cardOrders.statementFor(orderId)

    // No statement, or its bytes are gone. A 404 rather than an empty download,
    // so the panel can say which.
    if (found === null) throw new NotFoundException(ERROR.SALE_CARD.STATEMENT_NOT_REQUIRED)

    response.setHeader('Content-Type', 'application/pdf')
    response.setHeader('Content-Disposition', `attachment; filename="${found.fileName}"`)

    found.stream.pipe(response)
  }
}
