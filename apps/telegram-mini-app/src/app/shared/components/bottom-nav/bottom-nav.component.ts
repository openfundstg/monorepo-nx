import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TrackTapDirective } from '../../directives/track-tap.directive';
import { TourAnchorDirective } from '../../directives/tour-anchor.directive';
import { PixelTapEvent } from '../../enums/pixel-event.enum';
import { TourStep } from '../../enums/tour-step.enum';

/**
 * The app's persistent navigation.
 *
 * It used to live inside the wallet page's template, which meant it only
 * existed on the one screen that has since been removed — the dashboard had no
 * navigation at all. Hosting it here lets any page opt in with `<app-bottom-nav />`.
 *
 * Active state comes from `routerLinkActive` rather than a bound flag, so a page
 * cannot render the nav with the wrong item highlighted.
 */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive, TranslatePipe, TrackTapDirective, TourAnchorDirective],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomNavComponent {
  /** Named for the template; the directive takes the member, not a string. */
  protected readonly PixelTapEvent = PixelTapEvent;
  /** The tour's last stop points at this whole bar, so the template names the step. */
  protected readonly TourStep = TourStep;
}
