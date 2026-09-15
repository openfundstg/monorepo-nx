/**
 * Parsed and verified blockchain transaction data.
 */
export interface VerifiedTransaction {
  txHash: string
  from: string
  to: string
  /** Human-readable amount (e.g., 10.50 USDT) */
  amount: number
  confirmed: boolean
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Token symbol, e.g. 'USDT' */
  tokenSymbol: string
}

/**
 * Strategy interface for blockchain transaction verification.
 * Concrete implementations exist per chain/token (e.g., TronTrc20Adapter).
 */
export interface BlockchainVerificationStrategy {
  /** Returns the fixed merchant wallet address for this chain */
  getWalletAddress(): string

  /**
   * Fetches and verifies a specific transaction by its TxID/hash.
   *
   * `null` means the chain answered and the transaction is genuinely not there
   * — a wrong TxID, or a transfer of something else. It must never be used for
   * "we could not find out": an implementation that cannot reach the chain
   * **throws** instead, so the caller can tell a depositor to try again rather
   * than telling them their money does not exist.
   *
   * @throws ServiceUnavailableException when the chain could not be queried.
   */
  verifyTransaction(txId: string): Promise<VerifiedTransaction | null>
}
