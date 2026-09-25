import { CentRounding, usdtCentsForKopecks } from './sale-quote.js';

/**
 * What a hryvnia top-up credits: USDT cents for `amountUah` kopecks at the buy
 * rate.
 *
 * **Rounded down**, and through the same converter every other product uses —
 * a sale's refund and a top-up's credit are the same arithmetic over the same
 * units. The direction is the argument: rounding a fraction of a cent up
 * credits USDT nobody paid for, on every top-up, forever.
 *
 * Here rather than in the facade that credits it, because four places price a
 * top-up — that facade, the offer it quotes, and a demo account's pack and
 * device — and the rounding is exactly the part that would drift between them.
 */
export const topUpCreditCents = (amountUah: number, buyRate: number): number =>
  usdtCentsForKopecks(amountUah, buyRate, CentRounding.DOWN);

/**
 * What a USDT deposit is worth in hryvnia: UAH kopecks for `cryptoAmount` USDT
 * — human units, as the deposit form takes it — at the buy rate.
 *
 * The figure a deposit is stored and shown with. Nearest kopeck: it credits
 * nothing, it only restates the USDT that arrive.
 */
export const depositFiatEquivalent = (cryptoAmount: number, buyRate: number): number =>
  Math.round(cryptoAmount * buyRate);
