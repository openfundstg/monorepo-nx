import { BankProvider, SaleRemainderPolicy } from '@transacto/contracts';
import { BANK_NAME_KEY } from '../../shared/constants/bank-name.const';

/**
 * Smallest order the backend will accept, in whole USDT.
 *
 * Re-exported from the contract rather than restated: the backend enforces the
 * same constant, and a local copy that drifted would either block orders the
 * server would take or offer ones it will refuse.
 */
export { MIN_USDT_AMOUNT as MIN_ORDER_USDT } from '@transacto/contracts';

/**
 * Ukrainian bank cards are 16 digits.
 *
 * Re-exported from the contract rather than restated, like {@link MIN_ORDER_USDT}
 * above: the server compares the same card against the one the bank names, and
 * a client that disagreed about what a whole card looks like would either check
 * a half-typed number or never check at all.
 */
export { CARD_NUMBER_LENGTH } from '@transacto/contracts';

/** One entry on the bank picker. */
export interface SaleBankOption {
  readonly provider: BankProvider;
  /** Under `public/banks/`. */
  readonly icon: string;
  readonly nameKey: string;
  /** The per-bank accent class the stylesheet keys its active state off. */
  readonly modifier: string;
  /** Draws the corner ribbon, and is why this one is listed first. */
  readonly recommended?: boolean;
}

/**
 * The bank picker, in the order it is rendered — **PrivatBank first, then the
 * banks a user can actually start an order on**.
 *
 * The order is the priority, so it lives here rather than in the sequence three
 * copy-pasted blocks happened to sit in the template. Exactly one entry carries
 * `recommended`, and {@link DEFAULT_BANK} is derived from it rather than named
 * separately: recommending one bank while pre-selecting another is the kind of
 * disagreement that only shows up in front of a user.
 */
export const SALE_BANKS: readonly SaleBankOption[] = [
  {
    provider: BankProvider.PRIVAT,
    icon: 'banks/privat.png',
    nameKey: BANK_NAME_KEY[BankProvider.PRIVAT],
    modifier: 'privat',
    recommended: true,
  },
  {
    provider: BankProvider.PUMB,
    icon: 'banks/pumb.png',
    nameKey: BANK_NAME_KEY[BankProvider.PUMB],
    modifier: 'pumb',
  },
  {
    provider: BankProvider.NOVAPAY,
    icon: 'banks/novapay.png',
    nameKey: BANK_NAME_KEY[BankProvider.NOVAPAY],
    modifier: 'novapay',
  },
  // Last because it is the one bank still switched off: a jar's card appears
  // on the share screen and in no record, so nothing about it can be checked
  // before a stake is frozen. It sits at the end rather than being removed —
  // the picker greys it out, which answers "where did Monobank go".
  {
    provider: BankProvider.MONO,
    icon: 'banks/mono.png',
    nameKey: BANK_NAME_KEY[BankProvider.MONO],
    modifier: 'mono',
  },
] as const;

/** The bank selected on first paint: the recommended one, by construction. */
export const DEFAULT_BANK: BankProvider = (
  SALE_BANKS.find((bank) => bank.recommended) ?? SALE_BANKS[0]
).provider;

/** One entry on the remainder picker. */
export interface RemainderPolicyOption {
  readonly policy: SaleRemainderPolicy;
  readonly titleKey: string;
  readonly descriptionKey: string;
  /**
   * Listed but not built yet: the row is greyed out, carries the "in
   * development" badge and cannot be selected.
   */
  readonly comingSoon?: boolean;
}

/**
 * What happens to a tail no payment can cover, in the order it is rendered —
 * **the one policy an order can actually be created with first**.
 *
 * Waiting for the tail to be paid in by hand is listed rather than dropped,
 * greyed out and badged, for the same reason Monobank stays on the bank picker:
 * a row that answers "this is coming" is worth more than a row that silently
 * disappeared. Both the default and the click handler are derived from
 * `comingSoon` rather than restated — see {@link DEFAULT_REMAINDER_POLICY} and
 * {@link isRemainderPolicyEnabled} — so a greyed-out row and a selectable one
 * cannot drift apart.
 */
export const REMAINDER_POLICY_OPTIONS: readonly RemainderPolicyOption[] = [
  {
    policy: SaleRemainderPolicy.REFUND_TO_BALANCE,
    titleKey: 'sale.remainder_refund_title',
    descriptionKey: 'sale.remainder_refund_desc',
  },
  {
    policy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
    titleKey: 'sale.remainder_wait_title',
    descriptionKey: 'sale.remainder_wait_desc',
    comingSoon: true,
  },
] as const;

/**
 * Whether an order may be created with this policy at all.
 *
 * The picker greys the others out; this is what makes the grey mean something,
 * exactly as `isSaleBankEnabled` does for the bank picker. An unknown policy
 * counts as enabled, because the list above is the picker and not the contract:
 * the server is the one that refuses.
 */
export const isRemainderPolicyEnabled = (policy: SaleRemainderPolicy): boolean =>
  !REMAINDER_POLICY_OPTIONS.find((option) => option.policy === policy)?.comingSoon;

/**
 * Selected on first paint: the first policy a user can actually choose.
 *
 * Derived rather than named, exactly as {@link DEFAULT_BANK} is above.
 * Pre-selecting a row the picker greys out is the kind of disagreement that
 * only shows up in front of a user.
 *
 * Note this is **not** the server's default. `POST /tma/sales` falls back to
 * {@link SaleRemainderPolicy.WAIT_FOR_TOP_UP} when the field is absent, which
 * is what a client older than the choice must keep getting; this screen names
 * the policy on every order it creates, so the two never meet.
 */
export const DEFAULT_REMAINDER_POLICY: SaleRemainderPolicy = (
  REMAINDER_POLICY_OPTIONS.find((option) => !option.comingSoon) ?? REMAINDER_POLICY_OPTIONS[0]
).policy;

/**
 * The smallest order the payment pipeline routes, until the server says
 * otherwise.
 *
 * Re-exported from the contract, like {@link MIN_ORDER_USDT}: the create form
 * has to *name* this figure — "anything under ₴300 comes back" — and
 * `GET /sales/config` ships the live value, which may be configured
 * differently. This is only what the screen says before that lands.
 */
export { DEFAULT_MIN_ORDER_KOPECKS } from '@transacto/contracts';

/**
 * First-paint markup over the market, in percent.
 *
 * `GET /sales/config` overwrites this on load — it exists only so the
 * preview has a rate to quote before the response lands. It tracks the backend
 * default (2%) so a config failure degrades to something plausible.
 */
export const DEFAULT_SELL_MARKUP_PERCENT = 2;

/*
 * There is deliberately no DEFAULT_EXCHANGE_RATE.
 *
 * A profit percent is a policy and a stale one is merely wrong by a rounding;
 * a rate is a price, and a stale one quotes the user an amount the server will
 * not honour. The screen shows no figures until `GET /sales/config`
 * hands it the live rate.
 */

/*
 * `CENTS_PER_USDT` and `PERCENT_BASE` used to live here. They are
 * `@transacto/contracts`' now, next to the arithmetic that uses them — a local
 * copy of a unit the server also counts in is the duplication this package
 * exists to remove.
 */
