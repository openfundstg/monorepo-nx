import { Pipe, PipeTransform } from '@angular/core';
import { formatUsdt } from '../utils/format.util';

/** USDT cents → a grouped decimal string. `{{ user.balance | usdt }}` */
@Pipe({ name: 'usdt' })
export class UsdtPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    return formatUsdt(cents ?? 0);
  }
}
