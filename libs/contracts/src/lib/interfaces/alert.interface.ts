import { AlertType } from '../enums/alert.enum.js';

/**
 * The parameters each alert type carries, keyed by that type.
 *
 * **Alerts are stored as a key plus data, never as a sentence.** `AlertType` is
 * the translation key and this is the interpolation payload, so one document
 * renders in every language the client supports — and adding a language costs
 * a JSON file, not a migration.
 *
 * Every field a translation interpolates must appear here. A string that only
 * exists inside a rendered message is unreachable to the client: that is how
 * `combinationsCount` went missing and `ALERTS.AMBIGUOUS_DESC` rendered
 * "Found  combinations".
 *
 * All amounts are kopecks, like everywhere else on the wire.
 */
export interface AlertMetadataMap {
  /** A deposit arrived that no combination of pending orders explains. */
  [AlertType.UNRECOGNIZED_DEPOSIT]: {
    /** The unexplained amount. */
    amount: number;
    /** Total balance movement this scrape, which `amount` failed to account for. */
    totalDelta: number;
  };

  /** Several combinations of orders match the deposit; a human must choose. */
  [AlertType.AMBIGUOUS_DEPOSIT]: {
    amount: number;
    /** How many order combinations summed to `amount`. */
    combinationsCount: number;
  };

  /** The balance dropped, which a jar should never do on its own. */
  [AlertType.FRAUD]: {
    previousBalance: number;
    currentBalance: number;
  };

  /**
   * Transacto refused the automatic confirmation of an order whose money has
   * already arrived. Every field here is interpolated into the sentence, so a
   * trader can find the order in the cabinet without opening anything else.
   */
  [AlertType.ORDER_CONFIRMATION_FAILED]: {
    /** UAH kopecks, matching the order's own amount. */
    amount: number;
    /** Transacto's internal numeric id — what `orders_execute` takes. */
    orderId: number;
    /** The human-readable id shown in the cabinet, which is what to search for. */
    orderStringId: string;
    /** Transacto's `error_code`; 108 is the only one that reaches here today. */
    errorCode: number;
  };

  /** The jar is close enough to its goal that it will soon stop accepting. */
  [AlertType.TERMINAL_FULL_WARNING]: {
    goal: number;
    /** Remaining headroom before the goal is reached. */
    left: number;
  };
}

/** Metadata for one specific alert type. */
export type AlertMetadata<T extends AlertType = AlertType> = AlertMetadataMap[T];
