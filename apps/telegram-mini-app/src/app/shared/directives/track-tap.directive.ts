import { Directive, inject, input } from '@angular/core';
import { MetaPixelService } from '../services/meta-pixel.service';
import type { PixelTapEvent } from '../enums/pixel-event.enum';

/**
 * Reports a tap on whatever it is put on.
 *
 * ```html
 * <button [appTrackTap]="PixelTapEvent.START_DEPOSIT">…</button>
 * ```
 *
 * A directive rather than a call in each handler, for two reasons. Counting a
 * tap is not the business of the method that acts on it, and several of the
 * elements worth counting — a nav link, an anchor — have no handler to add it
 * to. Marking them up is also how the next one gets added without opening a
 * TypeScript file.
 *
 * `click` alone covers taps: a browser synthesises it for a touch, so a
 * separate touch listener would count every mobile tap twice.
 */
@Directive({
  selector: '[appTrackTap]',
  host: { '(click)': 'report()' },
})
export class TrackTapDirective {
  private readonly pixel = inject(MetaPixelService);

  readonly appTrackTap = input.required<PixelTapEvent>();

  protected report(): void {
    this.pixel.trackAction(this.appTrackTap());
  }
}
