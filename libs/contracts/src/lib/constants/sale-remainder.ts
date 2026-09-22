import { SaleMethod, SaleRemainderPolicy } from '../enums/tma.enum.js';

/**
 * Which endings each sale method can actually give a tail, and what an omitted
 * choice means.
 *
 * **Here rather than on either side of the wire, because both need the same
 * answer for different reasons.** The create form has to grey out an option
 * nobody can pick and say why; the server has to refuse one that arrives
 * anyway. Written twice those two drift, and the shape that drift takes is a
 * picker offering something the server rejects — which reads to a user as the
 * app being broken rather than as a choice not being available.
 */

/**
 * Whether a sale paid out this way can end a tail under this policy.
 *
 * **`WAIT_FOR_TOP_UP` is a card-only ending today, and the asymmetry is not a
 * product preference — it is what the two variants can observe.** Waiting means
 * somebody transfers the last few hryvnia by hand, and the sale then has to
 * notice that it happened. A jar sale notices by being watched: the scraper
 * reads a balance, so a manual top-up arrives as a balance change like any
 * other money. Nothing watches a seller's own card, so on a card sale the same
 * transfer is invisible until the seller says it landed — which is a different
 * mechanism, and it is the one being built.
 *
 * So the jar's version of "wait" is switched off at the picker rather than
 * removed from the enum: orders already running under it settle exactly as they
 * always have, and the option comes back when the ending it promises is
 * something this product can see rather than something it hopes for.
 */
export const isRemainderPolicyAvailable = (
  method: SaleMethod,
  policy: SaleRemainderPolicy,
): boolean =>
  policy === SaleRemainderPolicy.REFUND_TO_BALANCE || method === SaleMethod.CARD;

/**
 * What a create request that names no policy is asking for.
 *
 * **`REFUND_TO_BALANCE`, and this is a deliberate change from the old
 * fallback**, which was `WAIT_FOR_TOP_UP` for every method — the behaviour from
 * before the choice existed, kept so a client that predated it would keep
 * getting what it had always had. Two things retired that reasoning: the option
 * is no longer available on a jar at all, so defaulting to it would default to
 * the one ending the picker refuses; and waiting is the only ending that
 * depends on a person doing something, which is not what an unstated preference
 * should resolve to.
 *
 * A function rather than a constant because the question is per method by
 * nature, even while the answer is not — a caller that has to pass the method
 * cannot forget that it matters, and the day the two answers differ nothing
 * needs finding.
 */
export const defaultRemainderPolicy = (_method: SaleMethod): SaleRemainderPolicy =>
  SaleRemainderPolicy.REFUND_TO_BALANCE;
