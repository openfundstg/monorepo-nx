import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { BRAND_MARK_SRC, BRAND_NAME } from '../../constants/brand.const'

/**
 * The Open Funds mark, optionally with the name beside it.
 *
 * One component rather than an `<img>` per screen: the launch splash, the
 * dashboard header, the settings footer and the two service screens all draw
 * the same lockup, and four copies of it would be four chances for the
 * proportions to drift apart the first time the artwork is replaced.
 *
 * The mark is decorative wherever the name is rendered next to it — the two
 * would otherwise be announced twice — so `alt` is empty in that case and
 * carries the brand name only when the mark stands alone.
 */
@Component({
  selector: 'app-logo',
  imports: [],
  templateUrl: './logo.component.html',
  styleUrl: './logo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LogoComponent {
  /** Edge of the square mark, in pixels. The name scales with it. */
  readonly size = input(32)

  /** Whether to set the product's name beside the mark. */
  readonly wordmark = input(false)

  protected readonly BRAND_NAME = BRAND_NAME
  protected readonly BRAND_MARK_SRC = BRAND_MARK_SRC
}
