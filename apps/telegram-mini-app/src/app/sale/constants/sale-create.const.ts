import {
  BankProvider,
  isRemainderPolicyAvailable,
  SaleMethod,
  SaleRemainderPolicy,
} from '@transacto/contracts';
import { BANK_NAME_KEY } from '../../shared/constants/bank-name.const';

/**
 * Ukrainian bank cards are 16 digits.
 *
 * Re-exported from the contract rather than restated: the server compares the
 * same card against the one the bank names, and a client that disagreed about
 * what a whole card looks like would either check a half-typed number or never
 * check at all.
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
  /** Draws the badge, and is why this one is listed first. */
  readonly recommended?: boolean;
  /** Listed, greyed and badged — not an ending this method can give yet. */
  readonly comingSoon?: boolean;
}

/**
 * Where each policy's own copy lives, and the one thing that differs by method.
 *
 * Only the *waiting* description does. Refunding reads the same either way — a
 * tail under the floor comes back as USDT and the sale closes — but waiting
 * names who is being waited for, and on a jar that is the jar reaching its goal
 * while on a card it is a transfer arriving. One key for both said "банка" to
 * somebody selling to a card, which is a sentence about a thing their sale does
 * not have.
 */
const REMAINDER_WAIT_DESCRIPTION: Readonly<Record<SaleMethod, string>> = {
  [SaleMethod.JAR]: 'sale.remainder_wait_desc',
  [SaleMethod.CARD]: 'sale.remainder_wait_desc_card',
};

/**
 * What happens to a tail no payment can cover, in the order it is rendered —
 * **the recommended ending first, and it is the only one every method has**.
 *
 * A function of the method rather than a constant, because what is on offer
 * depends on it: `isRemainderPolicyAvailable` comes from the contract, so this
 * greys out exactly what the server would refuse. A picker that offered an
 * ending `POST /tma/sales` rejects would read to a user as the app being
 * broken, which is what a second copy of that rule eventually produces.
 *
 * The unavailable row is greyed and badged rather than dropped, so the screen
 * answers "can I just wait for the full amount" instead of saying nothing
 * about it.
 */
export const remainderPolicyOptions = (
  method: SaleMethod,
): readonly RemainderPolicyOption[] => [
  {
    policy: SaleRemainderPolicy.REFUND_TO_BALANCE,
    titleKey: 'sale.remainder_refund_title',
    descriptionKey: 'sale.remainder_refund_desc',
    recommended: true,
  },
  {
    policy: SaleRemainderPolicy.WAIT_FOR_TOP_UP,
    titleKey: 'sale.remainder_wait_title',
    descriptionKey: REMAINDER_WAIT_DESCRIPTION[method],
    comingSoon: !isRemainderPolicyAvailable(method, SaleRemainderPolicy.WAIT_FOR_TOP_UP),
  },
];

/**
 * Selected on first paint: the recommended policy, by construction.
 *
 * Derived from the flag rather than named separately, exactly as
 * {@link DEFAULT_BANK} is — recommending one ending while pre-selecting another
 * is the kind of disagreement that only shows up in front of a user. It is
 * available on every method, so one value covers both forms.
 *
 * It now agrees with the server's own fallback, `defaultRemainderPolicy`, which
 * it did not before: `POST /tma/sales` used to default to `WAIT_FOR_TOP_UP` for
 * a client that named nothing.
 */
export const DEFAULT_REMAINDER_POLICY: SaleRemainderPolicy = (
  remainderPolicyOptions(SaleMethod.CARD).find((option) => option.recommended) ??
  remainderPolicyOptions(SaleMethod.CARD)[0]
).policy;

/**
 * The smallest order the payment pipeline routes, until the server says
 * otherwise.
 *
 * Re-exported from the contract, like {@link CARD_NUMBER_LENGTH}: the create form
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
