import { BankProvider, SaleMethod } from '@transacto/contracts';

/**
 * Which class draws an identity — a bank, or the way a sale pays out.
 *
 * **Deliberately not `ChipTone`.** Those four tones mean "money arrived",
 * "somebody must act", "money at risk" and "nothing to say"; a fifth meaning
 * "PrivatBank" would make the vocabulary mean nothing, and the whole reason
 * that vocabulary is four words long is that two screens must not disagree
 * about whether `BLOCKED` is amber or red.
 *
 * Same discipline as `tone.util.ts` otherwise: `Record<Enum, string>` with no
 * fallback, so a fifth bank fails to compile until somebody gives it a colour.
 * The classes themselves live in `styles/_primitives.scss`.
 */

const BANK_BADGES: Readonly<Record<BankProvider, string>> = {
  [BankProvider.MONO]: 'badge--bank-MONO',
  [BankProvider.PRIVAT]: 'badge--bank-PRIVAT',
  [BankProvider.PUMB]: 'badge--bank-PUMB',
  [BankProvider.NOVAPAY]: 'badge--bank-NOVAPAY',
};

const BANK_ROWS: Readonly<Record<BankProvider, string>> = {
  [BankProvider.MONO]: 'row--bank-MONO',
  [BankProvider.PRIVAT]: 'row--bank-PRIVAT',
  [BankProvider.PUMB]: 'row--bank-PUMB',
  [BankProvider.NOVAPAY]: 'row--bank-NOVAPAY',
};

const METHOD_BADGES: Readonly<Record<SaleMethod, string>> = {
  [SaleMethod.JAR]: 'badge--method-JAR',
  [SaleMethod.CARD]: 'badge--method-CARD',
};

/**
 * `null` for a value that is not a bank we know.
 *
 * A sale's `bankType` is a plain string on the wire — it is whatever the drop
 * link resolved to — so it can legitimately be something this list has no
 * colour for. An unknown bank draws as an ordinary chip rather than as a
 * missing one.
 */
export const bankBadge = (bank: string | null): string | null =>
  bank !== null && bank in BANK_BADGES ? BANK_BADGES[bank as BankProvider] : null;

/** The tint a whole row carries, so a book of mixed banks groups at a glance. */
export const bankRowClass = (bank: string | null): string | null =>
  bank !== null && bank in BANK_ROWS ? BANK_ROWS[bank as BankProvider] : null;

export const saleMethodBadge = (method: SaleMethod): string => METHOD_BADGES[method];
