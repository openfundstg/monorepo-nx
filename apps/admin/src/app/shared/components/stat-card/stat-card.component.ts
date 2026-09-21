import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { NavTarget } from '../../interfaces/column-def.interface';

/**
 * One figure on the overview.
 *
 * Takes an already-formatted string rather than a number and a unit: the
 * overview draws kopecks, cents, whole USDT and plain counts side by side, and
 * a component that chose the formatter itself would need to be told which of
 * the four this is — which is the same decision, moved somewhere it is easier
 * to get wrong.
 */
@Component({
  selector: 'app-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './stat-card.component.html',
  styleUrl: './stat-card.component.scss',
})
export class StatCardComponent {
  /** Translation key. */
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  /** Translation key for a line of context under the figure. */
  readonly hint = input<string | null>(null);
  readonly hintParams = input<Record<string, unknown> | undefined>(undefined);
  /**
   * Where this figure's rows are, or `null` for one that leads nowhere.
   *
   * Every number on the overview is a count of something an operator will want
   * to look at, and until this existed each of them ended in a sidebar click
   * and a search. A figure that cannot be narrowed to a list — a sum of
   * balances, say — passes `null` and stays plain, because a link to
   * "everything" is a link that taught somebody it is not worth clicking.
   */
  readonly link = input<NavTarget | null>(null);
}
