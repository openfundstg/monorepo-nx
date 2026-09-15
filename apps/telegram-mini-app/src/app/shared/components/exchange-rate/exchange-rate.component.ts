import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { UahPipe } from '../../pipes/uah.pipe';

/**
 * `Курс: 1 USDT = 45,60 грн`, in the one place that decides how it reads.
 *
 * Four screens showed this line and each built it by hand. Three agreed by
 * luck; the fourth formatted the same number with a whole-hryvnia helper and
 * rendered a live rate of 45.60 as **46**, beside amounts that had been
 * converted at 45.60 — a screen contradicting itself about the price of the
 * thing it was selling.
 *
 * Deliberately dumb: the rate is an input, not something this fetches. A screen
 * that *prices* something must show the rate it priced at, which arrives with
 * its own data — see `RatesState`, whose whole doc comment is about that
 * distinction. This component decides the wording and the formatting and
 * nothing else, which is also why it does not care *which* rate it is handed:
 * the dashboard passes the market one and the top-up screen the discounted
 * one, and the line reads the same either way.
 *
 * `null` renders nothing: a rate that is not known yet is absent, and absent is
 * not zero.
 *
 * The label is an input for the same reason the rate is: the dashboard shows
 * both prices at once, and two lines reading "Курс" one above the other name
 * neither of them. Screens quoting a single rate say nothing and keep the plain
 * one, and a caller whose surroundings already say which price this is — the
 * rate under a button called "Поповнити" — passes `null` and gets the equation
 * alone.
 *
 * Its size is a custom property rather than an input: `--rate-line-size` is set
 * by whoever is placing it, and inherits through the emulated view that a
 * parent stylesheet cannot otherwise reach into.
 */
@Component({
  selector: 'app-exchange-rate',
  imports: [TranslatePipe, UahPipe],
  templateUrl: './exchange-rate.component.html',
  styleUrl: './exchange-rate.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExchangeRateComponent {
  /** Kopecks per USDT, or `null` / `0` while unknown. */
  readonly rate = input.required<number | null>();

  /** Translation key for the words before the figure, or `null` for none. */
  readonly labelKey = input<string | null>('common.exchange_rate');
}
