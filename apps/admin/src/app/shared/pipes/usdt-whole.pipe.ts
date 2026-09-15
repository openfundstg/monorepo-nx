import { Pipe, PipeTransform } from '@angular/core';
import { formatUsdtWhole } from '../utils/format.util';

/** Template-side wrapper for `formatUsdtWhole`. The formatting itself lives in `utils/`. */
@Pipe({ name: 'usdtWhole' })
export class UsdtWholePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatUsdtWhole(value);
  }
}
