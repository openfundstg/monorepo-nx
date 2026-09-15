import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChipTone } from '../../enums/chip-tone.enum';

/**
 * A status pill.
 *
 * The label is a translation key built by concatenation — `prefix + '.' +
 * value` — which is the client half of the rule that the database stores keys
 * and never sentences. Without a prefix the raw value is shown, which is the
 * honest rendering of a code the panel has no copy for.
 */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './status-chip.component.html',
  styleUrl: './status-chip.component.scss',
})
export class StatusChipComponent {
  readonly value = input.required<string>();
  readonly tone = input<ChipTone>(ChipTone.NEUTRAL);
  readonly translatePrefix = input<string | null>(null);

  readonly toneClass = computed(() => `chip--${this.tone()}`);

  /**
   * The key to render, or the raw value when there is no prefix.
   *
   * `ngx-translate` echoes a key it cannot find, so an unmapped status shows
   * as `SALE_STATUS.SOMETHING_NEW` rather than as a blank cell — which
   * is exactly the feedback that gets the missing copy written.
   */
  readonly label = computed(() => {
    const prefix = this.translatePrefix();

    return prefix ? `${prefix}.${this.value()}` : this.value();
  });
}
