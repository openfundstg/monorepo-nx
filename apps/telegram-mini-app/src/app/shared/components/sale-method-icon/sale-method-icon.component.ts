import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SaleMethod } from '@transacto/contracts';

/**
 * The mark for *where a sale pays out* — a jar or a card.
 *
 * Drawn in the dashboard's hand — a 24px grid, a 1.75 stroke, round ends —
 * because there is no character for a jar or a card to type, the way the top-up
 * tiles type ₮ and ₴. `currentColor` throughout, so a tile that greys out takes
 * its icon with it.
 *
 * **Shared because two screens have to agree.** The method picker offers these
 * two shapes and the history list has to answer "which of those was this?" —
 * and a row drawn from a second copy of the paths is a row that comes to differ
 * from the screen that created it by a stroke width nobody notices for months.
 */
@Component({
  selector: 'app-sale-method-icon',
  imports: [],
  templateUrl: './sale-method-icon.component.html',
  styleUrl: './sale-method-icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SaleMethodIconComponent {
  readonly method = input.required<SaleMethod>();

  /**
   * Side of the square, in pixels.
   *
   * Passed rather than inherited from the font, because the two places this is
   * drawn size it against different things: a tile sizes it against its own
   * padding, and a history row sizes it against the bank logo it replaced.
   */
  readonly size = input(24);

  protected readonly SaleMethod = SaleMethod;
}
