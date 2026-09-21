import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** One slice a list offers. */
export interface FilterChip {
  /** The enum member the backend reads, or `null` for the whole list. */
  readonly value: string | null;
  /** Translation key. */
  readonly label: string;
  readonly icon?: string;
}

/**
 * The chips that cut a list into its named slices.
 *
 * **This is what let four screens become two.** Sales on a jar and sales to a
 * card are one book read two ways, and so are USDT and hryvnia top-ups — but
 * they were four sidebar entries, which meant an operator answering "has this
 * person ever topped up" had to visit two of them and remember to.
 *
 * Deliberately not `MatButtonToggleGroup`: a toggle group owns its own
 * selection and would hold a second copy of a value the store already has,
 * which is exactly how a chip ends up highlighted for a filter the list is not
 * applying. This renders from the input and reports the click.
 */
@Component({
  selector: 'app-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './filter-chips.component.html',
  styleUrl: './filter-chips.component.scss',
})
export class FilterChipsComponent {
  readonly chips = input.required<readonly FilterChip[]>();
  /** The slice the list is actually showing, from the store. */
  readonly active = input<string | null>(null);

  readonly select = output<string | null>();
}
