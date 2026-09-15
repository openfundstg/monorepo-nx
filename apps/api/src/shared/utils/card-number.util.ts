import { isSameCardNumber } from '@transacto/contracts'

/**
 * Whether two card numbers are the same card.
 *
 * Re-exported from `@transacto/contracts` rather than declared here. It moved
 * when the Mini App's create form started making the same comparison: a client
 * that accepted a pair the server refuses lets a user submit an order that is
 * rejected the instant it arrives, and one that refused a pair the server
 * accepts blocks an order that was set up correctly. Both were reachable while
 * the rule lived on one side only.
 */
export { isSameCardNumber }
