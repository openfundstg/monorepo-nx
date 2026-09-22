import type {
  FiatDepositWatchMode,
  SaleMethod,
  TmaDepositStatus,
  TmaFiatDepositStatus,
  TmaSaleStatus
} from '@transacto/contracts'

/**
 * Internal EventEmitter2 channels announcing that something on a Mini App
 * user's account moved.
 *
 * Emitted by `TmaGateway` alongside each socket push. Deliberately *neutral*
 * names rather than `admin.*`: the gateway must not know an admin panel exists,
 * or the dependency would point from the Mini App module at a consumer of it —
 * the exact direction the module boundaries forbid. A listener subscribes;
 * nobody publishes to a listener.
 *
 * They carry the ids rather than the mapped rows. A consumer that needs a whole
 * row re-reads it, which costs one indexed lookup and guarantees it sees the
 * state as stored rather than as the emitter happened to have it in hand.
 *
 * The trader-side equivalent is the `ws.emit` channel and {@link TraderWsEvent};
 * the two are separate because a trader room and a Telegram user room never
 * carry each other's payloads.
 */
export const TMA_DOMAIN_EVENT = {
  BALANCE_UPDATED: 'tma.balance_updated',
  REFERRAL_BALANCE_UPDATED: 'tma.referral_balance_updated',
  DEPOSIT_STATUS_CHANGED: 'tma.deposit_status_changed',
  SALE_STATUS_CHANGED: 'tma.sale_status_changed',
  SALE_PROGRESS: 'tma.sale_progress',
  FIAT_DEPOSIT_STATUS_CHANGED: 'tma.fiat_deposit_status_changed',
  /**
   * A hryvnia top-up has been holding a Transacto payout too long and cannot
   * free itself.
   *
   * Only ever the one case that has no automatic ending: a top-up under review
   * with money already paid into its payout. An empty one is given back on its
   * own after ninety minutes; this one must not be, because handing back a
   * payout somebody has transferred to gives a stranger their money.
   *
   * Neutral, like its siblings: the reconciler must not know that a Telegram
   * group exists, or the dependency would point from the Mini App module at a
   * consumer of it.
   */
  FIAT_DEPOSIT_STUCK: 'tma.fiat_deposit_stuck',
  /**
   * A sum this user asked to hear about has just reached Transacto's book.
   *
   * Neutral for the usual reason and for one more: the announcement pass runs
   * inside the twenty-second book refresh, and that refresh must not be able to
   * fail because Telegram is slow. A listener that throws takes nothing with
   * it; a call would take the offer every other user is reading.
   *
   * Carries what the message says rather than an id to re-read, like
   * {@link FIAT_DEPOSIT_STUCK} and for the same reason: the consumer writes a
   * sentence, and a consumer that had to go back to the database would go quiet
   * exactly when the database is the unwell thing.
   */
  FIAT_DEPOSIT_AMOUNTS_AVAILABLE: 'tma.fiat_deposit_amounts_available',
  /**
   * A payer has been routed to a card sale, and its seller has to say whether
   * the money arrived.
   *
   * The card variant has no scraper: a confirmation is the only record that the
   * hryvnia landed. So the seller has to be asked, and asked somewhere they
   * will see it — which in practice is the bot, not a Mini App they may not
   * have open.
   *
   * Neutral for the usual reason: the sale pipeline must not know a Telegram
   * bot exists, or the dependency would point from this module at a consumer of
   * it. Carries the whole sentence's figures rather than an id to re-read, like
   * {@link FIAT_DEPOSIT_AMOUNTS_AVAILABLE} — a consumer that had to go back to
   * the database would go quiet exactly when the database is the unwell thing.
   */
  SALE_CARD_ORDER_AWAITING: 'tma.sale_card_order_awaiting',
  /**
   * A card sale's order was denied, or ran out of time unanswered, and a
   * statement is now what it is waiting for.
   *
   * Separate from {@link SALE_CARD_ORDER_AWAITING} because it asks for
   * something different — a document rather than a tap — and because routing to
   * the terminal has stopped by the time it fires, which is worth saying.
   */
  SALE_CARD_ORDER_DISPUTED: 'tma.sale_card_order_disputed',
  /**
   * A sale has less left to collect than the pipeline will route an order for,
   * and it asked to wait for that last stretch rather than have it back as
   * USDT — so somebody has to transfer it by hand.
   *
   * Fires once per sale, gated by `tailAnnouncedAt`, and only once there is
   * nothing left to ask the seller for: a declared shortfall no statement has
   * settled holds it, because the figure an operator would be told to transfer
   * is the one that document is about to correct.
   *
   * Neutral for the usual reason — the settlement rules must not know a
   * Telegram group exists — and it carries the whole sentence's figures rather
   * than an id to re-read, like {@link FIAT_DEPOSIT_STUCK}.
   */
  SALE_TAIL_REACHED: 'tma.sale_tail_reached'
} as const

/** Payload of {@link TMA_DOMAIN_EVENT.BALANCE_UPDATED} and its referral twin. */
export interface TmaBalanceChangedEvent {
  readonly telegramId: number
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STATUS_CHANGED}.
 *
 * Carries `coveredUah` because a fiat top-up moves without changing status:
 * a receipt accepted against a ₴20 000 payout leaves it PARTIALLY_PAID and
 * still advances it, and a panel watching only `status` would show a stalled
 * row while somebody's transfers were landing one after another.
 */
export interface TmaFiatDepositChangedEvent {
  readonly telegramId: number
  readonly depositId: string
  readonly status: TmaFiatDepositStatus
  /** UAH kopecks accepted so far. */
  readonly coveredUah: number
}

/** Payload of {@link TMA_DOMAIN_EVENT.DEPOSIT_STATUS_CHANGED}. */
export interface TmaDepositChangedEvent {
  readonly telegramId: number
  readonly depositId: string
  readonly status: TmaDepositStatus
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.SALE_STATUS_CHANGED} and of
 * {@link TMA_DOMAIN_EVENT.SALE_PROGRESS}.
 *
 * One shape for both because a consumer re-reads the order either way — the
 * difference between "the status moved" and "the progress moved" is which push
 * the Mini App received, not which row an observer has to look at.
 */
export interface TmaSaleChangedEvent {
  readonly telegramId: number
  readonly saleId: string
  readonly status?: TmaSaleStatus
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.FIAT_DEPOSIT_STUCK}.
 *
 * Carries the figures rather than only the id, unlike its siblings: the
 * consumer writes a sentence a person reads on a phone at two in the morning,
 * and a listener that had to re-read the row would be a listener that says
 * nothing when the database is the thing that is unwell.
 *
 * Nothing here is a credential. The recipient card and the receipt links stay
 * on the record.
 */
export interface TmaFiatDepositStuckEvent {
  readonly depositId: string
  readonly payoutId: number
  readonly telegramId: number
  /** UAH kopecks the top-up was for. */
  readonly amountUah: number
  /** UAH kopecks Transacto reports as paid into the payout. Always above zero. */
  readonly coveredUah: number
  /** How long the payout has been ours, in whole minutes. */
  readonly heldForMinutes: number
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.FIAT_DEPOSIT_AMOUNTS_AVAILABLE}.
 *
 * **The consumer settles the request, not the emitter.** `watchId` is here so
 * that whoever sends the message can delete a {@link FiatDepositWatchMode.ONCE}
 * request or stamp an `ALWAYS` one *after* Telegram has accepted it — recording
 * a notification the emitter merely attempted would retire a request nobody was
 * ever told about, which is the one outcome this feature must not produce.
 *
 * `amountsUah` are the amounts that actually fell inside the range on this
 * tick, cheapest first — never the whole book, and never a single one, because
 * two payouts can appear between two refreshes and the user picking between
 * them is the point.
 */
export interface TmaFiatDepositAmountsAvailableEvent {
  readonly watchId: string
  readonly telegramId: number
  /** UAH kopecks, cheapest first. Never empty. */
  readonly amountsUah: readonly number[]
  /** The range as the user wrote it, so the message can quote it back. */
  readonly minAmountUah: number
  readonly maxAmountUah: number
  readonly mode: FiatDepositWatchMode
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.SALE_CARD_ORDER_AWAITING} and
 * {@link TMA_DOMAIN_EVENT.SALE_CARD_ORDER_DISPUTED}.
 *
 * Everything a message about this order needs, and nothing that would make the
 * consumer read the database to write a sentence.
 *
 * **No card number, in any form.** The consumer names the sale and the amount;
 * the seller knows which card of theirs it is, and a bot message is the last
 * place a payment credential should be able to reach.
 */
export interface TmaSaleCardOrderEvent {
  readonly telegramId: number
  /** The sale's id, for the deep link back into the Mini App. */
  readonly saleId: string
  /** The code the user sees and quotes to support. */
  readonly publicId: string
  /** Transacto's numeric order id — what the inline button carries. */
  readonly orderId: number
  /** UAH kopecks the payer was routed to send. */
  readonly amount: number
  /** When silence becomes a dispute, epoch milliseconds. */
  readonly confirmDeadlineAt: number
}

/**
 * Payload of {@link TMA_DOMAIN_EVENT.SALE_TAIL_REACHED}.
 *
 * Carries the figures rather than only the id, like its siblings: the consumer
 * writes a sentence a person acts on, and one that had to re-read the row would
 * go quiet exactly when the database is the unwell thing.
 *
 * **`payoutTarget` is a payment credential, and it is the one payload in this
 * file that carries one.** Everything else about this codebase keeps a card
 * number off every wire it does not have to be on — it is never persisted, it
 * never reaches a log line, and `TmaFiatDepositStuckEvent` says in as many
 * words that nothing on it is a credential. This is a deliberate exception,
 * decided because an operator reading the alert has to be able to make the
 * transfer without going and finding the card first. See the root `CLAUDE.md`
 * for the reasoning and its cost.
 *
 * What follows from that:
 *
 * - **It must never be logged.** Not by the emitter, not by the consumer, not
 *   in a failure path. Whoever handles this payload logs the sale's `publicId`
 *   and nothing else about where the money goes.
 * - **It is not stored.** The event is in-process; the sale keeps only
 *   `payoutCardTail`, four digits, exactly as it did before.
 * - `null` when it could not be resolved — Transacto unreachable for a card
 *   sale, or a jar sale with no link recorded. The message says so rather than
 *   pretending, and the operator falls back to the panel.
 */
export interface TmaSaleTailReachedEvent {
  readonly saleId: string
  readonly publicId: string
  readonly telegramId: number
  /** Which kind of destination {@link payoutTarget} is. */
  readonly saleMethod: SaleMethod
  /** UAH kopecks still to collect. Above zero and below the pipeline's floor. */
  readonly tailKopecks: number
  /** UAH kopecks the sale is for. */
  readonly fiatAmount: number
  /** UAH kopecks that have arrived so far. */
  readonly receivedAmount: number
  /**
   * Where the transfer has to go: the seller's card in full on a card sale, the
   * jar's public link on a jar sale, or `null` when neither could be read.
   *
   * A credential — see the note above.
   */
  readonly payoutTarget: string | null
}
