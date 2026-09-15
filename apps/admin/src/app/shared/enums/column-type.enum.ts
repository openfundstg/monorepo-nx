/**
 * How one column renders itself.
 *
 * The table component switches on this rather than taking a render function per
 * column, so a money column cannot be formatted one way on the users screen and
 * another on the orders screen — which is exactly what happened to kopecks and
 * cents before the formatters were centralised.
 */
export enum ColumnType {
  /** Plain text, already a string by the time it reaches the cell. */
  TEXT = 'TEXT',
  /** A right-aligned number with tabular figures. */
  NUMBER = 'NUMBER',
  /** UAH kopecks → `₴1 234,56`. */
  UAH = 'UAH',
  /** USDT cents → `1 234.56 USDT`. */
  USDT = 'USDT',
  /** Whole USDT, as the deposit form takes it — never scaled. */
  USDT_WHOLE = 'USDT_WHOLE',
  /** An ISO timestamp, rendered short and local. */
  DATE = 'DATE',
  /** A status pill, toned by `ChipTone`. */
  CHIP = 'CHIP',
  /** Yes/no, as a positive or neutral pill. */
  BOOL = 'BOOL',
  /** Monospaced — ids, hashes, links. */
  MONO = 'MONO',
  /** An external link; the cell value is the href and the label. */
  LINK = 'LINK',
}
