import { Pipe, PipeTransform } from '@angular/core';
import { formatUsdt } from '../utils/format.util';

/** Template-side wrapper for `formatUsdt`. The formatting itself lives in `utils/`. */
@Pipe({ name: 'usdt' })
export class UsdtPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatUsdt(value);
  }
}
