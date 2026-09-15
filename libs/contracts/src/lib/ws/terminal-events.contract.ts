import type { TerminalHistory } from '../interfaces/terminal-history.interface.js';
import type { BankProvider } from '../enums/bank-provider.enum.js';
import type { TerminalSource } from '../enums/terminal-source.enum.js';
import type { SaleRemainderPolicy } from '../enums/tma.enum.js';
import type { AlertType, AlertStatus } from '../enums/alert.enum.js';
import type { AlertMetadata } from '../interfaces/alert.interface.js';

/**
 * Payload for each member of {@link WsEventNames}.
 *
 * These shapes are derived from the actual emit sites in the backend, not from
 * what either side previously believed. `terminalId` and `cardId` are numbers
 * everywhere: that is how Mongo stores them and how the REST dashboard returns
 * them, so the socket must agree or client-side lookups by id silently miss.
 */

/**
 * `TerminalBroadcastService.announceEnabled` — a terminal the trader can now
 * see, pushed the moment it appears or comes back.
 *
 * **A whole card, not two identifiers.** It used to carry `{ terminalId, cardId }`
 * and nothing else, which was not enough to render anything: the client had to
 * add a near-empty row and wait for a balance broadcast or a page reload to
 * fill it in. Since the event was never actually emitted, that was never
 * visible — it is now, so the payload has to stand on its own.
 *
 * The shape mirrors a row of `GET /extension/dashboard` deliberately. The
 * client maps both through one function; two shapes for the same card is how a
 * live row and a reloaded one come to disagree.
 */
export interface TerminalEnabledDto {
  terminalId: number;
  cardId: number;
  targetId?: string;
  sendId?: string;
  terminalName: string;
  source: TerminalSource;
  bankProvider: BankProvider;
  url?: string;
  /**
   * Kopecks, from the last figures observed — **not** from a fresh scrape.
   *
   * A terminal is announced the moment it exists, and the scraper's first pass
   * is seconds to minutes away. What was last seen is already stored, so the
   * card can show a balance and a goal immediately instead of an empty shell
   * that fills in later.
   */
  balance: number;
  /** Kopecks. Absent when no target has ever been observed for this jar. */
  goal?: number;
  hasPendingOrders: boolean;
  pendingOrdersSum: number;
  /** Whether new payers are still routed here. See `TerminalCard`. */
  acceptingOrders: boolean;
  /** What the Mini App order behind it does with an unfillable remainder. */
  remainderPolicy?: SaleRemainderPolicy;
  /** When `balance` and `goal` were observed, ISO-8601. Absent if never. */
  balanceAt?: string;
  /**
   * ISO-8601, matching a dashboard row rather than the epoch milliseconds
   * `TerminalBalanceUpdatedDto` uses. The two shapes are read by one mapper on
   * the client, so they have to agree down to the units.
   */
  updatedAt: string;
}

/**
 * `TerminalBroadcastService.announceDisabled` — a terminal that has been taken
 * out of service.
 *
 * Two identifiers is enough here, and deliberately so: the client already holds
 * the card and only has to decide whether to drop it. It keeps one that still
 * has unread alerts, because dropping that would take the trader's only notice
 * of what went wrong with it.
 */
export interface TerminalDisabledDto {
  terminalId: number;
  cardId: number;
}

/**
 * `terminal-balance-orchestrator.service.ts` — broadcastBalanceUpdate().
 * Note the balance field is `currentBalance`, not `balance`.
 */
export interface TerminalBalanceUpdatedDto {
  terminalId: number;
  cardId: number;
  sendId: string;
  terminalName: string;
  currentBalance: number;
  /**
   * Jar target in kopecks, when the bank reports one.
   *
   * Absent when the bank does not expose a goal — clients must keep whatever
   * they already had rather than resetting to 0, since the scrape that omits it
   * says nothing about the goal either way.
   */
  goal?: number;
  hasPendingOrders: boolean;
  pendingOrdersSum: number;
  /** epoch milliseconds */
  updatedAt: number;
}

/** `terminal-history.module.ts` — post('save'), the full history entry. */
export interface TerminalHistoryUpdatedDto extends TerminalHistory {
  _id: string;
  createdAt: string | Date;
}

/**
 * `alerts.module.ts` — the whole Alert document spread, plus `id` and
 * `alertId`, which are both the stringified `_id`.
 *
 * There is deliberately no `message`: the client renders `type` as a
 * translation key with `metadata` as its parameters. See {@link AlertMetadataMap}.
 */
export interface TerminalAlertDto {
  _id: string;
  id: string;
  alertId: string;
  traderId: number;
  terminalId: number;
  type: AlertType;
  amount: number;
  status: AlertStatus;
  isRead: boolean;
  metadata?: AlertMetadata;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type TerminalAlertTriggeredDto = TerminalAlertDto;
export type TerminalAlertResolvedDto = TerminalAlertDto;

/** `trader.module.ts` — post('save') / post('findOneAndUpdate') */
export interface TraderDeactivatedDto {
  traderId: number;
}
