import { BankProvider } from '@transacto/contracts';
import type { BankGuide } from '../interfaces/bank-guide.interface';

/**
 * Where the screenshots live, one folder per bank under `public/guide/`.
 *
 * Numbered rather than named because they are a sequence: step N of a bank's
 * guide shows `<Bank>/N.jpg`, so re-ordering the steps means re-ordering the
 * files and nothing else.
 */
const GUIDE_ASSETS = 'guide';

/**
 * Where the open/collapsed choice is kept.
 *
 * Underscores only: CloudStorage keys are restricted to `A-Z a-z 0-9 _ -`, and
 * a `.` makes every write fail silently — the same trap documented on
 * `LANGUAGE_STORAGE_KEY`.
 */
export const GUIDE_EXPANDED_STORAGE_KEY = 'bank_guide_expanded';

const shot = (bank: string, index: number): string => `${GUIDE_ASSETS}/${bank}/${index}.jpg`;

/**
 * The step-by-step setup for each bank, as the create form renders it.
 *
 * Two steps in every guide are load-bearing, and both are enforced by the
 * backend rather than merely advised:
 *
 * 1. **The name.** Every jar is called "Оплата за послуги" (or "за товари") —
 *    a jar named anything else does not look like what it claims to be.
 * 2. **The target.** It must equal the order's `fiatAmount`, which is the
 *    sold amount *plus* profit — the same figure the form shows as the
 *    total. `SaleComplianceService` re-checks this on every scrape and
 *    blocks the order and the terminal if the jar disagrees, so a wrong target
 *    is not a warning here, it is the order ending.
 *
 * The card number is the third: it has to be the jar's own card, not the
 * user's. A foreign card means every order expires without the jar ever
 * filling, which the same service blocks after three in a row.
 *
 * Link examples match what each bank actually shows on its share screen —
 * `www.privat24.ua` rather than `next.`, and PUMB's `mobile-app.pumb.ua` short
 * link, which the backend resolves for the `box_id` the scraper needs.
 */
export const BANK_GUIDE: Record<BankProvider, BankGuide> = {
  [BankProvider.MONO]: {
    steps: [
      { textKey: 'sale.guide.MONO.step_1', image: shot('Mono', 1) },
      { textKey: 'sale.guide.MONO.step_2', image: shot('Mono', 2) },
      { textKey: 'sale.guide.MONO.step_3', image: shot('Mono', 3) },
      { textKey: 'sale.guide.MONO.step_4', image: shot('Mono', 4) },
      { textKey: 'sale.guide.MONO.step_5', image: shot('Mono', 5) },
      { textKey: 'sale.guide.MONO.step_6', image: shot('Mono', 6) },
    ],
    linkExample: 'https://send.monobank.ua/jar/XXXXXXXX',
    warningKey: 'sale.guide.MONO.warning',
  },

  [BankProvider.PRIVAT]: {
    steps: [
      { textKey: 'sale.guide.PRIVAT.step_1', image: shot('Privat', 1) },
      { textKey: 'sale.guide.PRIVAT.step_2', image: shot('Privat', 2) },
      { textKey: 'sale.guide.PRIVAT.step_3', image: shot('Privat', 3) },
      { textKey: 'sale.guide.PRIVAT.step_4', image: shot('Privat', 4) },
    ],
    linkExample: 'https://www.privat24.ua/send/XXXXXXXX',
    warningKey: 'sale.guide.PRIVAT.warning',
  },

  /**
   * Seven steps, and none of them a browser address bar.
   *
   * `DropLinkResolverService` follows the `mobile-app.pumb.ua` redirect
   * server-side for the `box_id`, so this reads like the other two banks. The
   * manual route survives as `fallbackKey` for when the bank refuses us.
   */
  [BankProvider.PUMB]: {
    steps: [
      { textKey: 'sale.guide.PUMB.step_1', image: shot('PUMB', 1) },
      { textKey: 'sale.guide.PUMB.step_2', image: shot('PUMB', 2) },
      { textKey: 'sale.guide.PUMB.step_3', image: shot('PUMB', 3) },
      { textKey: 'sale.guide.PUMB.step_4', image: shot('PUMB', 4) },
      { textKey: 'sale.guide.PUMB.step_5', image: shot('PUMB', 5) },
      { textKey: 'sale.guide.PUMB.step_6', image: shot('PUMB', 6) },
      { textKey: 'sale.guide.PUMB.step_7', image: shot('PUMB', 7) },
    ],
    linkExample: 'https://mobile-app.pumb.ua/XXXXX',
    warningKey: 'sale.guide.PUMB.warning',
    fallbackKey: 'sale.guide.PUMB.fallback',
  },

  /**
   * The only bank whose card the user never types.
   *
   * A NovaPay case publishes its own card in full, so the last step is the link
   * and nothing else — the field fills itself and is not editable. That is also
   * why there is no `fallbackKey`: for the other banks a fallback is a way to
   * finish the form by hand, and here there is nothing left to finish.
   *
   * Five steps, one per screen of the app's own flow. Two of them are choices a
   * user cannot guess and both cost them the order: the case's *type* has to be
   * the one with a goal at all, and the goal has to be typed to the kopeck on
   * the same screen — which is why they share a step and a picture.
   *
   * The "creating your Case" screen is not among them. It is a spinner: there
   * is nothing to do on it and nothing to photograph, so it lives as the last
   * clause of step three instead.
   */
  [BankProvider.NOVAPAY]: {
    steps: [
      { textKey: 'sale.guide.NOVAPAY.step_1', image: shot('NovaPay', 1) },
      { textKey: 'sale.guide.NOVAPAY.step_2', image: shot('NovaPay', 2) },
      { textKey: 'sale.guide.NOVAPAY.step_3', image: shot('NovaPay', 3) },
      { textKey: 'sale.guide.NOVAPAY.step_4', image: shot('NovaPay', 4) },
      { textKey: 'sale.guide.NOVAPAY.step_5', image: shot('NovaPay', 5) },
    ],
    linkExample: 'https://e-com.novapay.ua/case/XXXXXXXXXX',
    warningKey: 'sale.guide.NOVAPAY.warning',
  },
};
