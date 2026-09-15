import { Pipe, PipeTransform, LOCALE_ID, Inject } from '@angular/core'
import { formatNumber, formatCurrency, registerLocaleData } from '@angular/common'
import localeUk from '@angular/common/locales/uk'

registerLocaleData(localeUk, 'uk-UA')

@Pipe({
  name: 'kopecks',
  standalone: true
})
export class KopecksPipe implements PipeTransform {
  constructor(@Inject(LOCALE_ID) private locale: string) {}

  transform(
    value: number | string | undefined | null,
    type: 'currency' | 'decimal' = 'currency'
  ): string {
    if (value === null || value === undefined) return ''
    const numValue = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(numValue)) return ''

    const uah = numValue / 100

    if (type === 'decimal') {
      return formatNumber(uah, this.locale, '1.2-2')
    } else {
      return formatCurrency(uah, this.locale, '₴', 'UAH', '1.2-2')
    }
  }
}
