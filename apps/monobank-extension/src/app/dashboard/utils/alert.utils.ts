import { KopecksPipe } from '../../shared/pipes/kopecks.pipe';
import type { AlertData } from '../../terminal/interfaces/terminal.interface';

/** Amount-bearing keys, at the top level and inside `metadata`. */
const AMOUNT_KEYS = ['amount', 'left', 'goal'] as const;
/**
 * Money fields inside `metadata`. Deliberately excludes `combinationsCount`,
 * which is a count — dividing it by 100 would print "0,03 combinations".
 */
const METADATA_AMOUNT_KEYS = [
  ...AMOUNT_KEYS,
  'previousBalance',
  'currentBalance',
  'totalDelta',
] as const;

/**
 * An alert whose amounts have been rendered for display.
 *
 * Same keys as {@link AlertData} — the template still reads `type`, `isRead`
 * and `id` as real properties — but the money fields are now strings.
 */
export type FormattedAlert = Omit<AlertData, (typeof AMOUNT_KEYS)[number]> & {
  amount?: string | number;
  left?: string | number;
  goal?: string | number;
};

/**
 * Alert amounts arrive in kopecks; templates interpolate them into translated
 * sentences, where a pipe cannot reach. This pre-formats them to decimal
 * strings so `{{ 'ALERTS.X_DESC' | translate: alert.metadata }}` reads
 * correctly.
 *
 * **The parameters come from `metadata`, not from the alert root.** Both are
 * handled below only because the alert's own `amount` column is a real field
 * alongside it. The REST dashboard route used to flatten `metadata` onto the
 * root and delete it, which left the pipe with `undefined` and printed the
 * placeholders verbatim; both routes now return it nested, matching
 * `TerminalAlertDto`.
 *
 * The locale is fixed to uk-UA because the amounts are hryvnia regardless of
 * which of the three UI languages is selected.
 */
export const formatAlertMetadata = (alerts: AlertData[]): FormattedAlert[] => {
  const pipe = new KopecksPipe('uk-UA');
  const toDecimal = (value: unknown) =>
    typeof value === 'number' ? pipe.transform(value, 'decimal') : value;

  return alerts.map((alert) => {
    const formatted: FormattedAlert = { ...alert };

    for (const key of AMOUNT_KEYS) {
      if (formatted[key]) formatted[key] = toDecimal(formatted[key]) as string;
    }

    if (alert.metadata) {
      const meta: Record<string, unknown> = { ...alert.metadata };
      for (const key of METADATA_AMOUNT_KEYS) {
        if (meta[key] !== undefined) meta[key] = toDecimal(meta[key]);
      }
      formatted.metadata = meta;
    }

    return formatted;
  });
};
