/**
 * Socket.io event names on the `/tma` namespace, shared by `TmaGateway` and the
 * Mini App's `WsService`.
 *
 * The trader-side equivalent is {@link WsEventNames}; the two namespaces are
 * deliberately separate enums because a trader room and a Telegram user room
 * never carry each other's payloads.
 *
 * These four values were previously raw string literals repeated in the gateway
 * and again in the client, which is exactly the drift this package exists to
 * close — renaming one now fails both builds.
 */
export enum TmaWsEventNames {
  DEPOSIT_STATUS_CHANGED = 'deposit.status_changed',
  SALE_STATUS_CHANGED = 'sale.status_changed',
  /** Full progress snapshot for one sale — see {@link SaleProgress}. */
  SALE_PROGRESS = 'sale.progress',
  BALANCE_UPDATED = 'balance.updated',
  /**
   * The referral balance moved — see {@link ReferralBalanceUpdateEvent}.
   *
   * Separate from {@link BALANCE_UPDATED} because the two balances are separate
   * pots: a referral payout changes this one and leaves the spendable balance
   * untouched, and a client that conflated them would show money as spendable
   * that is not.
   */
  REFERRAL_BALANCE_UPDATED = 'referral.balance_updated',
  /**
   * A fiat top-up moved — see {@link FiatDepositStatusEvent}.
   *
   * Separate from {@link DEPOSIT_STATUS_CHANGED} because the two are different
   * objects with different ids: one is a crypto transfer this backend verifies
   * on-chain, the other a hryvnia payout settled at Transacto. A client
   * switching on a shared event would have to guess which collection the id
   * belongs to.
   */
  FIAT_DEPOSIT_STATUS_CHANGED = 'fiat_deposit.status_changed',
}
