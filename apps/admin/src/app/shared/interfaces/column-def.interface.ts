import type { ChipTone } from '../enums/chip-tone.enum';
import type { ColumnType } from '../enums/column-type.enum';

/**
 * One column of a list, described rather than templated.
 *
 * The table component renders from these, so a money column is formatted the
 * same way on every screen and a new list is a `ColumnDef[]` rather than
 * another copy of the same `<table>`.
 *
 * `value` returns the raw figure, never a formatted string — formatting is
 * chosen by {@link type}. Returning a pre-formatted string here is what would
 * let one screen show kopecks where another shows hryvnia.
 */
/**
 * Somewhere in this panel, as the router takes it.
 *
 * `commands` rather than a URL string: the router builds the link, so a route
 * that moves is a compile error at the one place that names it instead of a
 * dead link somebody finds in production. The query parameters are how a link
 * arrives *narrowed* — see `bindListQuery`.
 *
 * Separate from {@link RowLink} because a caller that only navigates should not
 * have to invent a label it never renders. The overview's cards did exactly
 * that for a while, passing `label: ''` to satisfy a type.
 */
export interface NavTarget {
  readonly commands: readonly (string | number)[];
  readonly queryParams?: Readonly<Record<string, string | number>>;
}

/** A destination with the chip that carries it — one link out of a row. */
export interface RowLink extends NavTarget {
  /** Shown in the chip. A translation key when {@link translate} is set. */
  readonly label: string | number;
  /** Whether {@link label} is a translation key rather than a value. */
  readonly translate?: boolean;
  readonly icon?: string;
  /** Translation key for the tooltip — what the operator will land on. */
  readonly tooltip?: string;
}

export interface ColumnDef<T> {
  /** Matches the Material column name and the API's `sort` value when sortable. */
  readonly key: string;
  /** Translation key for the header. */
  readonly header: string;
  readonly type: ColumnType;
  /** The raw cell value. `null` renders as an em dash rather than a blank. */
  readonly value: (row: T) => string | number | boolean | null;
  /** Required by `ColumnType.CHIP`, ignored otherwise. */
  readonly tone?: (row: T) => ChipTone;
  /**
   * Translation key prefix for a `CHIP` whose value is an enum member.
   *
   * The backend stores keys and the client renders the sentence, so a status
   * cell builds `prefix + '.' + value` rather than carrying a `switch`. Absent
   * means the value is shown as it arrived, which is right for a code the panel
   * has no copy for.
   */
  readonly translatePrefix?: string | ((row: T) => string);
  /**
   * Where this cell's value lives, for `ColumnType.ROUTER_LINK`.
   *
   * `null` for a row that has nowhere to go — an order with no terminal yet,
   * a support user with no Mini App account. The cell then renders as plain
   * text rather than as a link that goes nowhere.
   */
  readonly link?: (row: T) => RowLink | null;
  /** What else this row is connected to, for `ColumnType.REFS`. */
  readonly refs?: (row: T) => readonly RowLink[];
  /** Whether the header offers sorting. Only fields the API allows should be. */
  readonly sortable?: boolean;
  /** Fixed width, where a column would otherwise stretch to fill. */
  readonly width?: string;
}

/** A row action, shown in the trailing column. */
export interface RowAction<T> {
  readonly id: string;
  /** Translation key for the menu label. */
  readonly label: string;
  readonly icon: string;
  /** Hidden entirely for rows it cannot apply to, rather than shown disabled. */
  readonly visible?: (row: T) => boolean;
  /** Marks an action that takes or moves money, so the menu can colour it. */
  readonly destructive?: boolean;
}
