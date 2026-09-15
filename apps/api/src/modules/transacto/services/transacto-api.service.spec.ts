import { TransactoErrorCode } from 'src/shared/interfaces'
import { AxiosError, AxiosHeaders } from 'axios'
import { HttpService } from '@nestjs/axios'
import {
  OrderExecutionOutcome,
  TransactoApiService,
} from './transacto-api.service'

const API_TOKEN = 'token'
const ORDER_ID = 77_001

/** A 400 carrying one of Transacto's own `error_code` values. */
const refusal = (errorCode: number) =>
  new AxiosError(
    'Request failed with status code 400',
    'ERR_BAD_REQUEST',
    { headers: new AxiosHeaders() },
    null,
    {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { success: false, error_code: errorCode, error_message: 'nope' },
    },
  )

describe('TransactoApiService.executeOrder', () => {
  let post: jest.Mock
  let service: TransactoApiService

  beforeEach(() => {
    post = jest.fn()
    service = new TransactoApiService({
      axiosRef: { post, get: jest.fn() },
    } as unknown as HttpService)
  })

  it('reports a confirmation Transacto accepted', async () => {
    post.mockResolvedValue({ data: { status: 'success' } })

    await expect(service.executeOrder(API_TOKEN, ORDER_ID)).resolves.toEqual({
      outcome: OrderExecutionOutcome.CONFIRMED,
    })
  })

  /** A test order cannot be confirmed through the API and never could be. */
  it('treats a test order as confirmed', async () => {
    post.mockRejectedValue(refusal(TransactoErrorCode.TEST_ORDER))

    await expect(service.executeOrder(API_TOKEN, ORDER_ID)).resolves.toEqual({
      outcome: OrderExecutionOutcome.CONFIRMED,
    })
  })

  /**
   * The case this exists for. Throwing here aborted the matcher before it could
   * settle the order, move the baseline or tell the Mini App — and the scraper
   * then retried the same delta every few seconds indefinitely.
   */
  it('reports an insufficient trader limit instead of throwing', async () => {
    post.mockRejectedValue(refusal(TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT))

    await expect(service.executeOrder(API_TOKEN, ORDER_ID)).resolves.toEqual({
      outcome: OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED,
      errorCode: TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT,
    })
  })

  /**
   * Only 108 is swallowed. Any other refusal is still a fault we want loud —
   * a malformed payload must not be filed as "the trader's limit ran out" and
   * silently credited.
   */
  it('still throws on any other error code', async () => {
    post.mockRejectedValue(refusal(999))

    await expect(service.executeOrder(API_TOKEN, ORDER_ID)).rejects.toThrow()
  })

  it('does not retry a 400', async () => {
    post.mockRejectedValue(refusal(TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT))

    await service.executeOrder(API_TOKEN, ORDER_ID)

    expect(post).toHaveBeenCalledTimes(1)
  })
})
