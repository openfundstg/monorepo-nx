import type { BankProvider } from '../enums/bank-provider.enum.js';
import type { TerminalSource } from '../enums/terminal-source.enum.js';
import type { SaleRemainderPolicy } from '../enums/tma.enum.js';

/**
 * One terminal as the extension's network search returns it.
 *
 * Deliberately a superset of a dashboard row rather than a separate shape: the
 * same card component renders both, and a search hit that is still enabled is
 * the very same jar the dashboard is already showing.
 *
 * The difference is `enabled`, which the dashboard never has to think about —
 * it only ever returns live terminals — and `balanceAt`, which says how old the
 * figures are. A disabled terminal is not being scraped, so its balance is
 * whatever was last seen, and showing it without saying when would be a lie
 * that gets worse every day.
 */
export interface TerminalSearchItem {
  readonly terminalId: number;
  readonly cardId: number;
  readonly targetId?: string;
  readonly sendId?: string;
  readonly terminalName: string;
  readonly source: TerminalSource;
  readonly bankProvider: BankProvider;
  readonly url?: string;
  /** Kopecks. `null` when nothing was ever recorded for this terminal. */
  readonly balance: number | null;
  /** Kopecks. `null` when the bank never reported a target. */
  readonly goal: number | null;
  /**
   * When `balance` and `goal` were last observed, ISO-8601.
   *
   * Absent for a terminal that has not been scraped since the figures started
   * being persisted — its balance is `null` too, so there is nothing to date.
   */
  readonly balanceAt?: string;
  readonly hasPendingOrders: boolean;
  readonly pendingOrdersSum: number;
  readonly enabled: boolean;
  /**
   * Whether new payers are still routed to this terminal.
   *
   * `enabled` and this are two different questions, and a winding-down terminal
   * is the case that separates them: it is still scraped, still matches
   * payments and still holds money in flight, but Transacto has been told to
   * send it nobody new. A trader needs to see the difference — the jar can
   * still receive, and hiding it would hide live money.
   */
  readonly acceptingOrders: boolean;
  /**
   * What the Mini App order behind this terminal does with a remainder no
   * payment can cover.
   *
   * The trader-facing meaning is whether this jar will ever ask them for
   * anything: a `WAIT_FOR_TOP_UP` jar raises "almost full" near its goal and
   * needs the last stretch paid in by hand, a `REFUND_TO_BALANCE` one closes
   * itself and never does.
   *
   * Absent on a terminal the trader created themselves, which has no sale
   * behind it at all.
   */
  readonly remainderPolicy?: SaleRemainderPolicy;
}

/** Response of `GET /extension/terminals/search`. */
export interface TerminalSearchRes {
  /** Best match first — see the ranking in `ExtensionTerminalSearchService`. */
  readonly terminals: TerminalSearchItem[];
  /**
   * How many matched in total, which may exceed `terminals.length`.
   *
   * The client says "showing 20 of 57" rather than silently truncating; a
   * trader searching for a jar they cannot find needs to know the list is cut.
   */
  readonly total: number;
}
