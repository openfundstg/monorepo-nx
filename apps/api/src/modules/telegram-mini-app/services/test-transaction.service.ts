import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import type { VerifiedTransaction } from 'src/modules/telegram-mini-app/interfaces/blockchain-verification-strategy.interface'
import environments from 'src/environments'

/** Token a fabricated transaction claims to carry — the only one deposits take. */
const TEST_TOKEN_SYMBOL = 'USDT'

/**
 * Sender shown for a fabricated transaction.
 *
 * Deliberately not a well-formed TRON address: it only ever reaches a log line,
 * and anything that reads like a real one invites someone to go looking for it
 * on the chain.
 */
const TEST_SENDER = 'TEST_SENDER_NOT_A_REAL_ADDRESS'

/**
 * The one place that knows what a test deposit is.
 *
 * A test TxID credits a real balance without any money moving, so it is the
 * single most dangerous string in the codebase. It used to be a literal —
 * sixty-four zeros — repeated in `TronTrc20Adapter` and `DepositFacadeService`,
 * live in every environment, with the adapter fabricating a 100 000 USDT
 * transfer for it and the facade special-casing that fabrication back down
 * again in three separate places.
 *
 * Two things changed. The value now comes from `TMA_TEST_TXID`, so an
 * environment that does not set it has no test TxID at all — the feature is
 * absent rather than merely improbable to hit. And the behaviour lives here, so
 * the adapter can go back to knowing only about the chain.
 */
@Injectable()
export class TestTransactionService implements OnModuleInit {
  private readonly logger = new Logger(TestTransactionService.name)

  /** Empty (the default) means no TxID is a test TxID. */
  private readonly configured = (environments.TMA_TEST_TXID ?? '').trim()

  onModuleInit(): void {
    if (!this.enabled) return

    // Loud, once, at boot. Whoever inherits this deployment should not have to
    // read the code to find out that a TxID can mint balance on it.
    this.logger.warn(
      'Test deposits are ENABLED: the TxID in TMA_TEST_TXID credits a balance with no ' +
        'transaction on chain. Unset it in any environment holding real money.'
    )
  }

  /** Whether this deployment has a test TxID at all. */
  get enabled(): boolean {
    return this.configured.length > 0
  }

  /**
   * Whether this TxID is the configured test one.
   *
   * Guarded on `enabled` first, so an unset variable cannot be matched by an
   * empty or whitespace submission.
   */
  isTestTxId(txId: string): boolean {
    return this.enabled && txId.trim() === this.configured
  }

  /**
   * The verification a test TxID stands in for.
   *
   * `amount` is the deposit's own figure rather than a large constant, which is
   * what lets the caller credit `verifiedTx.amount` unconditionally: the
   * fabricated transaction pays exactly what was asked for, so there is nothing
   * left for the crediting step to special-case.
   */
  fabricate(txId: string, expectedAmount: number, walletAddress: string): VerifiedTransaction {
    this.logger.warn(
      `Fabricating a verified transaction for test TxID ${txId}: ` +
        `${expectedAmount} ${TEST_TOKEN_SYMBOL} to ${walletAddress}. No money moved.`
    )

    return {
      txHash: txId,
      from: TEST_SENDER,
      to: walletAddress,
      amount: expectedAmount,
      confirmed: true,
      timestamp: Date.now(),
      tokenSymbol: TEST_TOKEN_SYMBOL
    }
  }

  /**
   * What to store in the deposit's `txId` field.
   *
   * A real hash is stored as it is — the unique index on `txId` is what stops
   * one transaction paying for two deposits. A test TxID is submitted over and
   * over by design, so it is suffixed with the deposit id: unique per deposit,
   * still recognisable in the collection, and the index stays armed for
   * everything else instead of being switched off for all.
   */
  storedTxId(txId: string, depositId: string): string {
    return this.isTestTxId(txId) ? `${txId}_${depositId}` : txId
  }
}
