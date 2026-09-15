import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

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
  imports: [TranslatePipe],
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
}
