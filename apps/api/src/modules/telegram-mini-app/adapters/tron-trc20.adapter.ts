import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { isAxiosError, type AxiosResponse } from 'axios'
import { ERROR } from '@transacto/contracts'
import type {
  BlockchainVerificationStrategy,
  VerifiedTransaction
} from 'src/modules/telegram-mini-app/interfaces/blockchain-verification-strategy.interface'
import { toTronBase58 } from 'src/shared/utils'
import environments from 'src/environments'

/** Attempts per TronGrid call, including the first. */
const MAX_ATTEMPTS = 3

/** First backoff; doubles each retry, so 500ms then 1s. */
const RETRY_BASE_MS = 500

const REQUEST_TIMEOUT_MS = 10_000

interface TronGridEventData {
  block_number: number
  block_timestamp: number
  contract_address: string
  event_name: string
  result: {
    from: string
    to: string
    value: string
    [key: string]: string
  }
  transaction_id: string
}

interface TronGridEventsResponse {
  data: TronGridEventData[]
  success: boolean
}

interface TronGridTransactionResponse {
  ret?: Array<{ contractRet: string }>
  txID?: string
}

@Injectable()
export class TronTrc20Adapter implements BlockchainVerificationStrategy {
  private readonly logger = new Logger(TronTrc20Adapter.name)

  /** USDT TRC-20 contract on TRON mainnet */
  private readonly USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  private readonly TRONGRID_BASE = 'https://api.trongrid.io'

  constructor(private readonly httpService: HttpService) {}

  getWalletAddress(): string {
    return environments.MERCHANT_CRYPTO_ADDRESS
  }

  /**
   * Talks to the chain and nothing else.
   *
   * The test-TxID shortcut that used to open this method lived one branch away
   * from every real verification; it is `TestTransactionService`'s now, and the
   * facade decides which of the two answers a deposit.
   */
  async verifyTransaction(txId: string): Promise<VerifiedTransaction | null> {
    try {
      // 1. Fetch TRC20 transfer events for this transaction
      const eventsUrl = `${this.TRONGRID_BASE}/v1/transactions/${txId}/events`
      const eventsResponse = await this.request<TronGridEventsResponse>(() =>
        this.httpService.axiosRef.get<TronGridEventsResponse>(eventsUrl, {
          timeout: REQUEST_TIMEOUT_MS,
          headers: this.headers()
        })
      )

      if (!eventsResponse.data?.success || !eventsResponse.data?.data?.length) {
        this.logger.warn(
          `No events found for txId ${txId} — the chain answered, so this transaction ` +
            `either does not exist or moved nothing`
        )
        return null
      }

      // Every event on the transaction, so a deposit that paid the wrong token
      // or the wrong contract is visible in the log rather than just "no USDT".
      this.logger.debug(
        `TxID ${txId} carries ${eventsResponse.data.data.length} event(s): ` +
          eventsResponse.data.data
            .map((event) => `${event.event_name}@${event.contract_address}`)
            .join(', ')
      )

      // 2. Find the USDT Transfer event
      const transferEvent = eventsResponse.data.data.find(
        (event) =>
          event.contract_address === this.USDT_CONTRACT && event.event_name === 'Transfer'
      )

      if (!transferEvent) {
        this.logger.warn(
          `No USDT Transfer event on txId ${txId} — it is a real transaction, but not a ` +
            `transfer of USDT (${this.USDT_CONTRACT})`
        )
        return null
      }

      // 3. Extract transfer details.
      //
      // TronGrid reports both parties as hex; a wallet address is written in
      // base58. They are the same bytes in two encodings, and comparing them as
      // strings rejected deposits paid to exactly the right wallet — so both
      // are normalised to base58 here, once, before anyone compares anything.
      const from = toTronBase58(transferEvent.result.from)
      const to = toTronBase58(transferEvent.result.to)

      if (!from || !to) {
        // Crediting on an address we could not read would be worse than asking
        // the user to retry, so this is unavailable rather than "not found".
        this.logger.error(
          `TxID ${txId}: could not read the transfer addresses ` +
            `(from=${transferEvent.result.from}, to=${transferEvent.result.to})`
        )
        throw new ServiceUnavailableException(ERROR.DEPOSIT.VERIFICATION_UNAVAILABLE)
      }

      const rawAmount = BigInt(transferEvent.result.value)
      const amount = Number(rawAmount) / 1e6 // USDT has 6 decimals

      // 4. Verify transaction confirmation via direct transaction lookup
      const txUrl = `${this.TRONGRID_BASE}/wallet/gettransactionbyid`
      const txResponse = await this.request<TronGridTransactionResponse>(() =>
        this.httpService.axiosRef.post<TronGridTransactionResponse>(
          txUrl,
          { value: txId },
          { timeout: REQUEST_TIMEOUT_MS, headers: this.headers() }
        )
      )

      const contractRet = txResponse.data?.ret?.[0]?.contractRet
      const confirmed = contractRet === 'SUCCESS'

      // The raw figures, before the facade scales or judges them. This is the
      // line to read when asking whether TRC-20 money is arriving at all.
      this.logger.log(
        `TxID ${txId}: ${amount} USDT from ${from} to ${to}, ` +
          `contractRet=${contractRet ?? 'unknown'}, block ${transferEvent.block_number}`
      )

      return {
        txHash: txId,
        from,
        to,
        amount,
        confirmed,
        timestamp: transferEvent.block_timestamp,
        tokenSymbol: 'USDT'
      }
    } catch (error) {
      // Rethrown, not swallowed. Returning `null` here is what told a depositor
      // whose USDT had genuinely arrived that their transaction did not exist:
      // the facade turns `null` into TX_NOT_FOUND, and a rate limit is not a
      // missing transaction.
      if (error instanceof ServiceUnavailableException) throw error

      this.logger.error(
        `Failed to verify TxID ${txId}: ${error instanceof Error ? error.message : String(error)}`
      )

      // Anything else is a bug in parsing our own response — also not evidence
      // that the transaction is absent.
      throw new ServiceUnavailableException(ERROR.DEPOSIT.VERIFICATION_UNAVAILABLE)
    }
  }

  /**
   * TronGrid's rate limit is per IP and shared by everything on this host, so
   * a burst of deposits — or a noisy neighbour — hits 429 on the free tier.
   * Setting `TRONGRID_API_KEY` moves us to a per-key quota and is the real fix;
   * this retry only covers the gaps.
   */
  private headers(): Record<string, string> {
    const apiKey = environments.TRONGRID_API_KEY

    return apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {}
  }

  /**
   * Runs a TronGrid call, retrying the failures that are worth retrying.
   *
   * 429 and 5xx are transient by definition and a second attempt a moment later
   * usually succeeds; a 4xx that is not 429 means the request itself is wrong
   * and retrying would only burn quota. Exhausting the attempts raises
   * `VERIFICATION_UNAVAILABLE`, which the user reads as "try again shortly"
   * rather than "your transaction does not exist".
   */
  private async request<T>(send: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await send()
      } catch (error: unknown) {
        const status = isAxiosError(error) ? error.response?.status : undefined
        const retryable = status === undefined || status === 429 || status >= 500

        if (!retryable || attempt === MAX_ATTEMPTS) {
          this.logger.warn(
            `TronGrid request failed (${status ?? 'network'}) on attempt ${attempt}/${MAX_ATTEMPTS}` +
              (retryable ? '; giving up' : '; not retryable')
          )
          throw new ServiceUnavailableException(ERROR.DEPOSIT.VERIFICATION_UNAVAILABLE)
        }

        // Exponential, so a rate limit is given room to clear rather than being
        // hammered by the retry that caused it.
        const backoff = RETRY_BASE_MS * 2 ** (attempt - 1)
        this.logger.warn(
          `TronGrid ${status ?? 'network error'} on attempt ${attempt}/${MAX_ATTEMPTS}; retrying in ${backoff}ms`
        )
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    }

    // Unreachable — the loop either returns or throws.
    throw new ServiceUnavailableException(ERROR.DEPOSIT.VERIFICATION_UNAVAILABLE)
  }


}
