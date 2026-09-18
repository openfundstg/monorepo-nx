import { BankProvider, CARD_SALE_ENABLED_BANKS } from '@transacto/contracts';
import { SALE_BANKS, type SaleBankOption } from './sale-create.const';

/**
 * The bank picker for a card sale — **a different list from the jar form's**,
 * and the bank that is off in one is on in the other.
 *
 * Derived from {@link SALE_BANKS} so a bank's icon, name key and accent colour
 * are defined once, and filtered by `CARD_SALE_ENABLED_BANKS`, which is the
 * contract the server refuses on. The two lists answer different questions: a
 * jar sale asks whether the bank will name the card behind its link, a card
 * sale asks whether a denied order can be checked against a statement.
 *
 * Unlike the jar picker this one **omits** the banks it cannot offer rather
 * than greying them out. A greyed row answers "where did this go"; here there
 * is nothing to have gone — a card sale on PUMB has never existed, and listing
 * it would advertise a product rather than explain a withdrawal.
 *
 * Built by walking the contract's list rather than filtering ours, so the
 * rendering order **is** the contract's order by construction — monobank first,
 * because its statements carry a qualified signature and a dispute on it has a
 * route out from the first day. A filter plus a sort would be the same result
 * reached twice, and only one of the two would be checked.
 */
export const CARD_SALE_BANKS: readonly SaleBankOption[] = CARD_SALE_ENABLED_BANKS.map(
  (provider) => SALE_BANKS.find((bank) => bank.provider === provider),
).filter((bank): bank is SaleBankOption => bank !== undefined);

/** The bank selected on first paint: the first one that can be offered at all. */
export const DEFAULT_CARD_SALE_BANK: BankProvider =
  CARD_SALE_BANKS[0]?.provider ?? BankProvider.MONO;

/**
 * Re-exported rather than restated, like every other shared figure on this
 * screen: the backend enforces the same two, and a local copy that drifted
 * would either block orders the server takes or offer ones it refuses.
 */
export { MIN_RECEIVER_NAME_LENGTH, SALE_CARD_MAX_ORDERS } from '@transacto/contracts';

/**
 * The steps of "how this works", in order.
 *
 * A list rather than four literals in the template for the same reason
 * `BANK_GUIDE` is one: `i18n.spec.ts` reads it to require the copy in all three
 * dictionaries, so a step added here fails the build until it is translated.
 */
export const CARD_GUIDE_STEP_KEYS: readonly string[] = [
  'sale.card_guide.step_split',
  'sale.card_guide.step_payer',
  'sale.card_guide.step_confirm',
  'sale.card_guide.step_statement',
];
