import { Pipe, PipeTransform } from '@angular/core';
import { formatUah, formatUahWhole } from '../utils/format.util';

/**
 * UAH kopecks → a grouped decimal string. `{{ order.fiatAmount | uah }}`
 *
 * Pure: the locale is fixed (see `format.util.ts`), so the output depends only
 * on the input and Angular can cache it.
 */
@Pipe({ name: 'uah' })
export class UahPipe implements PipeTransform {
  /** Pass `whole` to drop the decimals on headline figures. */
  transform(kopecks: number | null | undefined, whole = false): string {
    const value = kopecks ?? 0;

    return whole ? formatUahWhole(value) : formatUah(value);
  }
}
