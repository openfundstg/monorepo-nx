import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The full rules of a hryvnia top-up, behind the ⓘ on the amounts screen.
 *
 * Everything here is a way to lose money or to be refused, and none of it fits
 * on the screen it belongs to: which banks are accepted, what happens when the
 * window closes, why an overpayment is not credited, why a screenshot is not a
 * receipt. The confirmation sheet states the four rules a user must read before
 * committing; this is where the rest lives, for somebody who wants them before
 * they start rather than after they are refused.
 *
 * Presentational only — it renders text and reports its own dismissal.
 */
@Component({
  selector: 'app-fiat-rules',
  imports: [TranslatePipe],
  templateUrl: './fiat-rules.modal.html',
  styleUrl: './fiat-rules.modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiatRulesModal {
  readonly dismissed = output<void>();

  /**
   * The window, from the server rather than written into the sentence.
   *
   * It is configurable — `TMA_FIAT_PAY_WINDOW_MINUTES` — and it has already
   * moved once, from ten to fifteen. A number typed into three dictionaries is
   * a number that goes on promising ten in every language nobody re-read.
   */
  readonly payWindowMinutes = input.required<number>();

  /**
   * Every rule, in the order the modal lists them — the ones that stop a
   * top-up starting first, then the ones that stop it finishing.
   *
   * `receipt_limit` used to be here, promising "no more than five receipts or
   * transactions per payment". Nothing in this product enforces a count, and
   * the panel's contract says nothing about one either — so it was a figure a
   * user could be refused by and nobody could check. What is enforced instead
   * is stated: one at a time, inside the window, to the kopeck.
   */
  protected readonly ruleKeys: readonly string[] = [
    'fiat.rules.one_at_a_time',
    'fiat.rules.banks',
    'fiat.rules.amount',
    'fiat.rules.exact',
    'fiat.rules.timing',
    'fiat.rules.no_screenshots',
    'fiat.rules.overpayment',
    'fiat.rules.rejected',
    'fiat.rules.crediting',
  ];
}
