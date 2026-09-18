import {
  AlertStatus,
  FiatDepositWatchMode,
  SaleCardOrderState,
  SupportTopicStatus,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus,
} from '@transacto/contracts';
import { ChipTone } from '../enums/chip-tone.enum';

/**
 * Every status in the product, mapped onto one of four tones.
 *
 * One place, so a sale that is `BLOCKED` looks the same wherever it is
 * shown, and so adding a status to a contract enum fails to compile here until
 * somebody decides what it means — which is the moment to decide it.
 *
 * The mappings are `Record<Enum, ChipTone>` rather than partial lookups with a
 * fallback for exactly that reason: a fallback would silently paint a new
 * status grey and nobody would find out.
 */

const SALE_TONES: Readonly<Record<TmaSaleStatus, ChipTone>> = {
  [TmaSaleStatus.CREATED]: ChipTone.NEUTRAL,
  [TmaSaleStatus.TERMINAL_READY]: ChipTone.NEUTRAL,
  // Live and taking money — the state an operator wants to spot at a glance.
  [TmaSaleStatus.AWAITING_FIAT]: ChipTone.WARNING,
  // Winding down but still in service: a payer can still land money here, which
  // is precisely why it is not neutral.
  [TmaSaleStatus.CLOSING]: ChipTone.WARNING,
  [TmaSaleStatus.COMPLETED]: ChipTone.POSITIVE,
  [TmaSaleStatus.FAILED]: ChipTone.DANGER,
  [TmaSaleStatus.CANCELLED]: ChipTone.NEUTRAL,
  // A stake still frozen and a user waiting on a review.
  [TmaSaleStatus.BLOCKED]: ChipTone.DANGER,
};

const DEPOSIT_TONES: Readonly<Record<TmaDepositStatus, ChipTone>> = {
  [TmaDepositStatus.PENDING]: ChipTone.WARNING,
  [TmaDepositStatus.COMPLETED]: ChipTone.POSITIVE,
  [TmaDepositStatus.EXPIRED]: ChipTone.NEUTRAL,
  // Money that arrived after the window and was credited anyway — worth
  // noticing, not worth alarming about.
  [TmaDepositStatus.PAID_LATE]: ChipTone.WARNING,
};

/**
 * A fiat top-up's tones.
 *
 * `REVIEW` is the only one that alarms, and deliberately: it is the state the
 * automatic path refuses to resolve, which means a person has to. `EXPIRED` and
 * `CANCELLED` are ordinary endings — a payout went back to the book and nobody
 * lost anything.
 */
/**
 * Where one card-sale order stands, toned by who is waiting on what.
 *
 * `DISPUTED` is a warning rather than a danger: somebody denied a payment and
 * the product is asking them for a document, which is the process working. What
 * turns danger is `PROVEN_UNPAID` — a statement covering the window showed no
 * such credit, so a payer's money is somewhere and an appeal is coming.
 *
 * `PROVEN_PAID` is positive and deliberately not neutral: the order settled. It
 * also means the seller denied money they had received, which is a fact about
 * them rather than about this row, and the row is not where that is raised.
 */
const CARD_ORDER_TONES: Readonly<Record<SaleCardOrderState, ChipTone>> = {
  [SaleCardOrderState.AWAITING_CONFIRMATION]: ChipTone.NEUTRAL,
  [SaleCardOrderState.CONFIRMED]: ChipTone.POSITIVE,
  [SaleCardOrderState.DISPUTED]: ChipTone.WARNING,
  [SaleCardOrderState.PROVEN_PAID]: ChipTone.POSITIVE,
  [SaleCardOrderState.PROVEN_UNPAID]: ChipTone.DANGER,
}

export const cardOrderTone = (state: SaleCardOrderState): ChipTone => CARD_ORDER_TONES[state]

const FIAT_DEPOSIT_TONES: Readonly<Record<TmaFiatDepositStatus, ChipTone>> = {
  [TmaFiatDepositStatus.RESERVED]: ChipTone.WARNING,
  [TmaFiatDepositStatus.PARTIALLY_PAID]: ChipTone.WARNING,
  [TmaFiatDepositStatus.COMPLETED]: ChipTone.POSITIVE,
  [TmaFiatDepositStatus.EXPIRED]: ChipTone.NEUTRAL,
  [TmaFiatDepositStatus.CANCELLED]: ChipTone.NEUTRAL,
  [TmaFiatDepositStatus.REVIEW]: ChipTone.DANGER,
};

/**
 * How long the request lives, which here is the same thing as whether anybody
 * is still waiting on it.
 *
 * A standing request is `WARNING` in the sense this palette means it — somebody
 * is waiting for a person to do something, and the something is a payout in
 * that range. A one-off is a single call that has very likely already happened,
 * so there is nothing left for anyone to act on.
 */
const FIAT_WATCH_MODE_TONES: Readonly<Record<FiatDepositWatchMode, ChipTone>> = {
  [FiatDepositWatchMode.ALWAYS]: ChipTone.WARNING,
  [FiatDepositWatchMode.ONCE]: ChipTone.NEUTRAL,
};

const ALERT_TONES: Readonly<Record<AlertStatus, ChipTone>> = {
  [AlertStatus.PENDING]: ChipTone.DANGER,
  [AlertStatus.RESOLVED]: ChipTone.POSITIVE,
};

const SUPPORT_TOPIC_TONES: Readonly<Record<SupportTopicStatus, ChipTone>> = {
  [SupportTopicStatus.OPEN]: ChipTone.WARNING,
  [SupportTopicStatus.CLOSED]: ChipTone.NEUTRAL,
};

export const saleTone = (status: TmaSaleStatus): ChipTone =>
  SALE_TONES[status];

export const depositTone = (status: TmaDepositStatus): ChipTone => DEPOSIT_TONES[status];

export const fiatDepositTone = (status: TmaFiatDepositStatus): ChipTone =>
  FIAT_DEPOSIT_TONES[status];

export const fiatWatchModeTone = (mode: FiatDepositWatchMode): ChipTone =>
  FIAT_WATCH_MODE_TONES[mode];

export const alertTone = (status: AlertStatus): ChipTone => ALERT_TONES[status];

export const supportTopicTone = (status: SupportTopicStatus): ChipTone =>
  SUPPORT_TOPIC_TONES[status];

/** A boolean flag — active, enabled, accepting orders. */
export const flagTone = (value: boolean): ChipTone =>
  value ? ChipTone.POSITIVE : ChipTone.NEUTRAL;

/**
 * A status this app has no opinion about.
 *
 * Used for the safe-box's own status enum, which is backend-only and whose
 * members are operational rather than good or bad.
 */
export const unknownTone = (): ChipTone => ChipTone.NEUTRAL;
