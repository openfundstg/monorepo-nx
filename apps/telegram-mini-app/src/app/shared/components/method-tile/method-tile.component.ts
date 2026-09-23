import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslatePipe } from '@ngx-translate/core'

/**
 * One way of doing something, on a screen that asks which.
 *
 * The top-up screen drew these first and the sale screen draws the same tile,
 * so it is defined here once rather than as two stylesheets that start out
 * identical and learn to disagree.
 *
 * The icon is projected rather than passed in: the top-up tiles show a currency
 * sign and the sale tiles a drawn icon, and both are just content that takes
 * its colour from the tile.
 *
 * **Every tile leads somewhere.** It used to carry a `comingSoon` input that
 * greyed a tile, badged it "in development" and withheld its `href`; the card
 * sale was the last method to need it and no longer does. The sale form's
 * remainder picker still has its own — a policy that is genuinely not built —
 * and that is where the pattern lives if a method ever needs it again.
 */
@Component({
  selector: 'app-method-tile',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './method-tile.component.html',
  styleUrl: './method-tile.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MethodTileComponent {
  readonly titleKey = input.required<string>()
  readonly hintKey = input.required<string>()

  /** Where a tap goes. */
  readonly link = input<string | null>(null)
}
