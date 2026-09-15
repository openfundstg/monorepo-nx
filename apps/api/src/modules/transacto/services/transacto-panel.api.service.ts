import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { ERROR } from '@transacto/contracts'
import { TransactoPanelRateResponse } from 'src/shared/interfaces/transacto-panel.interface'
import { TransactoPanelSessionApiService } from 'src/modules/transacto/services/transacto-panel-session.api.service'
import { describeError } from 'src/shared/utils/describe-error.util'

const RATE_PATH = '/panels/current_rate'

/**
 * The USDT price the Transacto panel publishes.
 *
 * It exists because the panel quotes a price the documented Trader API does not
 * expose, and the panel refuses the `X-API-TOKEN` every other Transacto call
 * uses. Everything about *being logged in* — the credentials, the cookies, the
 * `302`-means-expired rule — belongs to {@link TransactoPanelSessionApiService}
 * and is deliberately not repeated here: reading a rate and settling a payout
 * are the same conversation with the same server, and two copies of the login
 * would be two sessions on one trader account.
 *
 * What is left is this file's actual job: ask for the quote, and refuse to
 * return anything that is not one.
 */
@Injectable()
export class TransactoPanelApiService {
  private readonly logger = new Logger(TransactoPanelApiService.name)

  constructor(
    private readonly httpService: HttpService,
    private readonly session: TransactoPanelSessionApiService
  ) {}

  /**
   * The panel's current USDT price, in UAH for one USDT (e.g. `44.91`).
   *
   * Every failure — a dead session the retry could not repair, a timeout, an
   * unparseable body — comes back as {@link ERROR.EXCHANGE_RATE.UNAVAILABLE}
   * rather than the panel's own error. Callers here are pricing somebody's
   * money and have exactly one decision to make: quote, or refuse to. Which
   * part of the panel let us down is a fact for the log, and the log has it.
   */
  async getCurrentRateUah(): Promise<number> {
    const response = await this.session
      .run<TransactoPanelRateResponse>((cookie) =>
        this.httpService.axiosRef.get(RATE_PATH, {
          headers: { Cookie: cookie, Accept: 'application/json' }
        })
      )
      .catch((error: unknown) => {
        this.logger.error(`Panel rate lookup failed: ${describeError(error)}`)
        throw new ServiceUnavailableException(ERROR.EXCHANGE_RATE.UNAVAILABLE)
      })

    const rate = response.data?.rate

    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      // The body of a 200 from this endpoint is the quote and nothing else, so
      // there is no credential in what this prints.
      this.logger.error(`Panel returned an unusable rate: ${JSON.stringify(response.data)}`)
      throw new ServiceUnavailableException(ERROR.EXCHANGE_RATE.UNAVAILABLE)
    }

    return rate
  }
}
