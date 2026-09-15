import { ERROR, MIN_USDT_AMOUNT, BalanceEntryKind } from '@transacto/contracts'
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException
} from '@nestjs/common'
import {
  TmaDepositDbService,
  type CreditedValuation
} from 'src/modules/repositories/tma-deposit-db/services'
import { ExchangeRateService } from 'src/modules/exchange-rate/services'
import { TestTransactionService } from 'src/modules/telegram-mini-app/services/test-transaction.service'
import { TmaGateway } from 'src/modules/telegram-mini-app/gateways/tma.gateway'
import {
  BLOCKCHAIN_VERIFICATION_STRATEGY
} from 'src/shared/constants'
import type { BlockchainVerificationStrategy } from 'src/modules/telegram-mini-app/interfaces/blockchain-verification-strategy.interface'
import { TmaDepositStatus } from 'src/modules/repositories/tma-deposit-db/schemas'
import { isSameTronAddress } from 'src/shared/utils'
import environments from 'src/environments'
import { BalanceLedgerService } from 'src/modules/telegram-mini-app/services/balance-ledger.service'

@Injectable()
export class DepositFacadeService {
  private readonly logger = new Logger(DepositFacadeService.name)

  constructor(
    private readonly depositDbService: TmaDepositDbService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly testTransactions: TestTransactionService,
    private readonly tmaGateway: TmaGateway,
    @Inject(BLOCKCHAIN_VERIFICATION_STRATEGY)
    private readonly blockchainStrategy: BlockchainVerificationStrategy,
    private readonly balanceLedger: BalanceLedgerService
  ) {}

  /**
   * Creates a new deposit:
   * 1. Fetch current exchange rate
   * 2. Calculate fiatEquivalent from cryptoAmount × exchangeRate
   * 3. Create TmaDeposit record (status = PENDING, expiresAt = now + expiry minutes)
   * 4. Return deposit details + merchant wallet address
   */
  async createDeposit(telegramId: number, cryptoAmount: number) {
    // Enforced here rather than only on the DTO so the user gets a translated
    // reason instead of a bare validation failure — and so it holds for any
    // caller, not just the Mini App.
    if (cryptoAmount < MIN_USDT_AMOUNT) {
      throw new BadRequestException({
        ...ERROR.DEPOSIT.BELOW_MINIMUM,
        details: `Minimum is ${MIN_USDT_AMOUNT} USDT, got ${cryptoAmount}`
      })
    }

    // The buy rate, not the market. A deposit is the user acquiring USDT here,
    // so its hryvnia equivalent is quoted at the price this product acquires it
    // at — the same number the top-up screen shows. The market rate used to be
    // stored, which put a third figure on a screen already showing two.
    const exchangeRate = await this.exchangeRateService.getBuyRate() // kopecks per 1 USDT
    const fiatEquivalent = Math.round(cryptoAmount * exchangeRate) // kopecks
    const expiryMinutes = Number(environments.TMA_DEPOSIT_EXPIRY_MINUTES || '60')
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000)

    const deposit = await this.depositDbService.create({
      telegramId,
      cryptoAmount,
      fiatEquivalent,
      exchangeRate,
      expiresAt
    })

    const walletAddress = this.blockchainStrategy.getWalletAddress()

    // The opening line of a deposit's story in the log. Everything after it is
    // keyed by the same id, so one grep follows a user's money end to end.
    this.logger.log(
      `[deposit ${deposit._id.toString()}] created for telegramId ${telegramId}: ` +
        `expecting ${cryptoAmount} USDT to ${walletAddress} ` +
        `(= ${fiatEquivalent / 100} UAH at ${exchangeRate / 100}), expires ${expiresAt.toISOString()}`
    )

    return {
      deposit,
      walletAddress
    }
  }

  /**
   * Verifies a user-submitted TxID against the blockchain:
   * 1. Check if TxID already exists in DB → reject (double-spend protection)
   * 2. Find the deposit and check ownership
   * 3. Call blockchainStrategy.verifyTransaction(txId)
   * 4. Validate: tx exists, confirmed, to === MERCHANT_WALLET, amount >= deposit.cryptoAmount
   * 5. If deposit is EXPIRED but tx is valid → mark PAID_LATE + auto-credit balance
   * 6. If deposit is PENDING and tx is valid → mark COMPLETED + credit balance
   * 7. Emit WebSocket events for real-time UI update
   */
  async verifyDeposit(depositId: string, txId: string, telegramId: number) {
    this.logger.log(`[deposit ${depositId}] verifying TxID ${txId} for telegramId ${telegramId}`)

    // 1. Anti-double-spend check.
    //
    // A test TxID is exempt because it is meant to be submitted repeatedly; it
    // is still stored uniquely per deposit, so the index below it stays armed.
    const isTestTx = this.testTransactions.isTestTxId(txId)
    if (!isTestTx) {
      const txIdUsed = await this.depositDbService.isTxIdUsed(txId)
      if (txIdUsed) {
        this.logger.warn(`[deposit ${depositId}] rejected: TxID ${txId} was already submitted`)
        throw new ConflictException(ERROR.DEPOSIT.TX_ALREADY_SUBMITTED)
      }
    }

    // 2. Find deposit and validate ownership
    const deposit = await this.depositDbService.findById(depositId)
    if (!deposit) {
      this.logger.warn(`[deposit ${depositId}] rejected: no such deposit`)
      throw new NotFoundException(ERROR.DEPOSIT.NOT_FOUND)
    }
    if (deposit.telegramId !== telegramId) {
      this.logger.warn(
        `[deposit ${depositId}] rejected: belongs to ${deposit.telegramId}, not ${telegramId}`
      )
      throw new BadRequestException(ERROR.DEPOSIT.NOT_OWNED)
    }
    if (deposit.status === TmaDepositStatus.COMPLETED || deposit.status === TmaDepositStatus.PAID_LATE) {
      this.logger.warn(`[deposit ${depositId}] rejected: already ${deposit.status}`)
      throw new BadRequestException(ERROR.DEPOSIT.ALREADY_VERIFIED)
    }

    // 3. Verify on blockchain — or stand in for it, on a deployment that has a
    //    test TxID configured. The fabricated transaction pays exactly what the
    //    deposit asked for, so every rule below judges it like any other.
    const verifiedTx = isTestTx
      ? this.testTransactions.fabricate(
          txId,
          deposit.cryptoAmount,
          this.blockchainStrategy.getWalletAddress()
        )
      : await this.blockchainStrategy.verifyTransaction(txId)
    if (!verifiedTx) {
      // The chain was reached and said nothing is there — distinct from it
      // being unreachable, which throws before we get here.
      this.logger.warn(`[deposit ${depositId}] rejected: chain has no USDT transfer for ${txId}`)
      throw new BadRequestException(ERROR.DEPOSIT.TX_NOT_FOUND)
    }

    // The single most useful line when asking "did the money actually arrive?".
    // Everything the chain reported, before any of our rules judge it.
    this.logger.log(
      `[deposit ${depositId}] chain reports ${verifiedTx.amount} ${verifiedTx.tokenSymbol} ` +
        `from ${verifiedTx.from} to ${verifiedTx.to}, ` +
        `confirmed=${verifiedTx.confirmed}, at ${new Date(verifiedTx.timestamp).toISOString()}`
    )

    // 4. Validate transaction details
    if (!verifiedTx.confirmed) {
      this.logger.warn(`[deposit ${depositId}] rejected: transaction is not confirmed yet`)
      throw new BadRequestException(ERROR.DEPOSIT.TX_NOT_CONFIRMED)
    }

    const merchantWallet = this.blockchainStrategy.getWalletAddress()
    // Compared as TRON addresses rather than lower-cased strings: base58 is
    // case-sensitive, and the two sides can arrive in different encodings.
    if (!isSameTronAddress(verifiedTx.to, merchantWallet)) {
      // Worth an `error`: the money went somewhere else entirely, and whoever
      // is on call wants to know that rather than read it as a typo.
      this.logger.error(
        `[deposit ${depositId}] rejected: paid to ${verifiedTx.to}, ` +
          `but our wallet is ${merchantWallet}`
      )
      throw new BadRequestException(ERROR.DEPOSIT.TX_WRONG_RECIPIENT)
    }

    // Allow a small tolerance (0.01 USDT) for rounding
    if (verifiedTx.amount < deposit.cryptoAmount - 0.01) {
      this.logger.warn(
        `[deposit ${depositId}] rejected: received ${verifiedTx.amount} USDT, ` +
          `expected at least ${deposit.cryptoAmount} USDT`
      )
      throw new BadRequestException({
        ...ERROR.DEPOSIT.TX_AMOUNT_MISMATCH,
        details: `Transaction amount (${verifiedTx.amount} USDT) is less than expected (${deposit.cryptoAmount} USDT)`
      })
    }

    // 5/6. Determine final status and credit balance
    const now = new Date()
    const isExpired = deposit.status === TmaDepositStatus.EXPIRED || now > deposit.expiresAt
    const finalStatus = isExpired ? TmaDepositStatus.PAID_LATE : TmaDepositStatus.COMPLETED

    const txIdToSave = this.testTransactions.storedTxId(txId, depositId)

    // Balance is in USDT cents, so credit the verified USDT amount * 100 —
    // fabricated verifications included, since they carry the deposit's own
    // figure rather than a constant that would have to be corrected here.
    const creditedUsdtCents = Math.round(verifiedTx.amount * 100)

    // What this USDT was worth here, now. Recorded in the same write as the
    // status so a credited deposit is never left unpriceable — the rate it
    // would have been priced at is gone by the next poll.
    //
    // Internal only: it reaches no client. A user who brought their own USDT
    // did not buy it here, and our valuation of it is not a price they were
    // ever offered. What it is for is the history — reading a balance back in
    // hryvnia months later, when the rate of the day is nowhere to be found.
    const valuation = await this.creditedValuation(creditedUsdtCents)

    if (isExpired) {
      await this.depositDbService.markPaidLate(depositId, txIdToSave, now, valuation)
      this.logger.warn(`Deposit ${depositId} paid late — auto-crediting balance per policy`)
    } else {
      await this.depositDbService.markCompleted(depositId, txIdToSave, now, valuation)
    }

    const newBalance = await this.balanceLedger.credit(telegramId, creditedUsdtCents, {
      kind: BalanceEntryKind.DEPOSIT,
      sourceId: depositId,
      // A reconciler and a user's own tap can both arrive at a verified
      // deposit; the credit is guarded upstream, and this keeps the book from
      // recording the same arrival twice.
      once: true
    })

    this.logger.log(
      `[deposit ${depositId}] ${finalStatus}: credited ${creditedUsdtCents / 100} USDT to ` +
        `telegramId ${telegramId}, new balance ${newBalance / 100} USDT (TxID ${txId})`
    )

    // 7. Emit WebSocket events
    this.tmaGateway.emitDepositStatusChange(telegramId, depositId, finalStatus)
    this.tmaGateway.emitBalanceUpdated(telegramId, newBalance)

    return {
      success: true,
      status: finalStatus,
      balanceCredited: creditedUsdtCents
    }
  }

  /** Returns the merchant wallet address from the strategy */
  getWalletAddress(): string {
    return this.blockchainStrategy.getWalletAddress()
  }

  /**
   * UAH kopecks per USDT for acquiring USDT — what a deposit is quoted at.
   *
   * One of the product's two rates, never the market: a deposit screen showing
   * the market would be quoting a price nothing here trades at.
   */
  async getBuyRate(): Promise<number> {
    return this.exchangeRateService.getBuyRate()
  }

  /**
   * Prices credited USDT in hryvnia, at the same rate a hryvnia top-up uses.
   *
   * The *buy* rate deliberately, not the market: this product has two rates and
   * the market is neither of them, so a valuation expressed in a third number
   * would be a third answer to what a hryvnia is worth. Read here rather than
   * taken from the deposit's own `exchangeRate`, which was quoted when the
   * deposit was created and may be hours old — `PAID_LATE` exists because that
   * happens.
   */
  private async creditedValuation(creditedUsdtCents: number): Promise<CreditedValuation> {
    const creditedExchangeRate = await this.exchangeRateService.getBuyRate()

    return {
      creditedExchangeRate,
      // Cents to whole USDT, then to kopecks. Rounded, because this is a record
      // of what something was worth rather than a sum anybody is paid.
      creditedFiatEquivalent: Math.round((creditedUsdtCents * creditedExchangeRate) / 100)
    }
  }
}
