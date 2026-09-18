import { ConfirmCardOrderReq } from '@transacto/contracts'
import { IsInt, IsOptional, IsPositive } from 'class-validator'

/**
 * What a seller says arrived, when it is not the whole order.
 *
 * Every field optional, and an empty body is the ordinary answer: the bot's
 * inline key sends nothing at all, a keyboard having no way to ask for a
 * number, and that means the whole of the order arrived.
 *
 * The ceiling is not here. "No more than the order was for" needs the order,
 * which this class does not have and a validator has no business fetching —
 * `SaleCardOrderService.readDeclared` refuses it, with the order in hand.
 */
export class ConfirmCardOrderReqDto implements ConfirmCardOrderReq {
  /** UAH kopecks. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  readonly receivedAmount?: number
}
