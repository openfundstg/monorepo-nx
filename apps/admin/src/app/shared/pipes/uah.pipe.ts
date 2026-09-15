import { Pipe, PipeTransform } from '@angular/core';
import { formatUah } from '../utils/format.util';

/** Template-side wrapper for `formatUah`. The formatting itself lives in `utils/`. */
@Pipe({ name: 'uah' })
export class UahPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatUah(value);
  }
}
