import { Pipe, PipeTransform } from '@angular/core';
import { formatDateTime } from '../utils/format.util';

/** ISO string or epoch millis → `12.08.2026, 19:54`. */
@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    return value === null || value === undefined ? '' : formatDateTime(value);
  }
}
