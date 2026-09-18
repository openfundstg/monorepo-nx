import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { isAxiosError } from 'axios'
import type { AxiosResponse } from 'axios'
import {
  TransactoErrorCode,
  type Terminal,
  type TransactoApiError,
  type TransactoCredentialsCreateRequest,
  type TransactoCredentialsCreateResponse,
  type TransactoCredentialsListResponse,
  type TransactoCredentialsUpdateRequest,
  type TransactoCredentialsUpdateResponse,
  type TransactoOrder,
  type TransactoOrdersExecuteRequest,
  type TransactoOrdersExecuteResponse,
  type TransactoOrdersListQuery,
  type TransactoOrdersListResponse,
  type TransactoProfile,
  type TransactoProfileResponse
} from 'src/shared/interfaces'

/**
 * Reads Transacto's own `error_code` off a failed request.
 *
 * The body of a failure is always {@link TransactoApiError}, whatever the HTTP
 * status carrying it, so this is the only thing worth branching on — the status
 * alone does not distinguish "already executed" from "limit exhausted", and
 * both arrive as a 400.
 *
 * **Named for whose codes it reads**, because `errorCodeOf` in
 * `src/shared/utils` reads *ours* — the `ERROR` constant inside a thrown
 * NestJS exception — and the two are entirely different numbers. They were
 * both called `errorCodeOf`, one private here and one exported, and a caller
 * outside this file that reached for the familiar name got a function that
 * silently answers `undefined` for every Transacto failure there is.
 */
export const transactoErrorCodeOf = (error: unknown): TransactoErrorCode | undefined =>
  isAxiosError<TransactoApiError>(error) ? error.response?.data?.error_code : undefined

/**
 * How an attempt to confirm an order ended.
 *
 * A discriminated result rather than a thrown error, because the two outcomes
 * are not success and failure: a refused confirmation still leaves the payer's
 * hryvnia in the jar, and the caller has bookkeeping to do either way. Making
 * it a return value is what stops a call site quietly treating the refusal as
 * a crash — which is what used to abort the scrape mid-match.
 *
 * Anything that is *not* one of these still throws.
 */
export enum OrderExecutionOutcome {
  /** Transacto accepted it. Includes a test order, which it cannot accept but
   *  which is not a problem either. */
  CONFIRMED = 'CONFIRMED',
  /**
   * Refused with 108. The money arrived; the confirmation did not. The order
   * remains open in the cabinet and a human has to confirm it there — or the
   * background retry has to catch the limit once it resets.
   */
  TRADER_LIMIT_EXCEEDED = 'TRADER_LIMIT_EXCEEDED'
}

export interface OrderExecutionResult {
  readonly outcome: OrderExecutionOutcome
  readonly errorCode?: TransactoErrorCode
}

@Injectable()
export class TransactoApiService {
  private readonly logger = new Logger(TransactoApiService.name)

  constructor(private readonly httpService: HttpService) {}

  /**
   * Every credential the trader owns, with the terminal fronting each.
   *
   * `GET /credentials_list`. **Unpaginated upstream**, so this grows without
   * bound as retired Mini App credentials accumulate — see
   * `apps/api/REFACTORING.md`.
   */
  async getTerminalsList(apiToken: string): Promise<Terminal[]> {
    const response = await this.requestWithRetry<TransactoCredentialsListResponse>(
      'GET',
      'credentials_list',
      apiToken
    )

    return response.data?.credentials ?? []
  }

  /**
   * The trader's orders, newest first.
   *
   * `GET /orders_list`. `limit` is capped at 100 upstream and defaults to 50,
   * which is why one is always passed.
   *
   * `card_id[]` repeated is a guess at how the API takes several — the
   * specification documents a single `card_id`. It is harmless if wrong: an
   * unrecognised parameter is ignored and the caller filters again locally.
   */
  async getOrdersList(
    apiToken: string,
    statusId?: TransactoOrdersListQuery['status_id'],
    limit = 100,
    cardIds?: readonly number[]
  ): Promise<TransactoOrder[]> {
    const params = [`limit=${limit}`]
    if (statusId) params.push(`status_id=${statusId}`)
    if (cardIds?.length) params.push(...cardIds.map((id) => `card_id[]=${id}`))

    const response = await this.requestWithRetry<TransactoOrdersListResponse>(
      'GET',
      `orders_list?${params.join('&')}`,
      apiToken
    )

    return response.data?.orders ?? []
  }

  /**
   * Executes (confirms) an order by its internal numeric ID.
   * POST /api/trader/orders_execute
   */
  async executeOrder(apiToken: string, orderId: number): Promise<OrderExecutionResult> {
    // `id` is the order's **internal** numeric id. The API also accepts it
    // under the name `order_id`, which is not the merchant's `order_id` string
    // that comes back on the order itself — see the request type.
    const body: TransactoOrdersExecuteRequest = { id: orderId }

    try {
      await this.requestWithRetry<TransactoOrdersExecuteResponse>(
        'POST',
        'orders_execute',
        apiToken,
        body
      )

      return { outcome: OrderExecutionOutcome.CONFIRMED }
    } catch (error) {
      const errorCode = transactoErrorCodeOf(error)

      if (errorCode === TransactoErrorCode.TEST_ORDER) {
        this.logger.warn(
          `[TransactoApiService] Order ${orderId} is a test order and cannot be confirmed via API. Faking success.`
        )
        return { outcome: OrderExecutionOutcome.CONFIRMED }
      }

      if (errorCode === TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT) {
        // Not re-thrown, and that is the whole point. This used to escape into
        // the matcher, which aborts before it can mark the order, move the
        // baseline or tell the Mini App its money arrived — and the scrape loop
        // then re-read the same delta and failed here again, every few seconds,
        // forever. The caller settles the order and raises an alert instead.
        this.logger.warn(
          `[TransactoApiService] Order ${orderId} refused: insufficient trader limit (108). ` +
            `It stays open on Transacto and needs confirming in the cabinet.`
        )
        return {
          outcome: OrderExecutionOutcome.TRADER_LIMIT_EXCEEDED,
          errorCode: TransactoErrorCode.INSUFFICIENT_TRADER_LIMIT
        }
      }

      throw error
    }
  }

  /**
   * The trader behind a token — the only way to turn a token into a trader id.
   *
   * `GET /profile`. Answers even for a suspended account (`is_active: false`),
   * which is deliberate upstream: a paused trader's token is still verifiable.
   *
   * Returned as the profile rather than the envelope. Both call sites wanted
   * `.profile.id` and each cast `unknown` to its own inline shape to get there
   * — one of them redeclaring a response interface the other did not know about.
   */
  async getTraderProfile(apiToken: string): Promise<TransactoProfile | undefined> {
    const response = await this.requestWithRetry<TransactoProfileResponse>(
      'GET',
      'profile',
      apiToken
    )

    return response.data?.profile
  }

  /**
   * Changes a credential — in practice, switching one off after a fraud check.
   *
   * `POST /credentials_update`. Only the fields sent are touched, and
   * `commission_rate` is not among the ones that may be: the API refuses it
   * with {@link TransactoErrorCode.VALIDATION} and takes the figure from the
   * trader's settings.
   */
  async updateTerminals(
    apiToken: string,
    data: TransactoCredentialsUpdateRequest
  ): Promise<TransactoCredentialsUpdateResponse> {
    const response = await this.requestWithRetry<TransactoCredentialsUpdateResponse>(
      'POST',
      'credentials_update',
      apiToken,
      data
    )

    return response.data
  }

  /**
   * Registers a drop link as a credential and its terminal.
   *
   * `POST /credentials_create`. The Mini App's only write to Transacto: it is
   * what turns a jar the user pasted into somewhere payers can be routed.
   *
   * Returns the credential, whose `card_id` and `terminal_id` are what every
   * scrape, sync and webhook afterwards keys on.
   */
  async createCredential(
    apiToken: string,
    data: TransactoCredentialsCreateRequest
  ): Promise<Terminal> {
    const response = await this.requestWithRetry<TransactoCredentialsCreateResponse>(
      'POST',
      'credentials_create',
      apiToken,
      data
    )

    return response.data.credential
  }

  /**
   * Generic request method with per-trader token and exponential backoff retry.
   */
  private async requestWithRetry<T>(
    method: 'GET' | 'POST',
    path: string,
    apiToken: string,
    data?: object,
    maxRetries = 3
  ): Promise<AxiosResponse<T>> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const config = {
          headers: {
            'X-API-TOKEN': apiToken ? apiToken.trim() : '',
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        }

        const safeToken = apiToken
          ? `${apiToken.substring(0, 4)}...${apiToken.substring(apiToken.length - 4)}`
          : 'EMPTY'
        this.logger.debug(
          `[TransactoApiService] ${method} ${path} | X-API-TOKEN: ${safeToken} | Length: ${apiToken?.length}`
        )

        if (method === 'GET') return await this.httpService.axiosRef.get<T>(path, config)

        return await this.httpService.axiosRef.post<T>(path, data, config)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        const status = isAxiosError(error) ? error.response?.status : undefined
        if (status && status >= 400 && status < 500 && status !== 429) {
          this.logger.error(
            `[TransactoApiService] ${method} ${path} failed with ${status}. Response: ${JSON.stringify(isAxiosError(error) ? error.response?.data : null)}`
          )
          throw error
        }

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000
          this.logger.warn(
            `Request to ${path} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`
          )
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
