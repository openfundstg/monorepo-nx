import { BankProvider } from '@transacto/contracts';

/**
 * The translation key naming each bank, for every screen that has to name one.
 *
 * Lifted out of the create form's picker once a second screen needed it: the
 * dashboard lists the jars a user still has to close, and a jar is only
 * actionable if it says which app to open. `SALE_BANKS` reads its
 * `nameKey` from here rather than repeating the strings, so a bank cannot end
 * up called one thing in the picker and another in the reminder.
 *
 * Keys, not names — the client renders the sentence. A `Record` over the enum
 * rather than a lookup function, so adding a provider fails to compile until it
 * has a label.
 */
export const BANK_NAME_KEY: Readonly<Record<BankProvider, string>> = {
  [BankProvider.MONO]: 'sale.bank_mono',
  [BankProvider.PRIVAT]: 'sale.bank_privat',
  [BankProvider.PUMB]: 'sale.bank_pumb',
  [BankProvider.NOVAPAY]: 'sale.bank_novapay',
};
