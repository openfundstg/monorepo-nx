/**
 * The handshake PrivatBank requires before it will serve a balance.
 *
 * Cached in Redis for an hour by `PrivatScraperStrategy`; assembled from the
 * `init` and `ziplink` calls in `BankScraperApiService`.
 */
export interface PrivatSessionData {
  hash: string
  pubkey: string
  xref: string
  refEnv: string
}
