import {
  AdminDepositKind,
  AdminDocumentKind,
  AlertStatus,
  FiatDepositWatchMode,
  OrderStatus,
  SaleCardOrderState,
  SaleEvidence,
  SaleStatementStatus,
  SupportTopicStatus,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaFiatReceiptStatus,
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

/**
 * A Transacto order's tones.
 *
 * Moved here from the orders list's own column file the moment a second screen
 * needed them — a sale's page shows the orders routed at its terminal, and two
 * maps would be two answers to "is an appeal bad?".
 */
const ORDER_TONES: Readonly<Record<OrderStatus, ChipTone>> = {
  [OrderStatus.PENDING]: ChipTone.WARNING,
  [OrderStatus.EXECUTED]: ChipTone.POSITIVE,
  [OrderStatus.CANCELLED]: ChipTone.NEUTRAL,
  // Held by Transacto rather than by us, and both need somebody to look: a
  // paused order routes nobody, and an appeal is money in dispute.
  [OrderStatus.PAUSED]: ChipTone.WARNING,
  [OrderStatus.APPEAL]: ChipTone.DANGER,
};

export const orderTone = (status: OrderStatus): ChipTone => ORDER_TONES[status];

/**
 * A statement's verdict.
 *
 * `ACCEPTED` is positive in the sense that the document was *read*, not that
 * its answer was good news: an accepted statement can be the one that proved a
 * seller denied money they had received. The row's own order state says which,
 * and this chip deliberately does not try to.
 */
const STATEMENT_TONES: Readonly<Record<SaleStatementStatus, ChipTone>> = {
  [SaleStatementStatus.UPLOADED]: ChipTone.NEUTRAL,
  [SaleStatementStatus.PARSING]: ChipTone.NEUTRAL,
  [SaleStatementStatus.ACCEPTED]: ChipTone.POSITIVE,
  [SaleStatementStatus.REJECTED]: ChipTone.DANGER,
};

/**
 * A receipt's verdict.
 *
 * `REJECTED` is danger rather than a warning: somebody uploaded a document to
 * prove they had paid and it did not prove it, which is either a person owed
 * an explanation or a forgery. Both want a person.
 */
const RECEIPT_TONES: Readonly<Record<TmaFiatReceiptStatus, ChipTone>> = {
  [TmaFiatReceiptStatus.PARSING]: ChipTone.NEUTRAL,
  [TmaFiatReceiptStatus.ACCEPTED]: ChipTone.POSITIVE,
  [TmaFiatReceiptStatus.REJECTED]: ChipTone.DANGER,
};

/**
 * How one rail or one document kind draws its own status enum.
 *
 * **The tone and the translation prefix travel together**, and that is the
 * whole reason this type exists. Both answer the same question — *which enum is
 * this row's status?* — and they were two independent ternaries, which is two
 * places to answer it and one place to forget. A row toned from one enum and
 * captioned from the other renders a chip whose colour and words disagree.
 */
interface StatusPresentation {
  /**
   * Widened to `string` only here.
   *
   * Each map below is still declared `Record<Enum, ChipTone>` at its own
   * definition, so a member added to that enum still fails to compile. What is
   * lost at this boundary is only the compiler's ability to check *which* enum
   * a mixed column's row carries — which is exactly what `kind` is for.
   */
  readonly tones: Readonly<Record<string, ChipTone>>;
  readonly prefix: string;
}

/**
 * A document kind, which additionally has a refusal to explain.
 *
 * A separate type rather than an optional field on {@link StatusPresentation},
 * because an optional prefix is one that can be `undefined` at the point a key
 * is built — and the key is then the literal string `undefined.MISMATCHED`,
 * rendered to an operator as the reason somebody's money was refused. The
 * deposits book has no refusals, so it uses the narrower type and the question
 * never arises.
 *
 * Here with the other two for the same reason they are together: a row toned
 * from one enum, captioned from another and explained from a third is a chip
 * whose colour, words and reason can each be wrong independently.
 */
interface DocumentPresentation extends StatusPresentation {
  readonly rejectionPrefix: string;
}

/**
 * The two kinds of document, and the two ways of judging one.
 *
 * A `Record` with no fallback, like every other map in this file: a third kind
 * of evidence must fail to compile here until somebody decides how it is drawn
 * and where its copy lives.
 */
const DOCUMENT_PRESENTATION: Readonly<Record<AdminDocumentKind, DocumentPresentation>> = {
  [AdminDocumentKind.SALE_STATEMENT]: {
    tones: STATEMENT_TONES,
    prefix: 'STATEMENT_STATUS',
    rejectionPrefix: 'STATEMENT_REJECTION',
  },
  [AdminDocumentKind.FIAT_RECEIPT]: {
    tones: RECEIPT_TONES,
    prefix: 'RECEIPT_STATUS',
    rejectionPrefix: 'RECEIPT_REJECTION',
  },
};

/** The two rails money comes in on, and the two status enums behind them. */
const DEPOSIT_PRESENTATION: Readonly<Record<AdminDepositKind, StatusPresentation>> = {
  [AdminDepositKind.CRYPTO]: { tones: DEPOSIT_TONES, prefix: 'DEPOSIT_STATUS' },
  [AdminDepositKind.FIAT]: { tones: FIAT_DEPOSIT_TONES, prefix: 'FIAT_DEPOSIT_STATUS' },
};

export const documentTone = (kind: AdminDocumentKind, status: string): ChipTone =>
  DOCUMENT_PRESENTATION[kind].tones[status];

export const documentStatusPrefix = (kind: AdminDocumentKind): string =>
  DOCUMENT_PRESENTATION[kind].prefix;

/** The refusal's own copy — `STATEMENT_REJECTION.*` or `RECEIPT_REJECTION.*`. */
export const documentRejectionKey = (kind: AdminDocumentKind, rejection: string): string =>
  `${DOCUMENT_PRESENTATION[kind].rejectionPrefix}.${rejection}`;

export const depositRowTone = (kind: AdminDepositKind, status: string): ChipTone =>
  DEPOSIT_PRESENTATION[kind].tones[status];

export const depositStatusPrefix = (kind: AdminDepositKind): string =>
  DEPOSIT_PRESENTATION[kind].prefix;

/**
 * How strong a claim an event stands on.
 *
 * **Not a status, and the one place it must not read as one.** A timeline's job
 * here is to separate what a bank proved from what a seller asserted, so the
 * colour has to answer *how well do we know this* rather than *is this good
 * news*. A confirmed order is good news either way; whether it is a fact
 * depends entirely on who said so.
 *
 * `null` is every entry written before evidence was recorded. Deliberately
 * neutral rather than optimistic: nobody wrote down whose word those stood on,
 * and colouring them as proven would invent a fact about somebody's money.
 */
const EVIDENCE_TONES: Readonly<Record<SaleEvidence, ChipTone>> = {
  // A bank signed it and it was checked. The strongest thing this product has.
  [SaleEvidence.STATEMENT]: ChipTone.POSITIVE,
  // Somebody's testimony about their own money, uncorroborated until a document
  // covers the moment they gave it.
  [SaleEvidence.SELLER]: ChipTone.WARNING,
  [SaleEvidence.UPSTREAM]: ChipTone.NEUTRAL,
  [SaleEvidence.SYSTEM]: ChipTone.NEUTRAL,
};

export const evidenceTone = (evidence: SaleEvidence | null): ChipTone =>
  evidence === null ? ChipTone.NEUTRAL : EVIDENCE_TONES[evidence];
