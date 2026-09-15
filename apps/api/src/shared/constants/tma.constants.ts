import { TrustLevel, BankProvider, type TrustLevelInfo } from '@transacto/contracts'
import environments from 'src/environments'

export { TrustLevel, type TrustLevelInfo } from '@transacto/contracts'

export const TMA_DEPOSIT_EXPIRY_QUEUE = 'tma-deposit-expiry'
export const BLOCKCHAIN_VERIFICATION_STRATEGY = 'BLOCKCHAIN_VERIFICATION_STRATEGY'

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
 * Transacto payment_method_id mapping per bank provider.
 * Monobank = 68, PrivatBank = 87, PUMB = 67, NovaPay = 96
 */
export const BANK_PAYMENT_METHOD_ID: Record<BankProvider, number> = {
  [BankProvider.MONO]: 68,
  [BankProvider.PRIVAT]: 87,
  [BankProvider.PUMB]: 67,
  [BankProvider.NOVAPAY]: 96
}
