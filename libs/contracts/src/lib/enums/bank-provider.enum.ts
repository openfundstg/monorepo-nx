export enum BankProvider {
  MONO = 'MONO',
  PUMB = 'PUMB',
  PRIVAT = 'PRIVAT',
  NOVAPAY = 'NOVAPAY',
}

export const BANK_URL_KEYWORDS: Record<BankProvider, string> = {
  [BankProvider.MONO]: 'monobank.ua',
  [BankProvider.PUMB]: 'payhub.com.ua',
  [BankProvider.PRIVAT]: 'privat24.ua',
  /**
   * The host a NovaPay "Кейс" is shared on — `e-com.novapay.ua/case/<id>`.
   *
   * `novapay.ua` on its own would also match the bank's marketing site and its
   * public offer pages, which are linked from the case itself.
   */
  [BankProvider.NOVAPAY]: 'e-com.novapay.ua',
};
