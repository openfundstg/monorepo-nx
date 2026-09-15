import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { KopecksPipe } from './kopecks.pipe'

/**
 * One money cell in the terminal history: the figure, and how it moved.
 *
 * All three money columns render identically — the same value-plus-arrow, the
 * same colours, the same dash when there is nothing to show — so they render
 * through one component. They used to be three copies of the same six lines of
 * markup in the table, which is how the actual-balance column ended up as the
 * only one without arrows and stayed that way unnoticed.
 *
 * It only displays. Deciding what the movement *is* belongs to whoever owns the
 * rows, because that needs the row below this one.
 */
@Component({
  selector: 'app-history-amount',
  imports: [KopecksPipe],
  templateUrl: './history-amount.component.html',
  styleUrl: './history-amount.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryAmountComponent {
  /** Kopecks. `undefined` renders as a dash — the figure is not known. */
  readonly value = input<number | undefined>()

  /** Kopecks moved since the previous row; `undefined` when it did not move. */
  readonly delta = input<number | undefined>()
}
