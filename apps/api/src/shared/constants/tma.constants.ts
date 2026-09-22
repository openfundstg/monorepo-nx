import { isEnabledFlag } from 'src/shared/utils'
import {
  KOPECKS_PER_UAH,
  TrustLevel,
  BankProvider,
  type TrustLevelInfo
} from '@transacto/contracts'
import { SECOND_MS } from 'src/shared/constants/time.constants'
import environments from 'src/environments'

export { TrustLevel, type TrustLevelInfo } from '@transacto/contracts'

export const TMA_DEPOSIT_EXPIRY_QUEUE = 'tma-deposit-expiry'
export const BLOCKCHAIN_VERIFICATION_STRATEGY = 'BLOCKCHAIN_VERIFICATION_STRATEGY'

/**
 * Every sale variant's destination strategy, injected as one array.
 *
 * The array shape is the point: `SaleFacadeService` looks a variant up by
 * `method` and never switches on it, so adding a third is a provider here
 * rather than a branch in the facade. Modelled on `RECEIPT_CODE_STRATEGIES`.
 */
export const SALE_DESTINATION_STRATEGIES = 'SALE_DESTINATION_STRATEGIES'

/**
 * Turnover thresholds are backend-owned business rules, so they stay here.
 * Only the `TrustLevel` name itself crosses the wire and lives in contracts.
 *
 * A level rations one thing: **how many sales run at once.** It used to
 * also cap the size of a single order in USDT — 500, 1000, 2000 — which
 * restrained nothing: an order is already bounded by the stake frozen against
 * it, so the cap only ever refused users with the balance to back what they
 * asked for, while somebody running ten small orders in parallel passed
 * unnoticed. Parallelism is the thing worth rationing, because each open order
 * is a live terminal we are answering for.
 *
 * It briefly rationed a second thing — how large a hryvnia top-up it offered —
 * and no longer does. Turnover was standing in for a question it answers badly:
 * the ceiling is about whether this account has ever settled anything with us
 * at all, and one credited deposit answers that outright where ₴100 000 of
 * turnover merely correlates with it. That rule now lives on its own, in
 * {@link NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH}.
 */
export const TRUST_LEVELS: Record<
  TrustLevel,
  { minTurnover: number; maxParallelOrders: number }
> = {
  [TrustLevel.NEWBIE]: { minTurnover: 0, maxParallelOrders: 1 },
  [TrustLevel.EXPERIENCED]: { minTurnover: 100_000 * 100, maxParallelOrders: 3 },
  [TrustLevel.PRO]: { minTurnover: 500_000 * 100, maxParallelOrders: 5 }
}

/**
 * The largest hryvnia top-up offered to an account that has never had a deposit
 * credited, in UAH kopecks. Everybody else has no ceiling at all.
 *
 * A cap on a single amount, which nothing else here is, and for a reason
 * peculiar to this product: nothing bounds a top-up from the user's side. It
 * freezes no balance and costs nothing to reserve — it hands out a stranger's
 * card number and asks for a transfer to it — so the only stake a brand-new
 * account has in the outcome is the money it is about to move. Above a couple
 * of thousand hryvnia that is a poor trade for both of us.
 *
 * What lifts it is **one completed deposit by any method**, crypto or hryvnia,
 * and not turnover. Turnover is evidence of trading, which is a later and much
 * higher bar; a first settled deposit is evidence that the account is a person
 * who moved their own money through this product once, which is the thing the
 * ceiling was ever protecting against — and it is a bar a genuine user clears
 * on their second visit rather than after ₴100 000 of business.
 */
export const NEW_ACCOUNT_MAX_FIAT_DEPOSIT_UAH = 2_000 * 100

/** Most senior first, so the first threshold a turnover clears is the level. */
const LEVELS_BY_SENIORITY: readonly TrustLevel[] = [
  TrustLevel.PRO,
  TrustLevel.EXPERIENCED,
  TrustLevel.NEWBIE
]

/**
 * Computes trust level dynamically from lifetime totalTurnover (in kopecks).
 * Not stored — always computed on the fly.
 *
 * Read off {@link TRUST_LEVELS}, which until now it did not: the thresholds were
 * written out a second time as `turnoverUah >= 100_000` literals, so
 * `minTurnover` was decorative and editing it changed nothing here. The Mini
 * App's own copy of the milestones names `minTurnover` as its authority, so the
 * two would have parted company the moment anyone took that at its word — the
 * badge saying one level while the progress bar drew another.
 *
 * Both sides are kopecks, so there is no conversion left to get wrong either.
 */
export function getTrustLevel(totalTurnover: number): TrustLevelInfo {
  const level =
    LEVELS_BY_SENIORITY.find(
      (candidate) => totalTurnover >= TRUST_LEVELS[candidate].minTurnover
    ) ?? TrustLevel.NEWBIE

  return {
    level,
    maxParallelOrders: TRUST_LEVELS[level].maxParallelOrders
  }
}

/**
 * How long a card sale's seller has to answer one order, in minutes.
 *
 * **A fallback, and only that.** The deadline a card order actually runs on is
 * Transacto's own `deadline` for the payer, resolved onto our clock — one
 * deadline, so the countdown the seller reads and the instant the sweep acts on
 * are the same instant. This value stands in when a delivery carried no usable
 * pair of timestamps to derive that from.
 *
 * It exists because the alternative is worse than a wrong length. A card order
 * with no deadline at all could never be disputed: the sweep would skip it
 * forever, the terminal would go on taking money against a payment nobody
 * confirmed, and the seller would be left holding a question with no way to
 * answer it.
 *
 * An hour rather than the fifteen minutes a fiat top-up allows, because the two
 * windows ask for opposite things. A top-up's window is how long we hold
 * somebody else's payout, so it is short by necessity. This one is how long a
 * person has to notice a bank notification, and making it short would
 * manufacture disputes out of people who were asleep.
 */
export const TMA_CARD_SALE_CONFIRM_WINDOW_MINUTES = 60

/**
 * How far ahead of an order's deadline routing to its terminal is switched off.
 *
 * **Because expiry and routing are Transacto's decisions, taken on Transacto's
 * clock, and nothing says they happen in that order.** The moment an order
 * stops being open the credential has room for another, and it is free to route
 * one in the same second the old one ran out — before any sweep of ours has
 * seen the first one expire. The sale would then hold two unanswered orders at
 * once, and "did the ₴1 428 arrive?" becomes "did some money arrive?", which is
 * a question nobody can answer about a card that sees more than one transfer a
 * day. One open order at a time is the whole basis of the card variant.
 *
 * So the sweep stands routing down while the order is still alive, and the
 * window closes with the terminal already shut. Thirty seconds because that is
 * the sweep's own period: any shorter and a tick could step straight over the
 * window from "not yet" to "already expired", which is the gap this closes.
 *
 * It costs nothing when the seller answers in time — confirming resumes routing
 * — and at worst delays the next payer by half a minute on an order about to
 * become a dispute, which stops routing anyway.
 */
export const TMA_CARD_SALE_ROUTING_CUTOFF_MS = 30 * SECOND_MS

/**
 * How long after a payment's deadline a statement may still credit it.
 *
 * **The upper edge of the window a statement is searched in**, and it exists
 * because the window used to have no upper edge at all: it ran from the order
 * arriving to the moment the statement was checked, which is however many days
 * the seller took to upload one.
 *
 * That is the wrong direction to be generous in. Finding a credit means the
 * seller denied money they received, so the order is executed and their stake
 * is spent; not finding one only sends the dispute to an operator. A window
 * that grows with the delay eventually contains an unrelated credit of exactly
 * the same size — and "exactly the same size" is not the coincidence it sounds
 * like here, because `min_amount` is the sale's total divided by seven, so a
 * seller running the same sale twice produces payments of identical value.
 *
 * Three hours past the deadline covers a bank posting a transfer late, which is
 * the only honest reason a payment for *this* order lands after its window.
 * Anything later is somebody else's money and must not settle this order.
 */
export const SALE_STATEMENT_LATE_CREDIT_GRACE_MINUTES = 180

/**
 * How much a transfer fee may take out of a card payment and still be waved
 * through, in UAH kopecks — `0` when the allowance is switched off.
 *
 * **A pair of its own, not the scraper's.** `FUZZY_MATCHING_ENABLED` and
 * `FUZZY_MATCHING_TOLERANCE_UAH` describe a different risk: subset-sum matching
 * against a jar's observed balance, which on 2026-09-08 spent the same ₴611
 * twice and cost a user ₴606 of USDT. Reading them here would mean that
 * accepting a ₴5 bank fee on a card and re-enabling that matcher were one
 * decision — and the safe answer to one is the dangerous answer to the other.
 *
 * What this allowance risks is much smaller and bounded per payment: a seller
 * who understates by less than the tolerance keeps the difference, once, on an
 * order capped at a seventh of their sale. The statement checkpoint is what
 * settles whether they were telling the truth.
 *
 * Unset or zero means no allowance at all: any shortfall a seller declares
 * sends the order to a statement instead of executing it.
 */
export const saleCardShortfallToleranceKopecks = (): number => {
  if (!isEnabledFlag(environments.SALE_CARD_SHORTFALL_ENABLED)) return 0

  const uah = Number.parseFloat(environments.SALE_CARD_SHORTFALL_TOLERANCE_UAH || '0')

  return Number.isFinite(uah) && uah > 0 ? Math.round(uah * KOPECKS_PER_UAH) : 0
}

/**
 * Whether a declared shortfall is small enough to execute the order anyway.
 *
 * Exactly the tolerance is inside it, as a limit stated in hryvnia should be.
 * Nothing missing is always acceptable — it is not a shortfall at all.
 */
export const isShortfallAcceptable = (shortfallKopecks: number): boolean =>
  shortfallKopecks <= 0 || shortfallKopecks <= saleCardShortfallToleranceKopecks()


/**
 * Transacto payment_method_id mapping per bank provider.
 * Monobank = 68, PrivatBank = 87, PUMB = 67, NovaPay = 96
 */
export const BANK_PAYMENT_METHOD_ID: Record<BankProvider, number> = {
  [BankProvider.MONO]: 68,
  [BankProvider.PRIVAT]: 87,
  [BankProvider.PUMB]: 67,
  [BankProvider.NOVAPAY]: 96
}

/**
 * How long a seller is asked to wait for somebody to transfer their tail.
 *
 * Past this they may finish the sale themselves and take the gap back as USDT
 * instead — the same ending a sale created with `REFUND_TO_BALANCE` gets, only
 * chosen at the end rather than the start.
 *
 * **Measured from the moment an operator was told, not from the moment the tail
 * appeared.** A tail held for a statement of the seller's own can be hours old
 * before anyone hears about it, and a clock started then would run out while
 * the request was still unread — which would hand the seller USDT for a
 * transfer nobody had yet had a chance to make.
 *
 * Three hours is what the business chose, and the shape of the trade is: too
 * short and a tail is refunded while an operator is walking to their desk; too
 * long and somebody's whole stake sits frozen over a sum under ₴300. Nothing
 * happens automatically at the end of it — the seller gets a button, because
 * the hryvnia is what they asked for and only they can say they have stopped
 * wanting it.
 */
export const SALE_TAIL_RELEASE_AFTER_MINUTES = 180
