import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BRAND_MARK_SRC, BRAND_NAME } from '../../constants/brand.const';

/**
 * The product's mark, wherever the panel signs itself.
 *
 * Two callers today — the nav's brand row and the login card — and a component
 * rather than two `<img>` tags because the artwork is one file: replacing it
 * should not mean finding every place that happened to name it.
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './brand-mark.component.html',
  styleUrl: './brand-mark.component.scss',
})
export class BrandMarkComponent {
  /** Edge of the square, in pixels. */
  readonly size = input(24);

  /**
   * Decorative wherever the product's name is already written beside it, which
   * is both of today's callers — hence the empty default.
   */
  readonly alt = input('');

  protected readonly BRAND_MARK_SRC = BRAND_MARK_SRC;
  protected readonly BRAND_NAME = BRAND_NAME;
}
