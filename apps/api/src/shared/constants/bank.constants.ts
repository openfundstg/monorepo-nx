/**
 * `BankProvider` travels over the wire to the extension, so it is owned by
 * @transacto/contracts and re-exported here. Do not redeclare it locally —
 * existing `src/shared/constants` imports keep working through this bridge.
 */
export { BankProvider, BANK_URL_KEYWORDS } from '@transacto/contracts'
