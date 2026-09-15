import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input } from '@angular/core'
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

  /**
   * Listed, and not built yet: greyed, badged "in development", and going
   * nowhere — what the sale form's remainder picker already does for the
   * policy it does not have yet.
   */
  readonly comingSoon = input(false, { transform: booleanAttribute })

  /**
   * `null` for a method that is coming soon, whatever link it was handed.
   *
   * `routerLink` bound to `null` removes the `href`, so the grey is not the
   * only thing standing between a tap and a screen that does not exist: there
   * is nothing left to follow.
   */
  protected readonly target = computed(() => (this.comingSoon() ? null : this.link()))
}
