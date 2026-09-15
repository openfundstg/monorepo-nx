import { Pipe, PipeTransform } from '@angular/core';
import { formatDateTime } from '../utils/format.util';

/** Template-side wrapper for `formatDateTime`. The formatting itself lives in `utils/`. */
@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatDateTime(value);
  }
}
