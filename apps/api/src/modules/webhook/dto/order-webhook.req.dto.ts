import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator'
import { WebhookEvent } from 'src/modules/webhook/enums/webhook-event.enum'
import { TransactoCurrency, TransactoOrderStatus } from 'src/shared/interfaces'
import type { OrderWebhookPayload, TransactoWebhookOrder } from 'src/shared/interfaces'

/**
 * The order inside a delivery, with the runtime checks the shared type cannot
 * carry.
 *
 * `implements TransactoWebhookOrder` so the two cannot drift: the shared type
 * is the wire contract, this class is that contract plus `class-validator`. A
 * field Transacto adds is declared there once and the compiler asks for it
 * here — which is the only reason the DTO can be trusted to be complete.
 *
 * Field names are snake_case because they mirror the Transacto CRM payload,
 * not our own conventions.
 */
export class WebhookOrderDto implements TransactoWebhookOrder {
  @IsInt()
  id: number

  @IsString()
  order_id: string

  @IsNumber()
  amount: number

  @IsEnum(TransactoOrderStatus)
  status_id: TransactoOrderStatus

  @IsOptional()
  @IsString()
  cred?: string | null

  @IsOptional()
  @IsInt()
  card_id?: number | null

  @IsOptional()
  @IsInt()
  terminal_id?: number | null

  @IsOptional()
  @IsEnum(TransactoCurrency)
  currency_id?: TransactoCurrency | null

  @IsOptional()
  @IsString()
  datetime?: string | null

  @IsOptional()
  @IsString()
  deadline?: string | null

  @IsOptional()
  @IsString()
  executed_datetime?: string | null
}

/**
 * A delivery on `POST /webhook/trader`.
 *
 * `Partial<OrderWebhookPayload>` rather than the payload itself, deliberately.
 * Transacto documents `event`, `order` and `timestamp` as required, and in
 * practice a real delivery may carry none of them: the event can arrive in the
 * `X-Event` header alone, and `balance.low` and the appeal events have no order
 * at all. Each of those was once a required field here, and each cost us real
 * deliveries — a 400 that Transacto then retries forever.
 */
export class OrderWebhookReqDto implements Partial<OrderWebhookPayload> {
  /**
   * Optional **on the body**, because Transacto documents the event as the
   * `X-Event` header and only additionally as a body field. Requiring it here
   * meant a delivery that carried it solely in the header failed validation and
   * came back 400 — losing a real order event over where the name was written.
   *
   * The controller resolves the two; see `resolveEvent`.
   */
  @IsOptional()
  @IsEnum(WebhookEvent)
  event?: WebhookEvent

  /**
   * Optional, because not every event Transacto sends is about an order.
   *
   * `balance.low` and the appeal events carry no `order` at all, and requiring
   * it here rejected them with a 400 — which Transacto then retries, forever,
   * for a delivery we would have acknowledged and dropped anyway. The controller
   * checks for it after deciding the event is one we act on, which is the point
   * at which its absence actually matters.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookOrderDto)
  order?: WebhookOrderDto

  @IsInt()
  trader_id: number

  /**
   * ISO 8601. Optional because nothing reads it: the delivery is acted on when
   * it arrives, and a missing timestamp is no reason to drop an order event.
   */
  @IsOptional()
  @IsString()
  timestamp?: string
}
